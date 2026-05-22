import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Loader2,
  Download,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  FileText,
  Terminal,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '../common/ui';
import ModThumbnail from '../ModThumbnail';
import SocialProfileHeader, { type SocialProfileSeed } from '../social/SocialProfileHeader';
import {
  parsePortableProfile,
  resolvePortableProfile,
  finalizePortableImport,
  downloadMod,
  getModDetails,
  type SocialProfileDetail,
} from '../../lib/api';
import type {
  PortableProfile,
  PortableResolutionReport,
  PortableResolvedMod,
} from '../../types/portableProfile';
import type { GameBananaFile, GameBananaModDetails } from '../../types/gamebanana';

interface ImportProfileDialogProps {
  activeDeadlockPath: string | null;
  hideNsfwPreviews: boolean;
  onClose: () => void;
  onImported: () => void;
  // When provided, the dialog skips the paste-and-click step: the input is
  // prefilled and parsed automatically. Used by the legacy paste flow.
  initialInput?: string;
  // When provided, the dialog renders a two-column layout: the left rail is
  // the social profile post (owner, description, hero badges, like/report);
  // the right column is the import form. The share code is fetched from the
  // social backend, not passed via initialInput.
  socialProfileId?: string;
  // Instant-render seed so the left rail shows the title/owner/badges/thumbs
  // before the /v1/profiles/:id call resolves. Passed straight through from
  // the Discover card.
  socialProfileSeed?: SocialProfileSeed;
  // Sync like-count + viewer_has_liked changes back to the parent list /
  // manage section so card counters stay in step with the dialog.
  onLikeChange?: (profileId: string, likeCount: number, viewerHasLiked: boolean) => void;
  // Explicit "Sign in with Steam" click in the header.
  onSignInRequested?: () => void;
  // Implicit "tried to like while signed-out" — used for the pulse-the-header
  // affordance, not for triggering OAuth.
  onLikeWithoutSignIn?: () => void;
}

type RowStatus =
  | 'pending'
  | 'queued'
  | 'downloading'
  | 'installed'
  | 'already-installed'
  | 'failed'
  | 'skipped';

interface RowState {
  mod: PortableResolvedMod;
  selected: boolean;
  status: RowStatus;
  statusMessage?: string;
  progress?: { downloaded: number; total: number };
  // Variant picker state. The profile pins a specific (submissionId, fileId),
  // but mods like LowPolyDox ship multiple files (full / lite / per-hero).
  // Letting the user swap to a different file here means importing someone
  // else's profile doesn't force their exact taste on you.
  details?: GameBananaModDetails;
  detailsLoading?: boolean;
  detailsError?: string;
  pickedFileId?: number;
  variantsOpen?: boolean;
}

function gbSubmissionId(mod: PortableResolvedMod): number | null {
  if (mod.entry.source !== 'gamebanana') return null;
  const ref = mod.entry.ref as { submissionId?: number };
  return ref.submissionId ?? null;
}

// Pick the file the download pipeline should actually fetch for this row.
// Picked > resolved (set by the resolver, may differ from the pinned id on
// "upgraded" rows) > the pinned id from the profile entry.
function effectiveFileId(r: RowState): number | undefined {
  if (r.pickedFileId !== undefined) return r.pickedFileId;
  if (r.mod.resolvedFileId !== undefined) return r.mod.resolvedFileId;
  if (r.mod.entry.source === 'gamebanana') {
    const ref = r.mod.entry.ref as { fileId?: number };
    return ref.fileId;
  }
  return undefined;
}

function effectiveFileName(r: RowState): string | undefined {
  if (r.pickedFileId !== undefined && r.details?.files) {
    const f = r.details.files.find((file) => file.id === r.pickedFileId);
    if (f) return f.fileName;
  }
  return r.mod.resolvedFileName;
}

// Composite tracking key for download events. A submission can appear several
// times in one import (different file versions, or multi-VPK siblings); keying
// by submissionId alone would cross-update unrelated rows. Multi-VPK siblings
// genuinely share (submissionId, fileId) and SHOULD update together, since
// they all ride on a single archive download. Uses the effective fileId so a
// user-picked variant flows through queue/complete/error matching.
function rowKey(r: RowState): string | null {
  if (r.mod.entry.source !== 'gamebanana') return null;
  const ref = r.mod.entry.ref as { submissionId?: number };
  if (ref.submissionId === undefined) return null;
  const fid = effectiveFileId(r);
  if (fid === undefined) return null;
  return `${ref.submissionId}:${fid}`;
}

function eventKey(modId: number, fileId: number): string {
  return `${modId}:${fileId}`;
}

