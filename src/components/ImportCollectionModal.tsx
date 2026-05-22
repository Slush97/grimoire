import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Loader2,
  Library,
  Download,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Ban,
} from 'lucide-react';
import {
  getCollection,
  getCollectionItems,
  getModDetails,
  downloadMod,
  createProfileFromGameBananaIds,
} from '../lib/api';
import { Button } from './common/ui';
import ModThumbnail from './ModThumbnail';
import type {
  GameBananaCollection,
  GameBananaCollectionItem,
  GameBananaFile,
  GameBananaModDetails,
  GameBananaPreviewMedia,
} from '../types/gamebanana';
import {
  getModThumbnail,
  getPrimaryFile,
  parseCollectionId,
} from '../types/gamebanana';

// GameBanana game id for Deadlock — items in other games can't be installed.
const DEADLOCK_GAME_ID = 20948;

// Item types Grimoire can install. Matches Browse.tsx SECTION_WHITELIST.
const SUPPORTED_MODEL_NAMES = new Set(['Mod', 'Sound']);

interface ImportCollectionModalProps {
  hideNsfwPreviews: boolean;
  installedIds: Set<number>;
  queuedIds: Set<number>;
  activeDeadlockPath: string | null;
  onClose: () => void;
}

type SkipReason =
  | { kind: 'wrong-game'; gameName?: string }
  | { kind: 'unsupported-type'; modelName: string }
  | { kind: 'no-files' }
  | { kind: 'files-unavailable' };

// Live status mirrors the main-process queue so users see what's actually
// happening rather than a single ambiguous "queued" label.
type RowStatus =
  | 'idle'           // not submitted
  | 'resolving'      // fetching mod details (variant lookup or pre-queue)
  | 'queued'         // accepted by main-process queue, waiting
  | 'downloading'    // currently the active download
  | 'installed'      // download-complete event received
  | 'cancelled'      // user removed from queue or stopped batch
  | 'failed';        // download-error event received or details fetch threw

interface ItemRow {
  item: GameBananaCollectionItem;
  selectable: boolean;
  skip?: SkipReason;
  status: RowStatus;
  statusMessage?: string;
  details?: GameBananaModDetails;
  detailsLoading?: boolean;
  detailsError?: string;
  pickedFileId?: number;
  variantsOpen?: boolean;
}

function classifySkip(item: GameBananaCollectionItem): SkipReason | undefined {
  if (!SUPPORTED_MODEL_NAMES.has(item.modelName)) {
    return { kind: 'unsupported-type', modelName: item.modelName };
  }
  if (item.gameId !== undefined && item.gameId !== DEADLOCK_GAME_ID) {
    return { kind: 'wrong-game', gameName: item.gameName };
  }
  if (!item.hasFiles) {
    return { kind: 'no-files' };
  }
  return undefined;
}

function initialStatus(
  item: GameBananaCollectionItem,
  installedIds: Set<number>,
  queuedIds: Set<number>
): RowStatus {
  if (installedIds.has(item.id)) return 'installed';
  if (queuedIds.has(item.id)) return 'queued';
  return 'idle';
}

function buildRows(
  items: GameBananaCollectionItem[],
  installedIds: Set<number>,
  queuedIds: Set<number>
): ItemRow[] {
  return items.map((item) => {
    const skip = classifySkip(item);
    return {
      item,
      selectable: !skip,
      skip,
      status: skip ? 'idle' : initialStatus(item, installedIds, queuedIds),
    };
  });
}

function skipReasonLabel(reason: SkipReason): string {
  switch (reason.kind) {
    case 'wrong-game':
      return `Skipped: ${reason.gameName ?? 'different game'}`;
    case 'unsupported-type':
      return `Skipped: ${reason.modelName} not supported`;
    case 'no-files':
      return 'Skipped: no downloadable files';
    case 'files-unavailable':
      return 'Files unavailable';
  }
}

// Render file preview thumbnail via the same getter as collection items so
// the picker UI stays visually consistent.
function previewThumb(media: GameBananaPreviewMedia | undefined): string | undefined {
  return getModThumbnail({ previewMedia: media } as Parameters<typeof getModThumbnail>[0]);
}