export default function ImportProfileDialog({
  activeDeadlockPath,
  hideNsfwPreviews,
  onClose,
  onImported,
  initialInput,
  socialProfileId,
  socialProfileSeed,
  onLikeChange,
  onSignInRequested,
  onLikeWithoutSignIn,
}: ImportProfileDialogProps) {
  // In social mode the share code arrives via SocialProfileHeader's detail
  // fetch; the input is empty until then. In paste mode it's seeded from
  // initialInput as before.
  const [input, setInput] = useState(socialProfileId ? '' : (initialInput ?? ''));
  const [parsed, setParsed] = useState<PortableProfile | null>(null);
  const [report, setReport] = useState<PortableResolutionReport | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [importedProfileName, setImportedProfileName] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [includeAutoexec, setIncludeAutoexec] = useState(true);
  const [autoexecExpanded, setAutoexecExpanded] = useState(false);

  const rowsRef = useRef<RowState[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Mirror the editable name so the finalize effect can read it without
  // depending on profileName: depending on it would re-trigger the finalize
  // on every keystroke, racing the importedProfileName guard.
  const profileNameRef = useRef('');
  useEffect(() => { profileNameRef.current = profileName; }, [profileName]);

  const includeAutoexecRef = useRef(true);
  useEffect(() => { includeAutoexecRef.current = includeAutoexec; }, [includeAutoexec]);

  const trackedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const k = rowKey(r);
      if (k !== null) s.add(k);
    }
    return s;
  }, [rows]);
  const trackedKeysRef = useRef(trackedKeys);
  useEffect(() => { trackedKeysRef.current = trackedKeys; }, [trackedKeys]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importing]);

  // Listen for download events to drive row status during import.
  useEffect(() => {
    const updateRowsByKey = (key: string, patch: Partial<RowState>) => {
      setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, ...patch } : r)));
    };

    const unsubQueue = window.electronAPI.onDownloadQueueUpdated((data) => {
      const queuedSet = new Set(data.queue.map((q) => eventKey(q.modId, q.fileId)));
      const currentKey = data.currentDownload
        ? eventKey(data.currentDownload.modId, data.currentDownload.fileId)
        : null;
      setRows((prev) =>
        prev.map((r) => {
          const k = rowKey(r);
          if (k === null || !trackedKeysRef.current.has(k)) return r;
          if (
            r.status === 'installed' ||
            r.status === 'already-installed' ||
            r.status === 'failed' ||
            r.status === 'skipped'
          ) return r;
          if (currentKey === k) return r.status === 'downloading' ? r : { ...r, status: 'downloading' };
          if (queuedSet.has(k)) return r.status === 'queued' ? r : { ...r, status: 'queued' };
          return r;
        })
      );
    });

    const unsubComplete = window.electronAPI.onDownloadComplete(({ modId, fileId }) => {
      const k = eventKey(modId, fileId);
      if (!trackedKeysRef.current.has(k)) return;
      updateRowsByKey(k, { status: 'installed', statusMessage: undefined });
    });

    const unsubError = window.electronAPI.onDownloadError(({ modId, fileId, message }) => {
      const k = eventKey(modId, fileId);
      if (!trackedKeysRef.current.has(k)) return;
      updateRowsByKey(k, { status: 'failed', statusMessage: message });
    });

    const unsubProgress = window.electronAPI.onDownloadProgress(({ modId, fileId, downloaded, total }) => {
      const k = eventKey(modId, fileId);
      if (!trackedKeysRef.current.has(k)) return;
      setRows((prev) =>
        prev.map((r) =>
          rowKey(r) === k
            ? { ...r, progress: { downloaded, total } }
            : r
        )
      );
    });

    return () => { unsubQueue(); unsubComplete(); unsubError(); unsubProgress(); };
  }, []);

  const handleParse = useCallback(async () => {
    setParseError(null);
    setFinalizeError(null);
    setReport(null);
    setRows([]);
    setParsed(null);
    if (!input.trim()) {
      setParseError('Paste a share code or JSON profile first.');
      return;
    }
    setResolving(true);
    try {
      const profile = await parsePortableProfile(input.trim());
      setParsed(profile);
      setProfileName(profile.profile.name);
      const r = await resolvePortableProfile(profile);
      setReport(r);
      setRows(
        r.resolved.map((mod) => ({
          mod,
          selected: mod.status !== 'unresolvable',
          status: mod.alreadyInstalled ? 'already-installed' : 'pending',
        }))
      );
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  }, [input]);

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    setInput(text);
  }, []);

  // Auto-parse when invoked with a prefilled share code (legacy paste flow).
  const didAutoParseRef = useRef(false);
  useEffect(() => {
    if (didAutoParseRef.current) return;
    if (!initialInput || !initialInput.trim()) return;
    didAutoParseRef.current = true;
    void handleParse();
    // handleParse is stable for the lifetime of `input`; we only want this to
    // run once for the prefilled value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Social mode: SocialProfileHeader fetches /v1/profiles/:id; once the detail
  // arrives, we get the share code from it, set `input`, and trigger the same
  // parse pipeline. Guarded so we only fire once even if the header re-renders.
  const didSocialAutoParseRef = useRef(false);
  const handleSocialDetailReady = useCallback(
    (detail: SocialProfileDetail) => {
      if (didSocialAutoParseRef.current) return;
      didSocialAutoParseRef.current = true;
      setInput(detail.share_code);
    },
    []
  );
  // Once input has been set from the social detail, kick the parse. Separate
  // effect so we don't re-call handleParse on every input change in paste mode.
  useEffect(() => {
    if (!socialProfileId) return;
    if (!input || !input.trim()) return;
    if (parsed || resolving) return;
    void handleParse();
    // handleParse is stable; we want exactly one auto-parse after the social
    // share code lands on `input`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialProfileId, input]);

  const toggleRow = useCallback((idx: number) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r)));
  }, []);

  const toggleAll = useCallback(() => {
    setRows((prev) => {
      const selectable = prev.filter((r) => r.mod.status !== 'unresolvable');
      const allOn = selectable.every((r) => r.selected);
      return prev.map((r) =>
        r.mod.status === 'unresolvable' ? r : { ...r, selected: !allOn }
      );
    });
  }, []);

  const updateRowAt = useCallback((idx: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }, []);

  // Fetch the GameBanana mod details for a row so we can show its full file
  // list. Cached on the row so subsequent opens are instant.
  const ensureDetailsForRow = useCallback(
    async (idx: number): Promise<GameBananaModDetails | null> => {
      const row = rowsRef.current[idx];
      if (!row) return null;
      if (row.details) return row.details;
      if (row.detailsLoading) return null;
      const submissionId = gbSubmissionId(row.mod);
      if (submissionId === null) return null;
      const ref = row.mod.entry.ref as { section?: string };
      updateRowAt(idx, { detailsLoading: true, detailsError: undefined });
      try {
        const details = await getModDetails(submissionId, ref.section || 'Mod');
        updateRowAt(idx, { details, detailsLoading: false });
        return details;
      } catch (err) {
        updateRowAt(idx, {
          detailsLoading: false,
          detailsError: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    [updateRowAt]
  );

  const toggleVariants = useCallback(
    async (idx: number) => {
      const row = rowsRef.current[idx];
      if (!row) return;
      const opening = !row.variantsOpen;
      updateRowAt(idx, { variantsOpen: opening });
      if (opening) await ensureDetailsForRow(idx);
    },
    [ensureDetailsForRow, updateRowAt]
  );

  const pickVariant = useCallback(
    (idx: number, file: GameBananaFile) => {
      setRows((prev) =>
        prev.map((r, i) => {
          if (i !== idx) return r;
          const patch: RowState = { ...r, pickedFileId: file.id };
          // Picking a different file than what's currently on disk means
          // the on-disk match no longer represents the user's choice. Flip
          // to pending so handleConfirm queues a download.
          if (
            r.status === 'already-installed' &&
            file.id !== r.mod.resolvedFileId
          ) {
            patch.status = 'pending';
          }
          return patch;
        })
      );
    },
    []
  );

  // Whether the user has opted into seeing every variant up-front. Mirrors
  // the same toggle on the collection import modal.
  const [showAllVariants, setShowAllVariants] = useState(false);
  const [variantScanProgress, setVariantScanProgress] = useState<
    { done: number; total: number } | null
  >(null);

  const handleToggleShowAllVariants = useCallback(async () => {
    if (showAllVariants) {
      setShowAllVariants(false);
      setRows((prev) =>
        prev.map((r) =>
          r.variantsOpen && (r.details?.files?.length ?? 0) > 1
            ? { ...r, variantsOpen: false }
            : r
        )
      );
      return;
    }

    setShowAllVariants(true);
    const targets: number[] = [];
    rowsRef.current.forEach((r, idx) => {
      if (r.mod.status === 'unresolvable') return;
      if (r.details || r.detailsLoading) return;
      if (gbSubmissionId(r.mod) === null) return;
      targets.push(idx);
    });
    setVariantScanProgress({ done: 0, total: targets.length });

    let done = 0;
    await Promise.all(
      targets.map(async (idx) => {
        await ensureDetailsForRow(idx);
        done += 1;
        setVariantScanProgress({ done, total: targets.length });
      })
    );

    setRows((prev) =>
      prev.map((r) => {
        if (r.mod.status === 'unresolvable') return r;
        if ((r.details?.files?.length ?? 0) > 1) {
          return r.variantsOpen ? r : { ...r, variantsOpen: true };
        }
        return r;
      })
    );
    setVariantScanProgress(null);
  }, [showAllVariants, ensureDetailsForRow]);

  const handleConfirm = useCallback(async () => {
    if (!parsed || !report || !activeDeadlockPath) return;
    setImporting(true);
    setFinalizeError(null);

    const toDownload: RowState[] = [];
    const startingRows = rowsRef.current.map((r) => {
      if (!r.selected || r.mod.status === 'unresolvable') {
        return { ...r, status: 'skipped' as RowStatus };
      }
      // The on-disk match is for the resolved file; if the user picked a
      // different variant, we have to actually download it.
      const pickedDiffers =
        r.pickedFileId !== undefined && r.pickedFileId !== r.mod.resolvedFileId;
      if (r.mod.alreadyInstalled && !pickedDiffers) {
        // Selected and on disk — no work to do, keep the badge and let
        // finalize wire the existing VPK into the new profile.
        return { ...r, status: 'already-installed' as RowStatus };
      }
      toDownload.push(r);
      return { ...r, status: 'queued' as RowStatus };
    });
    setRows(startingRows);

    for (const row of toDownload) {
      if (row.mod.entry.source !== 'gamebanana') continue;
      const fileId = effectiveFileId(row);
      const fileName = effectiveFileName(row);
      if (fileId === undefined || !fileName) continue;
      const ref = row.mod.entry.ref as { submissionId: number; section?: string };
      const failKey = eventKey(ref.submissionId, fileId);
      void downloadMod(
        ref.submissionId,
        fileId,
        fileName,
        ref.section || 'Mod'
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setRows((prev) =>
          prev.map((r) =>
            rowKey(r) === failKey && r.status !== 'installed'
              ? { ...r, status: 'failed', statusMessage: message }
              : r
          )
        );
      });
    }
  }, [parsed, report, activeDeadlockPath]);

  const downloadsSettled = useMemo(() => {
    if (!importing) return false;
    return rows.every(
      (r) =>
        r.status === 'installed' ||
        r.status === 'already-installed' ||
        r.status === 'failed' ||
        r.status === 'skipped'
    );
  }, [rows, importing]);

  // Once every accepted download has settled, finalize: build the local
  // profile from the entries that successfully installed.
  useEffect(() => {
    if (!downloadsSettled || !parsed || !report) return;
    if (importedProfileName) return;

    (async () => {
      const installedEntries: PortableResolvedMod[] = [];
      for (const r of rowsRef.current) {
        if (r.status !== 'installed' && r.status !== 'already-installed') continue;
        // When the user picked a different variant, finalize needs the
        // picked fileId to find the VPK we just installed on disk.
        const picked =
          r.pickedFileId !== undefined &&
          r.pickedFileId !== r.mod.resolvedFileId;
        if (picked) {
          installedEntries.push({
            ...r.mod,
            resolvedFileId: r.pickedFileId,
            resolvedFileName: effectiveFileName(r) ?? r.mod.resolvedFileName,
          });
        } else {
          installedEntries.push(r.mod);
        }
      }
      try {
        const finalName = profileNameRef.current.trim() || parsed.profile.name;
        const hasAutoexec = !!parsed.extensions?.grimoire?.autoexecCommands?.length;
        const dropAutoexec = hasAutoexec && !includeAutoexecRef.current;
        const finalProfile = dropAutoexec
          ? {
              ...parsed,
              profile: { ...parsed.profile, name: finalName },
              extensions: {
                ...parsed.extensions,
                grimoire: {
                  ...parsed.extensions?.grimoire,
                  autoexecCommands: undefined,
                },
              },
            }
          : { ...parsed, profile: { ...parsed.profile, name: finalName } };
        const created = await finalizePortableImport({
          profile: finalProfile,
          resolved: installedEntries,
        });
        setImportedProfileName(created.name);
        onImported();
      } catch (err) {
        setFinalizeError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [downloadsSettled, parsed, report, importedProfileName, onImported]);

  const counts = useMemo(() => {
    const c = { queued: 0, downloading: 0, installed: 0, failed: 0, skipped: 0 };
    for (const r of rows) {
      if (r.status === 'queued') c.queued++;
      else if (r.status === 'downloading') c.downloading++;
      else if (r.status === 'installed') c.installed++;
      else if (r.status === 'failed') c.failed++;
      else if (r.status === 'skipped') c.skipped++;
    }
    return c;
  }, [rows]);

  const selectableCount = rows.filter((r) => r.mod.status !== 'unresolvable').length;
  const selectedCount = rows.filter((r) => r.selected).length;

  // Tri-state UI. Important: there's a transient window inside handleParse
  // where parsed is set but report is not yet (we awaited parse, are now
  // awaiting resolve). Without showSkeleton spanning that gap, only the
  // dialog header would render and the body would flash empty.
  const showResolved = !!(parsed && report);
  const showSkeleton =
    !showResolved &&
    !parseError &&
    (!!initialInput || resolving || !!socialProfileId);
  // The manual paste form never makes sense in social mode — the share code
  // comes from the backend, not user input.
  const showInputForm = !socialProfileId && !showResolved && !showSkeleton;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-profile-title"
      onClick={importing ? undefined : onClose}
    >
      <div
        className={`bg-bg-secondary border border-white/10 rounded-2xl w-full ${socialProfileId ? 'max-w-5xl' : 'max-w-4xl'} max-h-[92vh] flex flex-col overflow-hidden shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start justify-between ${parsed || socialProfileId ? 'px-4 sm:px-6 py-3' : 'p-4 sm:p-6'} border-b border-white/10`}>
          <div className="min-w-0">
            <h2 id="import-profile-title" className="text-base sm:text-lg font-bold text-text-primary">
              Import Profile
            </h2>
            {!parsed && !socialProfileId && (
              <p className="hidden sm:block text-sm text-text-secondary mt-1">
                Paste a share code or load a .modprofile.json file exported from Grimoire's Profiles tab. This format is Grimoire-only and not compatible with other mod managers.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {(() => {
          // Wrap the existing body blocks (skeleton / input form / resolved)
          // in an IIFE so we can render them either standalone (paste mode)
          // or inside a two-column flex layout (social mode) without
          // duplicating the JSX. The body itself is unchanged.
          const body = (
            <>
        {/* Loading skeleton — covers both the auto-parse flow (Discover ->
            Import with a prefilled share code) and the in-between window of
            manual parse + resolve where `parsed` is set but `report` is not
            yet. Without this the dialog body would flash empty between the
            two awaits. */}
        {showSkeleton && (
          <>
            <div className="px-4 sm:px-6 py-2.5 border-b border-white/10">
              <div className="h-3 bg-white/5 rounded w-20 mb-2 animate-pulse" />
              <div className="h-8 bg-white/5 rounded animate-pulse" />
            </div>
            <div className="px-4 sm:px-6 py-2 border-b border-white/5 flex items-center justify-between">
              <div className="h-3 bg-white/5 rounded w-24 animate-pulse" />
              <div className="h-4 bg-white/5 rounded w-32 animate-pulse" />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ul className="divide-y divide-white/5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="px-4 sm:px-6 py-2.5 flex items-center gap-3 sm:gap-4 animate-pulse">
                    <div className="w-4 h-4 rounded-sm bg-white/5 flex-shrink-0" />
                    <div className="w-14 h-10 sm:w-20 sm:h-14 flex-shrink-0 rounded-sm bg-white/5" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="h-3.5 bg-white/5 rounded w-2/3" />
                      <div className="h-3 bg-white/5 rounded w-1/3" />
                    </div>
                    <div className="h-3 bg-white/5 rounded w-16 flex-shrink-0" />
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-white/10 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
              <div className="text-xs text-text-secondary inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Resolving profile contents...
              </div>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {showInputForm && (
          <div className="p-4 sm:p-6 border-b border-white/10 space-y-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste share code (mp1:...) or full JSON here"
              rows={4}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent font-mono"
            />
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-text-secondary inline-flex items-center gap-2 cursor-pointer hover:text-text-primary">
                <FileText className="w-4 h-4" />
                <span>Or load from file</span>
                <input
                  type="file"
                  accept=".json,.modprofile.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </label>
              <Button onClick={handleParse} disabled={resolving || !input.trim()} isLoading={resolving}>
                Parse & resolve
              </Button>
            </div>
            {parseError && (
              <div className="text-xs text-red-400 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}
          </div>
        )}

        {showResolved && parsed && report && (
          <>
            <div className="px-4 sm:px-6 py-2.5 border-b border-white/10">
              <div className="flex items-baseline gap-2 mb-1">
                <label className="text-[11px] uppercase tracking-wider text-text-secondary flex-shrink-0">
                  Save as
                </label>
                {parsed.profile.author && (
                  <span className="text-xs text-text-tertiary truncate min-w-0">· originally by {parsed.profile.author}</span>
                )}
              </div>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                disabled={importing || !!importedProfileName}
                placeholder={parsed.profile.name}
                aria-label="Profile name"
                className="w-full px-3 py-1.5 bg-bg-tertiary border border-white/10 rounded-md text-sm font-semibold text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
              />
            </div>

            {parsed.extensions?.grimoire?.autoexecCommands?.length ? (
              (() => {
                const cmds = parsed.extensions!.grimoire!.autoexecCommands!;
                return (
                  <div className="border-b border-white/5 bg-yellow-500/5">
                    <div className="px-4 sm:px-6 py-2 flex items-center gap-2 text-xs text-yellow-200">
                      <Terminal className="w-3.5 h-3.5 flex-shrink-0" />
                      <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={includeAutoexec}
                          onChange={(e) => setIncludeAutoexec(e.target.checked)}
                          disabled={importing || !!importedProfileName}
                          className="accent-accent cursor-pointer disabled:cursor-not-allowed"
                          aria-label="Include autoexec commands from this profile"
                        />
                        <span className="font-medium">
                          Include {cmds.length} autoexec {cmds.length === 1 ? 'command' : 'commands'}
                        </span>
                      </label>
                      <span
                        className={`min-w-0 truncate font-mono text-[11px] text-text-tertiary ${includeAutoexec ? '' : 'line-through opacity-60'}`}
                        title={cmds.join('\n')}
                      >
                        {cmds[0]}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAutoexecExpanded((v) => !v)}
                        className="ml-auto flex-shrink-0 inline-flex items-center gap-1 text-text-secondary hover:text-text-primary cursor-pointer"
                        aria-expanded={autoexecExpanded}
                        aria-label={autoexecExpanded ? 'Hide autoexec details' : 'Show autoexec details'}
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${autoexecExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                    {autoexecExpanded && (
                      <div className="px-4 sm:px-6 pb-2 pl-9 sm:pl-11">
                        <div className={`space-y-0.5 max-h-24 overflow-y-auto font-mono text-[11px] text-text-secondary ${includeAutoexec ? '' : 'opacity-50 line-through'}`}>
                          {cmds.map((cmd, i) => (
                            <div key={i} className="truncate" title={cmd}>{cmd}</div>
                          ))}
                        </div>
                        <div className="text-[11px] text-text-secondary mt-1">
                          {includeAutoexec
                            ? 'Written to autoexec.cfg when you apply the imported profile.'
                            : 'Discarded. Your autoexec.cfg will not be modified by this profile.'}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : null}

            <div className="px-4 sm:px-6 py-2 sticky top-0 bg-bg-secondary/95 backdrop-blur border-b border-white/5 z-10 flex items-center justify-between gap-2 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  checked={selectableCount > 0 && selectedCount === selectableCount}
                  onChange={toggleAll}
                  disabled={selectableCount === 0 || importing}
                  className="accent-accent cursor-pointer flex-shrink-0"
                />
                <span className="truncate">
                  {selectedCount === selectableCount && selectableCount > 0
                    ? 'Deselect all'
                    : `Select all (${selectableCount})`}
                </span>
              </label>
              <button
                type="button"
                onClick={() => void handleToggleShowAllVariants()}
                disabled={importing || variantScanProgress !== null || selectableCount === 0}
                className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border border-white/10 text-text-secondary hover:text-text-primary hover:border-white/20 disabled:opacity-60 disabled:cursor-default cursor-pointer"
                title="Fetch every mod's file list so you can swap to a different variant than the one pinned in the profile"
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
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] justify-end flex-shrink-0">
                <span className="px-1.5 py-0.5 rounded-sm bg-green-500/10 text-green-300 border border-green-500/20">
                  {report.exactCount} exact
                </span>
                {report.alreadyInstalledCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-sm bg-white/5 text-text-secondary border border-white/10" title="Mods already installed locally">
                    {report.alreadyInstalledCount} on disk
                  </span>
                )}
                {report.upgradedCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-sm bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    {report.upgradedCount} upgraded
                  </span>
                )}
                {report.unresolvableCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-sm bg-red-500/10 text-red-300 border border-red-500/20">
                    {report.unresolvableCount} unresolvable
                  </span>
                )}
                {parsed.extensions?.grimoire?.crosshair && (
                  <span className="px-1.5 py-0.5 rounded-sm bg-white/5 text-text-secondary border border-white/10">
                    crosshair
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <ul className="divide-y divide-white/5">
                {rows.map((r, idx) => {
                  const mod = r.mod;
                  const hint = mod.entry.hint;
                  const isUnresolvable = mod.status === 'unresolvable';
                  const submissionId = gbSubmissionId(mod);
                  const fileCount = r.details?.files?.length ?? 0;
                  const canPickVariants =
                    !isUnresolvable && submissionId !== null;
                  const pickedFile =
                    r.pickedFileId !== undefined && r.details?.files
                      ? r.details.files.find((f) => f.id === r.pickedFileId)
                      : undefined;
                  const progressPct =
                    r.status === 'downloading' && r.progress && r.progress.total > 0
                      ? Math.min(100, (r.progress.downloaded / r.progress.total) * 100)
                      : null;
                  return (
                    <li key={idx} className="relative px-4 sm:px-6 py-2.5">
                      {r.status === 'downloading' && (
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/5 overflow-hidden">
                          {progressPct === null ? (
                            <div className="h-full w-1/3 bg-accent/70 animate-pulse" />
                          ) : (
                            <div
                              className="h-full bg-accent transition-[width] duration-150 ease-out"
                              style={{ width: `${progressPct}%` }}
                            />
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-3 sm:gap-4">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={() => toggleRow(idx)}
                          disabled={isUnresolvable || importing}
                          className="w-4 h-4 accent-accent cursor-pointer disabled:cursor-not-allowed flex-shrink-0"
                          aria-label={`Toggle ${hint?.name ?? 'mod'}`}
                        />
                        <ModThumbnail
                          src={hint?.thumbnailUrl}
                          alt={hint?.name ?? 'Mod'}
                          nsfw={hint?.nsfw}
                          hideNsfw={hideNsfwPreviews}
                          className="w-14 h-10 sm:w-20 sm:h-14 flex-shrink-0 rounded-sm bg-bg-tertiary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-text-primary truncate">
                            {hint?.name ?? `Submission #${gbSubmissionId(mod) ?? '?'}`}
                          </div>
                          <div className="text-xs text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            {hint?.category && <span className="truncate max-w-[12rem]">{hint.category}</span>}
                            {hint?.fileLabel && <span className="hidden sm:inline">· {hint.fileLabel}</span>}
                            <span>· p{mod.entry.priority}</span>
                            {!mod.entry.enabled && <span className="text-text-tertiary">· disabled</span>}
                            {canPickVariants && (
                              <button
                                type="button"
                                onClick={() => void toggleVariants(idx)}
                                disabled={importing}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm hover:text-text-primary hover:bg-white/5 disabled:opacity-50 disabled:cursor-default cursor-pointer"
                                title="Choose a different variant from this mod"
                              >
                                {r.variantsOpen ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                                {r.detailsLoading ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : fileCount > 1 ? (
                                  <span>{fileCount} variants</span>
                                ) : fileCount === 1 ? (
                                  <span>1 file</span>
                                ) : (
                                  <span>Variants</span>
                                )}
                              </button>
                            )}
                            {pickedFile && (
                              <span
                                className="text-accent truncate max-w-[14rem]"
                                title={pickedFile.fileName}
                              >
                                · {pickedFile.fileName}
                              </span>
                            )}
                          </div>
                          {mod.status === 'upgraded' && (
                            <div className="text-xs text-blue-300 mt-1 inline-flex items-center gap-1">
                              <ArrowUpCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">Original file no longer available, will use newest version</span>
                            </div>
                          )}
                          {mod.status === 'unresolvable' && (
                            <div className="text-xs text-red-400 mt-1 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{mod.reason ?? 'Not available on GameBanana'}</span>
                            </div>
                          )}
                          {r.status === 'downloading' && progressPct !== null && (
                            <div className="text-[10px] text-text-tertiary mt-0.5 sm:hidden font-mono">
                              {Math.round(progressPct)}%
                            </div>
                          )}
                        </div>
                        <div className="text-sm flex-shrink-0 text-right sm:min-w-[100px]">
                          {r.status === 'pending' && !isUnresolvable && (
                            <span className="text-text-tertiary text-xs">Ready</span>
                          )}
                          {r.status === 'already-installed' && (
                            <span
                              className="text-text-secondary inline-flex items-center gap-1.5 justify-end text-xs"
                              title="Already installed locally — will be wired into the new profile without re-downloading"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="hidden sm:inline">On disk</span>
                            </span>
                          )}
                          {r.status === 'queued' && (
                            <span className="text-accent inline-flex items-center gap-1.5 justify-end text-xs" title="Queued">
                              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                              <span className="hidden sm:inline">Queued</span>
                            </span>
                          )}
                          {r.status === 'downloading' && (
                            <span className="text-accent inline-flex items-center gap-1.5 justify-end text-xs" title="Downloading">
                              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                              <span className="hidden sm:inline">
                                {progressPct !== null ? `${Math.round(progressPct)}%` : 'Downloading'}
                              </span>
                            </span>
                          )}
                          {r.status === 'installed' && (
                            <span className="text-green-400 inline-flex items-center gap-1.5 justify-end text-xs" title="Installed">
                              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="hidden sm:inline">Installed</span>
                            </span>
                          )}
                          {r.status === 'failed' && (
                            <span
                              className="text-red-400 inline-flex items-center gap-1.5 justify-end text-xs"
                              title={r.statusMessage ?? 'Failed'}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="hidden sm:inline">Failed</span>
                            </span>
                          )}
                          {r.status === 'skipped' && (
                            <span className="text-text-tertiary text-xs">Skipped</span>
                          )}
                        </div>
                      </div>

                      {r.variantsOpen && (
                        <div className="ml-[68px] sm:ml-[104px] mt-2 mb-1">
                          {r.detailsLoading && (
                            <div className="text-xs text-text-secondary flex items-center gap-1.5">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Loading files...
                            </div>
                          )}
                          {r.detailsError && (
                            <div className="text-xs text-red-400 flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {r.detailsError}
                            </div>
                          )}
                          {!r.detailsLoading && !r.detailsError && r.details && (!r.details.files || r.details.files.length === 0) && (
                            <div className="text-xs text-text-tertiary flex items-start gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                              <span>
                                GameBanana returned no downloadable files for this mod.
                              </span>
                            </div>
                          )}
                          {!r.detailsLoading && !r.detailsError && r.details?.files && r.details.files.length > 0 && (
                            <ul className="space-y-1">
                              {r.details.files.map((file) => {
                                const selectedId =
                                  r.pickedFileId !== undefined ? r.pickedFileId : r.mod.resolvedFileId;
                                const isPicked = selectedId === file.id;
                                return (
                                  <li key={file.id}>
                                    <label
                                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-sm cursor-pointer text-sm border ${
                                        isPicked
                                          ? 'bg-accent/10 border-accent/40 text-text-primary'
                                          : 'border-transparent hover:bg-white/5 text-text-secondary'
                                      }`}
                                    >
                                      <input
                                        type="radio"
                                        name={`variant-${idx}`}
                                        checked={isPicked}
                                        onChange={() => pickVariant(idx, file)}
                                        disabled={importing}
                                        className="accent-accent cursor-pointer disabled:cursor-default"
                                      />
                                      <span className="truncate flex-1" title={file.fileName}>
                                        {file.fileName}
                                      </span>
                                      {file.isArchived && (
                                        <span className="text-text-tertiary text-[11px] uppercase tracking-wide">
                                          archived
                                        </span>
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
            </div>

            <div className="border-t border-white/10 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-text-secondary min-w-0 flex-1">
                {importedProfileName ? (
                  <span className="text-green-400 inline-flex items-center gap-1.5 min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">Imported as "{importedProfileName}"</span>
                  </span>
                ) : importing ? (
                  <span className="truncate inline-block max-w-full">
                    {counts.downloading}↓ · {counts.queued} queued · {counts.installed} done{counts.failed > 0 ? ` · ${counts.failed} failed` : ''}
                  </span>
                ) : (
                  `${selectedCount} of ${selectableCount} selected`
                )}
                {finalizeError && (
                  <div className="text-red-400 mt-1 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {finalizeError}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={onClose} disabled={importing && !downloadsSettled}>
                  {importedProfileName ? 'Done' : 'Cancel'}
                </Button>
                {!importedProfileName && (
                  <Button
                    icon={Download}
                    onClick={handleConfirm}
                    disabled={importing || selectedCount === 0 || !activeDeadlockPath || profileName.trim() === ''}
                    isLoading={importing && counts.queued + counts.downloading === 0 && !downloadsSettled}
                  >
                    Import {selectedCount > 0 ? selectedCount : ''}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
            </>
          );
          if (!socialProfileId) return body;
          return (
            <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
              <aside className="md:w-80 md:flex-shrink-0 md:border-r border-b md:border-b-0 border-white/10 overflow-hidden flex">
                <SocialProfileHeader
                  profileId={socialProfileId}
                  seed={socialProfileSeed}
                  onDetailReady={handleSocialDetailReady}
                  onLikeChange={onLikeChange}
                  onSignInRequested={onSignInRequested}
                  onLikeWithoutSignIn={onLikeWithoutSignIn}
                />
              </aside>
              <section className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                {body}
              </section>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