export default function ImportCollectionModal({
  hideNsfwPreviews,
  installedIds,
  queuedIds,
  activeDeadlockPath,
  onClose,
}: ImportCollectionModalProps) {
  const [input, setInput] = useState('');
  const [collection, setCollection] = useState<GameBananaCollection | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingItems, setLoadingItems] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // We use a separate "submitting" flag rather than blocking on the
  // submission loop — once items are in the main-process queue, the modal
  // stays interactive (cancel buttons, variant pickers for not-yet-queued
  // rows, etc.).
  const [submitting, setSubmitting] = useState(false);
  // Selected mods that have multiple downloadable files and no manual pick.
  // Populated when the user clicks Queue; submission is blocked while this
  // set is non-empty so the user is forced to choose instead of silently
  // getting the most-downloaded variant.
  const [needsVariantPicks, setNeedsVariantPicks] = useState<Set<number>>(new Set());
  // Whether the user has opted into seeing every variant up-front. Off by
  // default to avoid the API-spam cost on large collections. When on, we
  // fetch details for every selectable row and auto-expand pickers for any
  // mod with multiple files (e.g. LowPolyDox: full / lite / per-hero).
  const [showAllVariants, setShowAllVariants] = useState(false);
  const [variantScanProgress, setVariantScanProgress] = useState<
    { done: number; total: number } | null
  >(null);
  // Snapshot of which ids were submitted in the active batch. Determines
  // which mods belong in a post-install profile if the user opts in.
  const [batchIds, setBatchIds] = useState<Set<number>>(new Set());
  const [profileStatus, setProfileStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'creating' }
    | { kind: 'created'; profileName: string }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });

  // Cancel token for in-flight pagination + submission. Bumping invalidates
  // older in-flight loops so a second resolve/queue click doesn't race.
  const loadTokenRef = useRef(0);
  const submitTokenRef = useRef(0);
  // Ref mirror of rows for event handlers that need current state without
  // re-subscribing on every change.
  const rowsRef = useRef<ItemRow[]>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Per-row DOM refs so we can scroll the first ambiguous-variant row into
  // view when the banner appears.
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const setRowRef = useCallback(
    (id: number) => (el: HTMLLIElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
    },
    []
  );

  // Track which mod ids this modal owns so global queue events don't bleed
  // into rows that came from elsewhere (e.g. the user kicked off a download
  // from Browse while the modal is open).
  const trackedIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const next = new Set<number>();
    for (const r of rows) next.add(r.item.id);
    trackedIdsRef.current = next;
  }, [rows]);

  // ───────── Live state from main-process queue events ─────────

  const updateRow = useCallback((id: number, patch: Partial<ItemRow>) => {
    setRows((prev) => prev.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));
  }, []);

  useEffect(() => {
    const unsubQueue = window.electronAPI.onDownloadQueueUpdated((data) => {
      const queuedHere = new Set(data.queue.map((q) => q.modId));
      const currentId = data.currentDownload?.modId;
      setRows((prev) =>
        prev.map((r) => {
          if (!trackedIdsRef.current.has(r.item.id)) return r;
          // Don't clobber final states (installed / failed / cancelled).
          if (r.status === 'installed' || r.status === 'failed' || r.status === 'cancelled') {
            return r;
          }
          if (currentId === r.item.id) {
            return r.status === 'downloading' ? r : { ...r, status: 'downloading' };
          }
          if (queuedHere.has(r.item.id)) {
            return r.status === 'queued' ? r : { ...r, status: 'queued' };
          }
          // If we previously marked it 'queued' or 'downloading' but it's
          // gone from the main queue now, leave it alone — a complete/error
          // event will arrive (or already did) to set the terminal state.
          return r;
        })
      );
    });

    const unsubComplete = window.electronAPI.onDownloadComplete(({ modId }) => {
      if (!trackedIdsRef.current.has(modId)) return;
      updateRow(modId, { status: 'installed', statusMessage: undefined });
    });

    const unsubError = window.electronAPI.onDownloadError(({ modId, message }) => {
      if (!trackedIdsRef.current.has(modId)) return;
      updateRow(modId, { status: 'failed', statusMessage: message });
    });

    return () => {
      unsubQueue();
      unsubComplete();
      unsubError();
    };
  }, [updateRow]);

  // Whether the active batch has settled (every submitted row is in a
  // terminal state). Drives the post-install "save as profile" prompt.
  const batchSettled = useMemo(() => {
    if (batchIds.size === 0) return false;
    const batchRows = rows.filter((r) => batchIds.has(r.item.id));
    if (batchRows.length === 0) return false;
    return batchRows.every(
      (r) =>
        r.status === 'installed' ||
        r.status === 'failed' ||
        r.status === 'cancelled' ||
        // Rows flipped to a skip reason post-resolve (files-unavailable) count
        // as terminal too: they were dropped from selection but tracked here.
        !r.selectable
    );
  }, [batchIds, rows]);

  // Ids that actually installed in this batch (the candidates for a profile).
  const installedBatchIds = useMemo(
    () =>
      rows
        .filter((r) => batchIds.has(r.item.id) && r.status === 'installed')
        .map((r) => r.item.id),
    [batchIds, rows]
  );

  const handleSaveProfile = useCallback(async () => {
    if (!collection) return;
    if (installedBatchIds.length === 0) return;
    setProfileStatus({ kind: 'creating' });
    try {
      const profile = await createProfileFromGameBananaIds(collection.name, installedBatchIds);
      setProfileStatus({ kind: 'created', profileName: profile.name });
    } catch (err) {
      setProfileStatus({
        kind: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [collection, installedBatchIds]);

  // Escape closes — but only when we're not mid-submission (don't yank the
  // modal out from under a running batch).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // ───────── Fetching collection + items ─────────

  const resolveCollection = useCallback(async () => {
    const collectionId = parseCollectionId(input);
    if (collectionId === null) {
      setResolveError('Enter a collection URL like https://gamebanana.com/collections/164637 or its numeric id.');
      return;
    }

    setResolveError(null);
    setCollection(null);
    setRows([]);
    setSelected(new Set());
    setTotalCount(0);
    setLoadingItems(true);

    const token = ++loadTokenRef.current;

    try {
      const meta = await getCollection(collectionId);
      if (loadTokenRef.current !== token) return;
      setCollection(meta);

      const collected: GameBananaCollectionItem[] = [];
      let page = 1;
      while (page <= 100) {
        const resp = await getCollectionItems(collectionId, page);
        if (loadTokenRef.current !== token) return;
        if (resp.records.length === 0) break;
        collected.push(...resp.records);
        setTotalCount(resp.totalCount);
        setRows(buildRows(collected, installedIds, queuedIds));
        if (resp.isComplete) break;
        if (page === 1 && resp.totalCount && collected.length >= resp.totalCount) break;
        page += 1;
      }

      const finalRows = buildRows(collected, installedIds, queuedIds);
      if (loadTokenRef.current !== token) return;
      setRows(finalRows);
      // Pre-select every installable, not-already-handled item — the obvious
      // intent when opening a collection is to grab the bulk of it.
      setSelected(
        new Set(
          finalRows
            .filter((r) => r.selectable && r.status === 'idle')
            .map((r) => r.item.id)
        )
      );
    } catch (err) {
      if (loadTokenRef.current !== token) return;
      setResolveError(String(err instanceof Error ? err.message : err));
    } finally {
      if (loadTokenRef.current === token) {
        setLoadingItems(false);
      }
    }
  }, [input, installedIds, queuedIds]);

  // ───────── Variant picker (lazy resolve) ─────────

  // Lazy-fetch a row's mod details so we know its file list. Cached on the
  // row so subsequent opens are instant and queue-time doesn't re-fetch.
  // If GameBanana returns no files (typically a DMCA/takedown: the Items
  // endpoint still reports _bHasFiles=true but the detail endpoint has
  // _aFiles=null), mark the row unavailable and drop it from selection so
  // the user doesn't try to queue a download that can't succeed.
  const ensureDetails = useCallback(
    async (row: ItemRow): Promise<GameBananaModDetails | null> => {
      if (row.details) return row.details;
      updateRow(row.item.id, { detailsLoading: true, detailsError: undefined });
      try {
        const details = await getModDetails(row.item.id, row.item.modelName);
        if (!details.files || details.files.length === 0) {
          updateRow(row.item.id, {
            details,
            detailsLoading: false,
            selectable: false,
            skip: { kind: 'files-unavailable' },
            status: 'idle',
          });
          setSelected((prev) => {
            if (!prev.has(row.item.id)) return prev;
            const next = new Set(prev);
            next.delete(row.item.id);
            return next;
          });
          return details;
        }
        updateRow(row.item.id, { details, detailsLoading: false });
        return details;
      } catch (err) {
        updateRow(row.item.id, {
          detailsLoading: false,
          detailsError: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    [updateRow]
  );

  const toggleVariants = useCallback(
    async (row: ItemRow) => {
      const opening = !row.variantsOpen;
      updateRow(row.item.id, { variantsOpen: opening });
      if (opening) {
        await ensureDetails(row);
      }
    },
    [ensureDetails, updateRow]
  );

  const pickVariant = useCallback(
    (row: ItemRow, file: GameBananaFile) => {
      updateRow(row.item.id, { pickedFileId: file.id });
      setNeedsVariantPicks((prev) => {
        if (!prev.has(row.item.id)) return prev;
        const next = new Set(prev);
        next.delete(row.item.id);
        return next;
      });
    },
    [updateRow]
  );

  // Toggle "Show all variants". Turning on fetches details for every
  // selectable row that doesn't have them yet and opens the inline picker
  // for any mod with more than one file. Turning off collapses everything
  // we expanded. Per-row state set by individual chevron clicks is left
  // alone (the user's explicit action wins).
  const handleToggleShowAllVariants = useCallback(async () => {
    if (showAllVariants) {
      setShowAllVariants(false);
      setRows((prev) =>
        prev.map((r) =>
          r.selectable && r.variantsOpen && (r.details?.files?.length ?? 0) > 1
            ? { ...r, variantsOpen: false }
            : r
        )
      );
      return;
    }

    setShowAllVariants(true);
    const targets = rowsRef.current.filter(
      (r) => r.selectable && !r.details && !r.detailsLoading
    );
    setVariantScanProgress({ done: 0, total: targets.length });

    let done = 0;
    await Promise.all(
      targets.map(async (r) => {
        await ensureDetails(r);
        done += 1;
        setVariantScanProgress({ done, total: targets.length });
      })
    );

    setRows((prev) =>
      prev.map((r) => {
        if (!r.selectable) return r;
        if ((r.details?.files?.length ?? 0) > 1) {
          return r.variantsOpen ? r : { ...r, variantsOpen: true };
        }
        return r;
      })
    );
    setVariantScanProgress(null);
  }, [showAllVariants, ensureDetails]);

  // "Use most popular" escape hatch on the variant-required banner.
  // Stamps each unresolved row with its primary file id so submission can
  // proceed on the next Queue click without making the user pick manually.
  const acceptDefaults = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => {
        if (!needsVariantPicks.has(r.item.id)) return r;
        if (!r.details?.files || r.details.files.length === 0) return r;
        return { ...r, pickedFileId: getPrimaryFile(r.details.files).id };
      })
    );
    setNeedsVariantPicks(new Set());
  }, [needsVariantPicks]);

  // ───────── Selection ─────────

  const eligibleRows = useMemo(
    () => rows.filter((r) => r.selectable && r.status === 'idle'),
    [rows]
  );

  const skippedCount = useMemo(
    () => rows.filter((r) => !r.selectable).length,
    [rows]
  );

  const allEligibleSelected =
    eligibleRows.length > 0 && eligibleRows.every((r) => selected.has(r.item.id));

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (allEligibleSelected) return new Set();
      const next = new Set(prev);
      for (const r of eligibleRows) next.add(r.item.id);
      return next;
    });
  }, [allEligibleSelected, eligibleRows]);

  // ───────── Cancel ─────────

  const cancelRow = useCallback(async (row: ItemRow) => {
    if (row.status !== 'queued') return;
    // removeFromQueue rejects the original downloadMod promise. Our submit
    // loop catches that as a "Cancelled by user" message and skips marking
    // it failed. We still optimistically mark the row cancelled here so the
    // UI reacts immediately.
    await window.electronAPI.removeFromQueue(row.item.id);
    updateRow(row.item.id, { status: 'cancelled' });
  }, [updateRow]);

  const cancelAll = useCallback(async () => {
    // Bump the submit token so the submission loop bails before queueing
    // anything else.
    submitTokenRef.current += 1;
    const queuedNow = rowsRef.current.filter((r) => r.status === 'queued');
    for (const row of queuedNow) {
      await window.electronAPI.removeFromQueue(row.item.id);
      updateRow(row.item.id, { status: 'cancelled' });
    }
    setSubmitting(false);
  }, [updateRow]);

  // ───────── Submission ─────────

  const handleQueue = useCallback(async () => {
    if (!activeDeadlockPath) return;
    if (selected.size === 0) return;

    setSubmitting(true);
    setProfileStatus({ kind: 'idle' });
    const token = ++submitTokenRef.current;
    const initialQueue = rowsRef.current.filter(
      (r) => selected.has(r.item.id) && r.status === 'idle'
    );

    // Pre-fetch details for every selected row we don't have yet so we can
    // detect variant ambiguity up-front. ensureDetails is cache-aware and
    // its underlying API calls are rate-limited in the main process, so a
    // big collection just trickles instead of hammering GameBanana.
    const needsFetch = initialQueue.filter((r) => !r.details);
    if (needsFetch.length > 0) {
      await Promise.all(needsFetch.map((r) => ensureDetails(r)));
      if (submitTokenRef.current !== token) {
        setSubmitting(false);
        return;
      }
    }

    // Re-read after pre-fetch: ensureDetails may have flipped some rows to
    // files-unavailable (auto-deselected) and others now carry their files.
    const ambiguous = rowsRef.current.filter((r) => {
      if (!selected.has(r.item.id)) return false;
      if (r.status !== 'idle') return false;
      if (!r.selectable) return false;
      if (!r.details?.files || r.details.files.length <= 1) return false;
      return r.pickedFileId === undefined;
    });

    if (ambiguous.length > 0) {
      const ambiguousIds = new Set(ambiguous.map((r) => r.item.id));
      setRows((prev) =>
        prev.map((r) =>
          ambiguousIds.has(r.item.id) && !r.variantsOpen
            ? { ...r, variantsOpen: true }
            : r
        )
      );
      setNeedsVariantPicks(ambiguousIds);
      requestAnimationFrame(() => {
        const firstEl = rowRefs.current.get(ambiguous[0].item.id);
        if (firstEl) firstEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      setSubmitting(false);
      return;
    }

    setNeedsVariantPicks(new Set());

    // Refresh the snapshot so each row carries its now-cached details and
    // any pickedFileId the user set while the banner was up.
    const toQueue = rowsRef.current.filter(
      (r) => selected.has(r.item.id) && r.status === 'idle' && r.selectable
    );
    setBatchIds(new Set(toQueue.map((r) => r.item.id)));

    for (const row of toQueue) {
      if (submitTokenRef.current !== token) break;

      const details = row.details;
      if (!details?.files || details.files.length === 0) {
        // ensureDetails already marked this row unavailable (and removed it
        // from the selected set) when it discovered the empty file list, so
        // we just skip. No need to flag it failed here.
        continue;
      }

      const file =
        (row.pickedFileId !== undefined
          ? details.files.find((f) => f.id === row.pickedFileId)
          : undefined) ?? getPrimaryFile(details.files);

      // Fire-and-forget: the main-process queue serializes downloads, and
      // we drive UI state off its events. The catch is only to detect the
      // user-cancellation rejection so we don't double-mark as failed.
      updateRow(row.item.id, { status: 'queued', statusMessage: undefined });
      void downloadMod(
        row.item.id,
        file.id,
        file.fileName,
        row.item.modelName,
        row.item.rootCategory?.id
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'Cancelled by user') {
          // cancelRow / cancelAll already flipped the UI; nothing to do.
          return;
        }
        // download-error event normally handles this, but if the rejection
        // beats the event (or we lose the event), surface the failure.
        const current = rowsRef.current.find((r) => r.item.id === row.item.id);
        if (current && current.status !== 'failed' && current.status !== 'cancelled') {
          updateRow(row.item.id, { status: 'failed', statusMessage: message });
        }
      });
    }

    setSubmitting(false);
  }, [activeDeadlockPath, ensureDetails, selected, updateRow]);

  // ───────── Footer summary ─────────

  const counts = useMemo(() => {
    let queued = 0;
    let downloading = 0;
    let installed = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.status === 'queued') queued += 1;
      else if (r.status === 'downloading') downloading += 1;
      else if (r.status === 'installed') installed += 1;
      else if (r.status === 'failed') failed += 1;
    }
    return { queued, downloading, installed, failed };
  }, [rows]);

  const batchInFlight = counts.queued + counts.downloading > 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-collection-title"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="min-w-0 flex items-start gap-3">
            <Library className="w-6 h-6 text-accent flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 id="import-collection-title" className="text-xl font-bold text-text-primary">
                Import Collection
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                Paste a GameBanana collection URL or id. Items get queued through the same download pipeline as Browse.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input */}
        <div className="p-6 border-b border-white/10">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!loadingItems) resolveCollection();
            }}
            className="flex items-stretch gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://gamebanana.com/collections/164637"
              disabled={loadingItems}
              className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            />
            <Button type="submit" disabled={loadingItems || !input.trim()}>
              {loadingItems ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch'}
            </Button>
          </form>
          {resolveError && (
            <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {resolveError}
            </p>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!collection && !loadingItems && (
            <div className="p-10 text-center text-text-secondary text-sm">
              No collection loaded yet.
            </div>
          )}

          {collection && (
            <div className="px-6 pt-4 pb-2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-text-primary">{collection.name}</h3>
                  {collection.submitter && (
                    <p className="text-xs text-text-secondary mt-0.5">
                      by {collection.submitter.name}
                    </p>
                  )}
                </div>
                <a
                  href={`https://gamebanana.com/collections/${collection.id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-text-secondary hover:text-accent flex items-center gap-1 flex-shrink-0"
                >
                  View on GameBanana
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="mt-3 text-xs text-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{totalCount} item{totalCount === 1 ? '' : 's'} total</span>
                <span>{eligibleRows.length} ready to queue</span>
                {skippedCount > 0 && <span>{skippedCount} skipped</span>}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="sticky top-0 bg-bg-secondary/95 backdrop-blur border-b border-white/5 z-10">
              <div className="px-6 py-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    checked={allEligibleSelected}
                    onChange={toggleSelectAll}
                    disabled={eligibleRows.length === 0}
                    className="accent-accent cursor-pointer"
                  />
                  <span>
                    {allEligibleSelected ? 'Deselect all' : `Select all (${eligibleRows.length})`}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => void handleToggleShowAllVariants()}
                  disabled={variantScanProgress !== null}
                  className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border border-white/10 text-text-secondary hover:text-text-primary hover:border-white/20 disabled:opacity-60 disabled:cursor-default cursor-pointer"
                  title="Fetch every selectable mod's file list and expand any with multiple variants"
                >
                  {variantScanProgress ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        Loading variants {variantScanProgress.done}/{variantScanProgress.total}
                      </span>
                    </>
                  ) : showAllVariants ? (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Hide all variants</span>
                    </>
                  ) : (
                    <>
                      <ChevronRight className="w-3.5 h-3.5" />
                      <span>Show all variants</span>
                    </>
                  )}
                </button>
              </div>
              {needsVariantPicks.size > 0 && (
                <div className="px-6 py-2.5 bg-amber-500/10 border-t border-amber-500/30 flex items-center justify-between gap-3">
                  <div className="text-sm text-amber-200 flex items-center gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>
                      Pick a variant for {needsVariantPicks.size} mod
                      {needsVariantPicks.size === 1 ? '' : 's'} before queueing.
                    </span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={acceptDefaults}>
                    Use most popular
                  </Button>
                </div>
              )}
            </div>
          )}

          <ul className="divide-y divide-white/5">
            {rows.map((row) => {
              const thumb = previewThumb(row.item.previewMedia);
              const checked = selected.has(row.item.id);
              const lockedRow = !row.selectable || row.status !== 'idle';

              const fileCount = row.details?.files?.length ?? 0;
              const pickedFile = row.pickedFileId !== undefined && row.details?.files
                ? row.details.files.find((f) => f.id === row.pickedFileId)
                : undefined;

              return (
                <li
                  key={row.item.id}
                  ref={setRowRef(row.item.id)}
                  className={`px-6 py-4 transition-colors ${
                    needsVariantPicks.has(row.item.id) ? 'bg-amber-500/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(row.item.id)}
                      disabled={lockedRow}
                      className="w-4 h-4 accent-accent cursor-pointer disabled:cursor-not-allowed"
                      aria-label={`Select ${row.item.name}`}
                    />
                    <ModThumbnail
                      src={thumb}
                      alt={row.item.name}
                      nsfw={row.item.nsfw}
                      hideNsfw={hideNsfwPreviews}
                      className="w-20 h-14 flex-shrink-0 rounded-sm bg-bg-tertiary"
                    />
                    <div className="min-w-0 flex-1">
                      <a
                        href={row.item.profileUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-base font-medium text-text-primary hover:text-accent truncate block"
                        title={row.item.name}
                      >
                        {row.item.name}
                      </a>
                      <div className="text-xs text-text-secondary flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
                        <span className="px-2 py-0.5 rounded-sm bg-white/5 border border-white/5 font-medium">
                          {row.item.modelName}
                        </span>
                        {row.item.submitter && <span>by {row.item.submitter.name}</span>}
                        {row.item.rootCategory?.name && <span>· {row.item.rootCategory.name}</span>}
                        {/* Variants chevron sits inline with metadata so the
                            right side only carries the status. Hides on
                            non-selectable / non-idle rows where it would
                            have no effect. */}
                        {row.selectable && row.status === 'idle' && (
                          <button
                            type="button"
                            onClick={() => toggleVariants(row)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-text-secondary hover:text-text-primary hover:bg-white/5 cursor-pointer"
                            title="Choose a variant"
                          >
                            {row.variantsOpen ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            {row.detailsLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : fileCount > 1 ? (
                              <span>{fileCount} variants</span>
                            ) : fileCount === 1 ? (
                              <span>1 file</span>
                            ) : (
                              <span>Files</span>
                            )}
                          </button>
                        )}
                        {pickedFile && (
                          <span className="text-accent truncate max-w-[260px]" title={pickedFile.fileName}>
                            · {pickedFile.fileName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status / cancel. Packs against the title block so
                        the row doesn't carry a giant empty stripe. */}
                    <div className="text-sm flex-shrink-0 text-right">
                      {row.skip ? (
                        <span className="text-text-tertiary">{skipReasonLabel(row.skip)}</span>
                      ) : row.status === 'installed' ? (
                        <span className="text-green-400 inline-flex items-center gap-1.5 justify-end">
                          <CheckCircle2 className="w-4 h-4" /> Installed
                        </span>
                      ) : row.status === 'resolving' ? (
                        <span className="text-text-secondary inline-flex items-center gap-1.5 justify-end">
                          <Loader2 className="w-4 h-4 animate-spin" /> Resolving
                        </span>
                      ) : row.status === 'queued' ? (
                        <button
                          type="button"
                          onClick={() => cancelRow(row)}
                          className="text-accent inline-flex items-center gap-1.5 justify-end hover:text-red-400 cursor-pointer"
                          title="Remove from queue"
                        >
                          <Ban className="w-4 h-4" /> Queued
                        </button>
                      ) : row.status === 'downloading' ? (
                        <span className="text-accent inline-flex items-center gap-1.5 justify-end">
                          <Loader2 className="w-4 h-4 animate-spin" /> Downloading
                        </span>
                      ) : row.status === 'cancelled' ? (
                        <span className="text-text-tertiary inline-flex items-center gap-1.5 justify-end">
                          Cancelled
                        </span>
                      ) : row.status === 'failed' ? (
                        <span
                          className="text-red-400 inline-flex items-center gap-1.5 justify-end"
                          title={row.statusMessage}
                        >
                          <AlertTriangle className="w-4 h-4" /> Failed
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Variant picker */}
                  {row.variantsOpen && (
                    <div className="ml-[100px] mt-3 mb-1">
                      {row.detailsLoading && (
                        <div className="text-xs text-text-secondary flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Loading files…
                        </div>
                      )}
                      {row.detailsError && (
                        <div className="text-xs text-red-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {row.detailsError}
                        </div>
                      )}
                      {!row.detailsLoading && !row.detailsError && row.details && (!row.details.files || row.details.files.length === 0) && (
                        <div className="text-xs text-text-tertiary flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>
                            GameBanana returned no downloadable files for this mod.
                            It may have been removed or taken down. The mod page is still browsable.
                          </span>
                        </div>
                      )}
                      {!row.detailsLoading && !row.detailsError && row.details?.files && row.details.files.length > 0 && (
                        <ul className="space-y-1">
                          {row.details.files.map((file) => {
                            const isPicked =
                              row.pickedFileId !== undefined
                                ? row.pickedFileId === file.id
                                : file.id === getPrimaryFile(row.details!.files!).id;
                            return (
                              <li key={file.id}>
                                <label
                                  className={`flex items-center gap-2.5 px-3 py-2 rounded-sm cursor-pointer text-sm border ${
                                    isPicked
                                      ? 'bg-accent/10 border-accent/40 text-text-primary'
                                      : 'border-transparent hover:bg-white/5 text-text-secondary'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`variant-${row.item.id}`}
                                    checked={isPicked}
                                    onChange={() => pickVariant(row, file)}
                                    className="accent-accent cursor-pointer"
                                  />
                                  <span className="truncate flex-1" title={file.fileName}>
                                    {file.fileName}
                                  </span>
                                  {file.isArchived && (
                                    <span className="text-text-tertiary text-[11px] uppercase tracking-wide">archived</span>
                                  )}
                                  <span
                                    className="text-text-tertiary text-xs tabular-nums inline-flex items-center gap-1"
                                    title={`${file.downloadCount.toLocaleString()} downloads`}
                                  >
                                    <Download className="w-3 h-3" />
                                    {file.downloadCount.toLocaleString()}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {loadingItems && (
            <div className="px-6 py-4 text-xs text-text-secondary flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading items{totalCount > 0 ? ` (${rows.length}/${totalCount})` : ''}…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10">
          {/* Post-install prompt: only appears once every submitted item has
              reached a terminal state and at least one mod actually installed.
              Lets the user save the batch as a profile without making the
              decision up front. */}
          {batchSettled && installedBatchIds.length > 0 && (
            <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-3 text-sm">
              <div className="text-text-secondary min-w-0 flex items-center gap-2">
                <span className="text-text-primary font-medium">
                  Save these {installedBatchIds.length} mod{installedBatchIds.length === 1 ? '' : 's'} as a profile?
                </span>
                {collection && (
                  <span className="text-text-tertiary truncate" title={collection.name}>
                    (“{collection.name}”)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {profileStatus.kind === 'idle' && (
                  <Button size="sm" onClick={handleSaveProfile}>
                    Save as profile
                  </Button>
                )}
                {profileStatus.kind === 'creating' && (
                  <span className="text-text-secondary inline-flex items-center gap-1.5 text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Creating profile…
                  </span>
                )}
                {profileStatus.kind === 'created' && (
                  <span className="text-green-400 inline-flex items-center gap-1.5 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Profile saved
                  </span>
                )}
                {profileStatus.kind === 'failed' && (
                  <span
                    className="text-red-400 inline-flex items-center gap-1.5 text-xs"
                    title={profileStatus.message}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Profile failed
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="p-4 flex items-center justify-between gap-3">
            <div className="text-xs text-text-secondary">
              {submitting && counts.queued + counts.downloading === 0
                ? 'Submitting…'
                : batchInFlight
                  ? `${counts.downloading} downloading · ${counts.queued} queued · ${counts.installed} installed${counts.failed > 0 ? ` · ${counts.failed} failed` : ''}`
                  : counts.installed + counts.failed > 0
                    ? `${counts.installed} installed${counts.failed > 0 ? ` · ${counts.failed} failed` : ''}`
                    : selected.size > 0
                      ? `${selected.size} selected`
                      : 'Select items to queue'}
            </div>
            <div className="flex items-center gap-2">
              {batchInFlight ? (
                <Button variant="danger" onClick={cancelAll}>
                  Cancel remaining
                </Button>
              ) : (
                <Button variant="secondary" onClick={onClose}>
                  {counts.installed > 0 || counts.failed > 0 ? 'Done' : 'Cancel'}
                </Button>
              )}
              <Button
                icon={Download}
                onClick={handleQueue}
                disabled={
                  submitting ||
                  selected.size === 0 ||
                  !activeDeadlockPath ||
                  rows.length === 0 ||
                  !rows.some(
                    (r) => selected.has(r.item.id) && r.status === 'idle'
                  )
                }
                isLoading={submitting && counts.queued + counts.downloading === 0}
              >
                Queue {selected.size > 0 ? selected.size : ''}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
