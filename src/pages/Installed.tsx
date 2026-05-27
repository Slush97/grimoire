import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Package,
  Loader2,
  Settings,
  Trash2,
  AlertTriangle,
  FolderOpen,
  FilePlus,
  X,
  ImagePlus,
  Search,
  Download,
  Info,
  UploadCloud,
  List,
  LayoutGrid,
  Grid3x3,
  Check,
  CheckSquare,
  RotateCcw,
  Wrench,
  Layers,
  Scissors,
  Share2,
  Beaker,
  PowerOff,
  Tag as TagIcon,
  Pencil,
  MoreHorizontal,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getConflicts, openModsFolder, readImageDataUrl, showOpenDialog, getModDetails, getModFileList, downloadMod, createSnapshot, detectUnknownModFilters, cancelUnknownModDetection, applyUnknownModMatch, applyUnknownCustomMod, mergeMods, unmergeMod, extractMergeSource, setModPriority as apiSetModPriority, reorderMods as apiReorderMods, setModIgnoreUpdates } from '../lib/api';
import type { UnmergeModResult } from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { Mod, GlobalModType, UnknownModFilterGuess, MergedModSource } from '../types/mod';
import type { GameBananaModDetails } from '../types/gamebanana';
import ModThumbnail from '../components/ModThumbnail';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import ModDetailsModal from '../components/ModDetailsModal';
import VariantPickerModal from '../components/VariantPickerModal';
import MergeModsModal from '../components/MergeModsModal';
import MergedContentsModal from '../components/MergedContentsModal';
import PriorityEditor from '../components/PriorityEditor';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition, getHeroChipIconPath, HERO_NAMES, GLOBAL_MOD_TYPE_ORDER, GLOBAL_MOD_TYPE_LABELS } from '../lib/lockerUtils';
import { setModGlobalType } from '../lib/api';
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates';
import { Button, Tag } from '../components/common/ui';
import { ViewModeToggle, EmptyState, ConfirmModal, SectionHeader, type ViewMode } from '../components/common/PageComponents';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

type ReorderPosition = 'before' | 'after';
type DragSection = 'enabled' | 'disabled';
type DragDraftOrder = {
  section: DragSection;
  keys: string[];
} | null;

const DROP_STATE_RESET_DELAY_MS = 160;

/**
 * Rows on the Installed page are either standalone mods or grouped files
 * sharing the same GameBanana mod (e.g. five preset VPKs from one skin pack).
 * Grouped entries collapse to a single card; the picker modal handles
 * per-file enable, rename, and delete actions.
 */
type ModEntry =
  | { kind: 'single'; mod: Mod; key: string }
  | {
      kind: 'group';
      gameBananaId: number;
      variants: Mod[];
      /** Enabled files in this group. Empty when the whole group is disabled. */
      enabledVariants: Mod[];
      /** First enabled variant in priority order, or null when every variant is disabled. */
      active: Mod | null;
      /** Mod we render visuals from (thumbnail, name, category). The first
       *  enabled file when any are enabled, else the first variant by priority. */
      primary: Mod;
      /** Sum of variant sizes — shown as the card's "size" field. */
      totalSize: number;
      key: string;
    };

function modEntryKey(mod: Mod): string {
  if (typeof mod.gameBananaId === 'number' && typeof mod.gameBananaFileId === 'number') {
    return `single:gb:${mod.gameBananaId}:${mod.gameBananaFileId}`;
  }
  if (mod.sha256) {
    return `single:sha:${mod.sha256}`;
  }
  return `single:local:${mod.name}:${mod.size}`;
}

function buildModEntries(mods: Mod[]): ModEntry[] {
  const byGb = new Map<number, Mod[]>();
  const singles: Mod[] = [];
  for (const m of mods) {
    if (typeof m.gameBananaId === 'number' && m.gameBananaId > 0) {
      const arr = byGb.get(m.gameBananaId) ?? [];
      arr.push(m);
      byGb.set(m.gameBananaId, arr);
    } else {
      singles.push(m);
    }
  }
  // Singletons (only one mod for a given GB id) collapse back to single
  // entries — the group concept only matters when there are 2+ variants.
  for (const [gb, variants] of Array.from(byGb.entries())) {
    if (variants.length === 1) {
      singles.push(variants[0]);
      byGb.delete(gb);
    }
  }

  const entries: ModEntry[] = [];
  for (const m of singles) {
    entries.push({ kind: 'single', mod: m, key: modEntryKey(m) });
  }
  for (const [gameBananaId, variants] of byGb) {
    // Sort variants by current priority so drag-reorder lines up with the
    // user's mental model ("which slot is this in?") and the picker shows
    // them in the same order as the addons folder.
    variants.sort((a, b) => a.priority - b.priority);
    const enabledVariants = variants.filter((v) => v.enabled);
    const active = enabledVariants[0] ?? null;
    const primary = enabledVariants[0] ?? variants[0];
    const totalSize = variants.reduce((sum, v) => sum + v.size, 0);
    entries.push({
      kind: 'group',
      gameBananaId,
      variants,
      enabledVariants,
      active,
      primary,
      totalSize,
      key: `group:${gameBananaId}`,
    });
  }
  return entries;
}

/** A group is considered "enabled" when at least one file is enabled. */
function isEntryEnabled(entry: ModEntry): boolean {
  return entry.kind === 'single' ? entry.mod.enabled : entry.enabledVariants.length > 0;
}

/** Sort key for ordering enabled/disabled sections. Uses the primary's
 *  priority for groups so reorder math stays consistent with the existing
 *  per-mod priority system. */
function entrySortPriority(entry: ModEntry): number {
  return entry.kind === 'single' ? entry.mod.priority : entry.primary.priority;
}

/** Searchable display name for an entry (the visible card title). */
function entryName(entry: ModEntry): string {
  return entry.kind === 'single' ? entry.mod.name : entry.primary.name;
}

function flattenEntries(entries: ModEntry[]): Mod[] {
  return entries.flatMap((entry) => (entry.kind === 'single' ? [entry.mod] : entry.variants));
}

function entryRepresentativeId(entry: ModEntry): string {
  return entry.kind === 'single' ? entry.mod.id : entry.primary.id;
}

function SortableModEntry({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.32 : undefined,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      className={disabled ? undefined : 'cursor-grab active:cursor-grabbing'}
      style={style}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function entryFilesByEnabledState(entry: ModEntry, enabled: boolean): Mod[] {
  if (entry.kind === 'single') {
    return entry.mod.enabled === enabled ? [entry.mod] : [];
  }
  return entry.variants.filter((variant) => variant.enabled === enabled);
}

// Only enabled mods hold pakNN load-order slots; disabled mods live in
// .disabled/ with free-form names and aren't loaded by the game. Compacting
// must cover the enabled mods alone, otherwise the disabled ones inflate the
// load order past the 99-slot cap and reorderMods rejects the whole operation.
function buildCompactPriorityOrder(entries: ModEntry[]): Mod[] {
  return entries
    .map((entry) => {
      const files = entryFilesByEnabledState(entry, true);
      const priority = files.length > 0
        ? Math.min(...files.map((file) => file.priority))
        : Number.POSITIVE_INFINITY;
      return { files, priority };
    })
    .filter(({ files }) => files.length > 0)
    .sort((a, b) => a.priority - b.priority)
    .flatMap(({ files }) => files);
}

/**
 * Cache of the set of non-archived live file ids per GameBanana mod id,
 * populated by the update-detection effect. Module-scope so it survives page
 * navigation within a session and lets variants of the same mod share one
 * fetch. A value of null means the mod page returned no usable file list.
 */
const updateCheckCache = new Map<number, Set<number> | null>();
let installedPageScrollTop = 0;

// Card-size slider bounds (grid column min-width, in px). The slider replaces
// the old fixed Cards/Compact presets: drag controls how wide each card gets,
// and the layout reflows columns to fit. Below COMPACT_CARD_THRESHOLD cards
// drop to the leaner "compact" treatment (fewer chips, shorter media frame),
// so small sizes stay readable without a separate view mode.
const CARD_SIZE_MIN = 190;
const CARD_SIZE_MAX = 360;
const CARD_SIZE_DEFAULT = 300;
const COMPACT_CARD_THRESHOLD = 255;

export default function Installed() {
  const navigate = useNavigate();
  const {
    settings,
    mods,
    modsLoading,
    modsError,
    modsNotice,
    clearModsNotice,
    loadSettings,
    loadMods,
    toggleMod,
    deleteMod,
    reorderMods,
    editLocalMod,
    setModLockerHero,
    setVariantLabel,
    importCustomMod,
    soundVolume,
    setInstalledScrollTop,
  } = useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);

  // Source mods absorbed into a merged VPK still live on disk (disabled) so
  // unmerge can restore them, but the user shouldn't see them as separate
  // cards: the merged mod is now the source of truth. Build the absorbed
  // fileName set once and derive a filtered view; downstream rendering,
  // reorder, and update checks all run off `visibleMods`.
  const absorbedFileNames = new Set<string>();
  for (const m of mods) {
    if (m.merged?.sources) {
      for (const src of m.merged.sources) absorbedFileNames.add(src.fileName);
    }
  }
  // The Locker cosmetics VPK (applied hero cards) and the Locker sound VPK
  // (applied per-ability sounds) are Locker-managed artifacts, not user-
  // installed mods, so they never show as cards here. They're managed entirely
  // from the Locker's Hero Card / Sounds pickers.
  const visibleMods = mods.filter(
    (m) => !m.lockerCosmetics && !m.lockerSounds && !absorbedFileNames.has(m.fileName)
  );
  // Layout = the user's structural choice (cards grid vs horizontal list).
  // cardSize = grid column min-width driven by the size slider. The effective
  // three-way `viewMode` below is derived from both so the rest of the page
  // (and ModCard) keeps reading a single ViewMode unchanged.
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    const stored = localStorage.getItem('installedLayout');
    if (stored === 'grid' || stored === 'list') return stored;
    // Migrate from the old three-mode key: only 'list' carried structure.
    return localStorage.getItem('installedViewMode') === 'list' ? 'list' : 'grid';
  });
  const [cardSize, setCardSize] = useState<number>(() => {
    const stored = Number(localStorage.getItem('installedCardSize'));
    if (Number.isFinite(stored) && stored >= CARD_SIZE_MIN && stored <= CARD_SIZE_MAX) {
      return stored;
    }
    // Migrate: the old 'compact' preset becomes a small card; anything else
    // (including 'grid' and 'list') lands on the default size.
    return localStorage.getItem('installedViewMode') === 'compact' ? 210 : CARD_SIZE_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem('installedLayout', layout);
  }, [layout]);
  useEffect(() => {
    localStorage.setItem('installedCardSize', String(cardSize));
  }, [cardSize]);
  const viewMode: ViewMode =
    layout === 'list' ? 'list' : cardSize < COMPACT_CARD_THRESHOLD ? 'compact' : 'grid';
  const [search, setSearch] = useState('');
  const [conflictMap, setConflictMap] = useState<Map<string, ModConflict[]>>(new Map());
  // Raw pair count from detectConflicts. conflictMap.size / 2 only works when
  // every mod is in exactly one pair — when one mod conflicts with multiple
  // peers, that math produces fractional or wrong totals.
  const [conflictPairCount, setConflictPairCount] = useState(0);
  // Delete confirmation. `ids` is a list so the same prompt can drive
  // single-mod, group, and bulk-selection deletions.
  const [modToDelete, setModToDelete] = useState<{
    ids: string[];
    name: string;
    isGroup: boolean;
    isBulk?: boolean;
  } | null>(null);
  const [localEditMod, setLocalEditMod] = useState<Mod | null>(null);
  const [customUnknownMod, setCustomUnknownMod] = useState<Mod | null>(null);
  // Sources for the in-progress merge. Non-null means the modal is open.
  const [mergeSources, setMergeSources] = useState<Mod[] | null>(null);
  // Merged mod whose contents are currently being inspected. Non-null means
  // the contents modal is open.
  const [mergedContentsMod, setMergedContentsMod] = useState<Mod | null>(null);
  // Pending unmerge confirmation. Non-null means the confirm dialog is open.
  const [unmergeTarget, setUnmergeTarget] = useState<Mod | null>(null);
  // Result of the most recent unmerge — surfaced when sources were missing on
  // disk so the user can recover via the share code.
  const [unmergeResult, setUnmergeResult] = useState<{ mod: Mod; result: UnmergeModResult; copied: boolean } | null>(null);
  // Brief inline confirmation when the share code is copied. Cleared on a
  // timer; null when no recent copy.
  const [copyToast, setCopyToast] = useState<string | null>(null);

  // Multi-select state. `selectedIds` always stores mod ids (variants of a
  // selected group expand to every variant id) so bulk handlers can iterate
  // directly without re-deriving from entries.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Per-item progress for the in-flight bulk enable/disable. While set, the
  // action bar swaps its buttons for a "Enabling 2/5…" line so users see
  // incremental progress on large selections.
  const [bulkProgress, setBulkProgress] = useState<{
    verb: 'Enabling' | 'Disabling' | 'Tagging';
    done: number;
    total: number;
  } | null>(null);
  // GB id of the group whose picker is open, or null. The actual entry is
  // derived from live `mods` each render so per-file deletes inside the
  // picker reflect immediately without juggling a separate snapshot.
  const [pickerGroupId, setPickerGroupId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [unknownFilterGuess, setUnknownFilterGuess] = useState<{
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
  } | null>(null);
  const [unknownFixMode, setUnknownFixMode] = useState<'single' | 'bulk' | null>(null);
  const [unknownFilterCache, setUnknownFilterCache] = useState<Record<string, UnknownModFilterGuess>>({});
  const [unknownFilterPendingIds, setUnknownFilterPendingIds] = useState<Set<string>>(new Set());
  const [unknownFilterErrors, setUnknownFilterErrors] = useState<Record<string, string>>({});
  const unknownRequestSeqRef = useRef(0);
  const unknownRequestIdsRef = useRef<Record<string, number>>({});

  // Drag-and-drop reorder state. `draggingSection` scopes overlays so dragging
  // an enabled card can't render against a disabled section and vice versa.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<DragSection | null>(null);
  const [dragDraftOrder, setDragDraftOrder] = useState<DragDraftOrder>(null);
  const dropCommitPendingRef = useRef(false);
  const sortableSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Details overlay state
  const [detailsMod, setDetailsMod] = useState<GameBananaModDetails | null>(null);
  const [detailsSection, setDetailsSection] = useState<string>('Mod');
  const [detailsCategoryId, setDetailsCategoryId] = useState<number>(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsUpdateAvailable, setDetailsUpdateAvailable] = useState(false);
  const [detailsIgnoreUpdates, setDetailsIgnoreUpdates] = useState(false);
  const [detailsInstalledFileIds, setDetailsInstalledFileIds] = useState<Set<number>>(new Set());
  // GameBanana fileIds of enabled files in the group. Drives the "Active"
  // badges in the details modal when multiple files are enabled together.
  const [detailsActiveFileIds, setDetailsActiveFileIds] = useState<Set<number>>(new Set());
  const [detailsDates, setDetailsDates] = useState<{ dateAdded: number; dateModified: number } | null>(null);
  // Local id of the installed mod that triggered the overlay. On download we
  // delete this entry first so Update/Reinstall replaces the old VPK instead
  // of installing a second copy alongside it.
  const [detailsSourceModId, setDetailsSourceModId] = useState<string | null>(null);

  // Map of mod id → true if a newer version exists on GameBanana.
  const [updatesAvailable, setUpdatesAvailable] = useState<Set<string>>(new Set());

  // "Update all" confirm + progress. Progress is null when idle, otherwise
  // { done, total } so the button can render "Updating 2/5…" and stay disabled
  // for the duration of the run.
  const [updateAllConfirmOpen, setUpdateAllConfirmOpen] = useState(false);
  const [updateAllProgress, setUpdateAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [updateAllError, setUpdateAllError] = useState<string | null>(null);
  const installedScrollRef = useRef<HTMLDivElement | null>(null);
  const latestInstalledScrollTopRef = useRef(
    installedPageScrollTop || useAppStore.getState().installedScrollTop
  );

  useLayoutEffect(() => {
    const restoreScroll = () => {
      const container = installedScrollRef.current;
      const target = installedPageScrollTop || useAppStore.getState().installedScrollTop;
      if (!container || target <= 0) return;
      container.scrollTop = target;
      latestInstalledScrollTopRef.current = target;
    };
    restoreScroll();
    const frame = window.requestAnimationFrame(restoreScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [modsLoading, mods.length]);

  useEffect(() => {
    const container = installedScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      latestInstalledScrollTopRef.current = container.scrollTop;
      installedPageScrollTop = container.scrollTop;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      setInstalledScrollTop(latestInstalledScrollTopRef.current);
    };
  }, [setInstalledScrollTop]);

  const openModDetails = async (m: typeof mods[number]) => {
    if (!m.gameBananaId) return;
    const section = m.sourceSection ?? 'Mod';
    const categoryId = m.categoryId ?? 0;
    setDetailsLoading(true);
    setDetailsError(null);
    setDetailsSection(section);
    setDetailsCategoryId(categoryId);
    setDetailsSourceModId(m.id);
    // Build the installed-file set from every sibling sharing this GB id,
    // not just the clicked file. Otherwise the modal flags only one row
    // as "Reinstall" when multiple files of the same mod are present -
    // diverging from Browse, which already aggregates correctly.
    const siblingFileIds = new Set<number>();
    const activeFileIds = new Set<number>();
    for (const candidate of mods) {
      if (candidate.gameBananaId !== m.gameBananaId) continue;
      if (typeof candidate.gameBananaFileId !== 'number') continue;
      siblingFileIds.add(candidate.gameBananaFileId);
      if (candidate.enabled) {
        activeFileIds.add(candidate.gameBananaFileId);
      }
    }
    setDetailsInstalledFileIds(siblingFileIds);
    setDetailsActiveFileIds(activeFileIds);
    setDetailsUpdateAvailable(updatesAvailable.has(m.id));
    setDetailsIgnoreUpdates(!!m.ignoreUpdates);
    setDetailsDates(null);
    try {
      const [details, cached] = await Promise.all([
        getModDetails(m.gameBananaId, section),
        window.electronAPI.getCachedMod(m.gameBananaId).catch(() => null),
      ]);
      setDetailsMod(details);
      if (cached) {
        setDetailsDates({ dateAdded: cached.dateAdded, dateModified: cached.dateModified });
      }
    } catch (err) {
      setDetailsError(String(err));
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeModDetails = () => {
    setDetailsMod(null);
    setDetailsError(null);
    setDetailsUpdateAvailable(false);
    setDetailsIgnoreUpdates(false);
    setDetailsSourceModId(null);
    setDetailsActiveFileIds(new Set());
    setDetailsDates(null);
  };

  // Flip the ignoreUpdates flag for the currently-open installed mod and
  // refresh the mods store so the next updatesAvailable recompute (driven by
  // the [mods] useEffect) picks the new flag up. Optimistically toggle the
  // local state first so the pill flips immediately even if the IPC + scan
  // round-trip is slow.
  const handleToggleIgnoreUpdates = async () => {
    if (!detailsSourceModId) return;
    const next = !detailsIgnoreUpdates;
    setDetailsIgnoreUpdates(next);
    try {
      await setModIgnoreUpdates(detailsSourceModId, next);
      await loadMods({ silent: true });
    } catch (err) {
      console.error('[Installed] toggle ignoreUpdates failed:', err);
      setDetailsIgnoreUpdates(!next);
    }
  };

  const inspectUnknownModFilters = async (
    mod: Mod,
    force = false,
    mode: 'single' | 'bulk' = 'single',
    focus = true
  ) => {
    setUnknownFixMode(mode);
    if (unknownFilterPendingIds.has(mod.id) && !force) {
      if (focus) setUnknownFilterGuess({ mod, loading: true });
      return;
    }

    const cached = unknownFilterCache[mod.id];
    if (cached && !force) {
      if (focus) setUnknownFilterGuess({ mod, loading: false, result: cached });
      return;
    }

    const requestId = ++unknownRequestSeqRef.current;
    unknownRequestIdsRef.current[mod.id] = requestId;
    setUnknownFilterPendingIds((prev) => new Set(prev).add(mod.id));
    setUnknownFilterErrors((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    if (focus) setUnknownFilterGuess({ mod, loading: true });
    try {
      const result = await detectUnknownModFilters(mod.id);
      if (unknownRequestIdsRef.current[mod.id] !== requestId) return;
      delete unknownRequestIdsRef.current[mod.id];
      setUnknownFilterPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(mod.id);
        return next;
      });
      if (result.crcMatch.status !== 'error') {
        setUnknownFilterCache((prev) => ({ ...prev, [mod.id]: result }));
      }
      setUnknownFilterGuess((current) =>
        current?.mod.id === mod.id ? { mod: current.mod, loading: false, result } : current
      );
    } catch (err) {
      if (unknownRequestIdsRef.current[mod.id] !== requestId) return;
      delete unknownRequestIdsRef.current[mod.id];
      const message = err instanceof Error ? err.message : String(err);
      setUnknownFilterPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(mod.id);
        return next;
      });
      setUnknownFilterErrors((prev) => ({ ...prev, [mod.id]: message }));
      setUnknownFilterGuess((current) => {
        if (current?.mod.id !== mod.id) return current;
        return {
          mod: current.mod,
          loading: false,
          error: message,
        };
      });
    }
  };

  const openUnknownModFix = (mod: Mod, mode: 'single' | 'bulk' = 'single') => {
    setUnknownFixMode(mode);
    setUnknownFilterGuess({ mod, loading: unknownFilterPendingIds.has(mod.id) });
    // Auto-kick the search when there's no cached result and nothing in
    // flight. Otherwise the user has to click Find inside the modal after
    // already clicking Fix outside — one click too many, and confusing
    // because the modal just sits idle. Suppressed when the experimental
    // matcher is disabled (the modal opens straight to the custom-mod path).
    if (
      autoMatchEnabled &&
      !unknownFilterCache[mod.id] &&
      !unknownFilterPendingIds.has(mod.id)
    ) {
      void inspectUnknownModFilters(mod, false, mode);
    }
  };

  const applyUnknownMatch = async (mod: Mod, match: FoundUnknownMatch) => {
    if (!match.modId || !match.modName) {
      throw new Error('Matched mod is missing GameBanana metadata');
    }
    await applyUnknownModMatch(mod.id, {
      gameBananaId: match.modId,
      modName: match.modName,
      gameBananaFileId: match.fileId,
      sourceFileName: match.fileName,
      sourceSection: match.section,
      categoryName: match.categoryName,
      thumbnailUrl: match.thumbnailUrl,
      nsfw: match.nsfw,
    });
    await loadMods();
    setUnknownFilterCache((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    setUnknownFilterErrors((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    delete unknownRequestIdsRef.current[mod.id];
    setUnknownFilterPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(mod.id);
      return next;
    });
    if (unknownFixMode === 'bulk') {
      const nextUnknown = unknownMods.find((candidate) => candidate.id !== mod.id);
      if (nextUnknown) {
        openUnknownModFix(nextUnknown, 'bulk');
      } else {
        closeUnknownFix();
      }
    } else {
      closeUnknownFix();
    }
  };

  const closeUnknownFix = () => {
    setUnknownFilterGuess(null);
    setUnknownFixMode(null);
  };

  const cancelUnknownMatch = (mod: Mod) => {
    delete unknownRequestIdsRef.current[mod.id];
    void cancelUnknownModDetection(mod.id).catch(() => undefined);
    setUnknownFilterPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(mod.id);
      return next;
    });
    setUnknownFilterErrors((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    setUnknownFilterGuess((current) =>
      current?.mod.id === mod.id ? { mod: current.mod, loading: false, cancelled: true } : current
    );
  };

  const openBulkUnknownFix = (unknowns: Mod[]) => {
    const first = unknowns[0];
    if (!first) return;
    openUnknownModFix(first, 'bulk');
    // Kick searches for the rest in parallel so every row progresses while
    // the user reviews the first one. The queue dedupes against pending/
    // cached, so re-kicking the first mod here is a no-op. Gated behind the
    // experimental flag while the matcher is being reworked. Without it the
    // bulk modal just lists the unknowns so the user can route each one to
    // the manual custom-mod path.
    if (autoMatchEnabled) {
      findAllUnknownMods(unknowns);
    }
  };

  const findAllUnknownMods = (unknowns: Mod[]) => {
    const queued = unknowns.filter(
      (mod) => !unknownFilterPendingIds.has(mod.id) && !unknownFilterCache[mod.id]
    );
    void runUnknownFindQueue(queued);
  };

  const runUnknownFindQueue = async (queued: Mod[]) => {
    let nextIndex = 0;
    const workerCount = Math.min(2, queued.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < queued.length) {
        const mod = queued[nextIndex++];
        await inspectUnknownModFilters(mod, false, 'bulk', false);
      }
    });
    await Promise.all(workers);
  };

  const viewUnknownMatch = (mod: Mod, match: FoundUnknownMatch) => {
    if (!match.modId) return;
    closeUnknownFix();
    void openModDetails({
      ...mod,
      name: match.modName ?? mod.name,
      gameBananaId: match.modId,
      gameBananaFileId: match.fileId,
      sourceSection: match.section,
      categoryName: match.categoryName,
      thumbnailUrl: match.thumbnailUrl,
      nsfw: match.nsfw,
    });
  };

  const makeUnknownCustomMod = (mod: Mod) => {
    closeUnknownFix();
    setCustomUnknownMod(mod);
  };

  const editLocalInstalledMod = async (mod: Mod, args: { name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => {
    await editLocalMod(mod.id, args);
    setUnknownFilterCache((prev) => {
      if (!prev[mod.id]) return prev;
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    setUnknownFilterErrors((prev) => {
      if (!prev[mod.id]) return prev;
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    delete unknownRequestIdsRef.current[mod.id];
    setUnknownFilterPendingIds((prev) => {
      if (!prev.has(mod.id)) return prev;
      const next = new Set(prev);
      next.delete(mod.id);
      return next;
    });
  };

  const handleDetailsDownload = async (fileId: number, fileName: string) => {
    if (!detailsMod) return;
    try {
      // Decide whether this pick replaces the source install or adds a sibling:
      //  - same-file pick = a true reinstall -> replace.
      //  - different-file pick when the source has an update available = a
      //    version update -> delete the old version like "Update all" does, so
      //    the superseded file isn't left lingering (disabled) on disk.
      //  - different-file pick with no update available = an intentional variant
      //    add -> leave the source in place (the download backend auto-disables
      //    the prior enabled sibling instead of deleting it).
      const sourceMod = detailsSourceModId ? mods.find((m) => m.id === detailsSourceModId) : null;
      const pickedIsArchived = !!detailsMod.files?.find((f) => f.id === fileId)?.isArchived;
      const isReinstall = !!sourceMod && sourceMod.gameBananaFileId === fileId;
      // A not-installed, non-archived file picked while the source has an update
      // available is the update target. Guard on !installed so clicking a
      // *different* file the user already owns (a second variant) reinstalls it
      // rather than deleting the source; guard on !archived so picking an old
      // file from the archived list never replaces a newer install.
      const isUpdate =
        !!sourceMod &&
        detailsUpdateAvailable &&
        !detailsInstalledFileIds.has(fileId) &&
        !pickedIsArchived;
      const replacing = isReinstall || isUpdate;
      const restoreEnabled = replacing && !!sourceMod?.enabled;

      if (replacing && sourceMod) {
        // Snapshot before the destructive delete so the user can roll back,
        // matching runUpdate's pre-update snapshot. Non-fatal on failure: a
        // missing snapshot must not block the update the user just asked for.
        try {
          await createSnapshot('pre-update');
        } catch (err) {
          console.warn('[Update] failed to capture pre-update snapshot:', err);
        }
        await deleteMod(sourceMod.id);
      }

      await downloadMod(detailsMod.id, fileId, fileName, detailsSection, detailsCategoryId);

      // Deleting the source removes the only enabled sibling, so the backend's
      // auto-disable promotion never fires and the freshly downloaded file stays
      // in /disabled. Re-enable it so an update/reinstall preserves the source's
      // enabled state instead of silently turning the mod off. (Match by GB ids;
      // the local mod id changes on reinstall.)
      if (restoreEnabled) {
        await loadMods();
        const newMod = useAppStore
          .getState()
          .mods.find((m) => m.gameBananaId === detailsMod.id && m.gameBananaFileId === fileId);
        if (newMod && !newMod.enabled) {
          try {
            await toggleMod(newMod.id);
          } catch (err) {
            console.warn('[Update] failed to re-enable updated mod:', err);
          }
        }
      }

      closeModDetails();
      loadMods();
    } catch (err) {
      setDetailsError(String(err));
    }
  };

  /**
   * Re-download each target mod and restore its pre-update enabled state.
   * Downloads always go to the disabled folder by default, so without the
   * restore step the user would have to manually re-enable every updated mod.
   * Failures are caught per-item so one bad mod doesn't halt the rest.
   * Drives the same `updateAllProgress` state regardless of caller, so the
   * Update-all button reflects per-group updates too.
   */
  const runUpdate = async (targets: typeof mods) => {
    const snapshots = targets
      .filter((m) => m.gameBananaId && typeof m.gameBananaFileId === 'number')
      .map((m) => ({
        oldId: m.id,
        gameBananaId: m.gameBananaId!,
        gameBananaFileId: m.gameBananaFileId!,
        fileName: m.fileName,
        section: m.sourceSection ?? 'Mod',
        categoryId: m.categoryId ?? 0,
        wasEnabled: m.enabled,
      }));
    if (snapshots.length === 0) return;

    // Group by GameBanana mod id so we fetch fresh file metadata once per
    // mod. Reusing each row's stored fileId would 404 whenever an author
    // replaced their upload (new file id) — the most common cause of
    // "update failed" reports.
    const groups = new Map<number, typeof snapshots>();
    for (const s of snapshots) {
      const arr = groups.get(s.gameBananaId) ?? [];
      arr.push(s);
      groups.set(s.gameBananaId, arr);
    }

    setUpdateAllProgress({ done: 0, total: snapshots.length });
    const failures: string[] = [];
    // Track the (gameBananaId, fileId) actually downloaded so re-enable can
    // still find the new install even when we redirected a stale snapshot.
    const completed: { gameBananaId: number; gameBananaFileId: number; wasEnabled: boolean; fileName: string }[] = [];
    let progress = 0;
    // Guard so a multi-group update writes exactly one recovery snapshot, not
    // one per group.
    let snapshotTaken = false;

    for (const [, group] of groups) {
      let details: GameBananaModDetails;
      try {
        details = await getModDetails(group[0].gameBananaId, group[0].section);
      } catch (err) {
        for (const s of group) {
          failures.push(`${s.fileName}: failed to fetch mod details (${String(err)})`);
          progress += 1;
          setUpdateAllProgress({ done: progress, total: snapshots.length });
        }
        continue;
      }

      // Consider only current (non-archived) files, mirroring the update-check
      // effect below. An author's most common "update" is to archive the old
      // version and upload a new current file; counting archived files as live
      // would let the installed-but-now-archived row match Pass 1 1:1, so we'd
      // re-download the same stale file (the mod stays flagged "update
      // available" forever and "Update all" silently no-ops).
      const liveFiles = (details.files ?? []).filter((f) => !f.isArchived);
      const liveFileIds = new Set(liveFiles.map((f) => f.id));

      // Resolve every snapshot to a target file *before* any delete/download
      // runs, so an unrecoverable row keeps its existing install rather than
      // getting deleted into a failed re-download.
      //
      // Pass 1: rows whose stored fileId is still a current file on GameBanana
      // (genuine multi-file mods stay 1:1).
      // Pass 2: rows whose fileId is gone or archived. Fall back to a
      // single-file consolidation only when the mod now ships exactly one
      // current file and no other row already claimed it.
      type Resolution =
        | { ok: true; snapshot: (typeof snapshots)[number]; fileId: number; fileName: string }
        | { ok: false; snapshot: (typeof snapshots)[number]; reason: string };
      const resolutions: Resolution[] = [];
      const claimedIds = new Set<number>();
      for (const s of group) {
        if (liveFileIds.has(s.gameBananaFileId)) {
          resolutions.push({ ok: true, snapshot: s, fileId: s.gameBananaFileId, fileName: s.fileName });
          claimedIds.add(s.gameBananaFileId);
        }
      }
      for (const s of group) {
        if (liveFileIds.has(s.gameBananaFileId)) continue;
        if (liveFiles.length === 1 && !claimedIds.has(liveFiles[0].id)) {
          resolutions.push({ ok: true, snapshot: s, fileId: liveFiles[0].id, fileName: liveFiles[0].fileName });
          claimedIds.add(liveFiles[0].id);
        } else {
          resolutions.push({
            ok: false,
            snapshot: s,
            reason: 'file no longer on GameBanana; mod files changed. Reinstall from Browse.',
          });
        }
      }

      // Capture a recovery snapshot before any delete runs in this group.
      // We only snapshot once per runUpdate invocation (guarded by the
      // `snapshotTaken` flag below), so a 50-mod update writes one file, not
      // one per mod. Failure is non-fatal: a missing snapshot must not block
      // the update the user just clicked.
      if (!snapshotTaken && resolutions.some((r) => r.ok)) {
        snapshotTaken = true;
        try {
          await createSnapshot('pre-update');
        } catch (err) {
          console.warn('[Update] failed to capture pre-update snapshot:', err);
        }
      }

      for (const r of resolutions) {
        if (!r.ok) {
          failures.push(`${r.snapshot.fileName}: ${r.reason}`);
        } else {
          try {
            await deleteMod(r.snapshot.oldId);
            await downloadMod(
              r.snapshot.gameBananaId,
              r.fileId,
              r.fileName,
              r.snapshot.section,
              r.snapshot.categoryId,
            );
            completed.push({
              gameBananaId: r.snapshot.gameBananaId,
              gameBananaFileId: r.fileId,
              wasEnabled: r.snapshot.wasEnabled,
              fileName: r.fileName,
            });
          } catch (err) {
            failures.push(`${r.snapshot.fileName}: ${String(err)}`);
          }
        }
        progress += 1;
        setUpdateAllProgress({ done: progress, total: snapshots.length });
      }
    }

    // Drop touched gbIds from the update-check cache before we re-derive
    // the updatesAvailable set. The cache is module-scoped and never expires
    // otherwise, so the post-update useEffect would otherwise reuse the same
    // liveIds snapshot that flagged the mod in the first place and the
    // "update available" pulse would stick around on the freshly installed
    // file.
    for (const gbId of groups.keys()) {
      updateCheckCache.delete(gbId);
    }

    // Refresh once so the new installs are in the store with their new ids,
    // then re-enable anything that was enabled before. Match by GB ids; the
    // local mod id changes on reinstall.
    await loadMods();
    const refreshed = useAppStore.getState().mods;
    for (const c of completed) {
      if (!c.wasEnabled) continue;
      const newMod = refreshed.find(
        (m) => m.gameBananaId === c.gameBananaId && m.gameBananaFileId === c.gameBananaFileId,
      );
      if (newMod && !newMod.enabled) {
        try {
          await toggleMod(newMod.id);
        } catch (err) {
          failures.push(`re-enable ${c.fileName}: ${String(err)}`);
        }
      }
    }
    setUpdateAllProgress(null);
    if (failures.length > 0) {
      setUpdateAllError(`${failures.length} mod${failures.length === 1 ? '' : 's'} failed to update. See console for details.`);
      console.warn('[Update] failures:', failures);
    }
  };

  const handleUpdateAll = async () => {
    setUpdateAllConfirmOpen(false);
    setUpdateAllError(null);
    await runUpdate(mods.filter((m) => updatesAvailable.has(m.id)));
  };

  /**
   * Update every flagged variant within one grouped mod. Invoked from the
   * variant picker so the user doesn't have to bounce out to the mod page.
   */
  const handleUpdateGroup = async (gameBananaId: number) => {
    setUpdateAllError(null);
    await runUpdate(
      mods.filter((m) => m.gameBananaId === gameBananaId && updatesAvailable.has(m.id)),
    );
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleDeleteConfirm = async () => {
    if (!modToDelete) return;
    const wasBulk = !!modToDelete.isBulk;
    // Sequential to keep priority renames coherent — parallel deletes have
    // raced renameVpks before.
    for (const id of modToDelete.ids) {
      await deleteMod(id);
    }
    setModToDelete(null);
    if (wasBulk) exitSelectMode();
  };

  const toggleEntrySelection = (entry: ModEntry) => {
    const ids = entry.kind === 'single' ? [entry.mod.id] : entry.variants.map((v) => v.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const isEntrySelected = (entry: ModEntry): boolean => {
    if (entry.kind === 'single') return selectedIds.has(entry.mod.id);
    return entry.variants.length > 0 && entry.variants.every((v) => selectedIds.has(v.id));
  };

  // Recomputed each render — cheap, and ensures action-bar counts/labels
  // track the live `mods` state after each bulk toggle.
  const selectedMods = mods.filter((m) => selectedIds.has(m.id));
  const selectedEnabledCount = selectedMods.filter((m) => m.enabled).length;
  const selectedDisabledCount = selectedMods.length - selectedEnabledCount;

  const handleBulkEnable = async () => {
    // Snapshot the work list before the loop so the progress total stays
    // stable even as `mods` updates after each toggle.
    const targets = selectedMods.filter((m) => !m.enabled);
    if (targets.length === 0) {
      exitSelectMode();
      return;
    }
    setBulkProgress({ verb: 'Enabling', done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const ok = await toggleMod(targets[i].id);
      setBulkProgress({ verb: 'Enabling', done: i + 1, total: targets.length });
      // Stop the batch as soon as we hit the 99-enabled cap rather than firing
      // a failing enable for every remaining selection.
      if (!ok) break;
    }
    setBulkProgress(null);
    exitSelectMode();
  };

  const handleBulkDisable = async () => {
    const targets = selectedMods.filter((m) => m.enabled);
    if (targets.length === 0) {
      exitSelectMode();
      return;
    }
    setBulkProgress({ verb: 'Disabling', done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      await toggleMod(targets[i].id);
      setBulkProgress({ verb: 'Disabling', done: i + 1, total: targets.length });
    }
    setBulkProgress(null);
    exitSelectMode();
  };

  // Bulk lockerHero retag. Writes the manual tag for every selected mod and
  // refreshes — Locker grouping picks the change up on its next mods read.
  // Pass null to clear the manual tag and fall back to title/category inference.
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tagMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setTagMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTagMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [tagMenuOpen]);

  const handleBulkTag = async (heroName: string | null) => {
    if (selectedMods.length === 0) return;
    setTagMenuOpen(false);
    const targets = [...selectedMods];
    setBulkProgress({ verb: 'Tagging', done: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await setModLockerHero(targets[i].id, heroName);
        setBulkProgress({ verb: 'Tagging', done: i + 1, total: targets.length });
      }
    } catch (err) {
      console.error('[Installed] Bulk tag failed:', err);
    } finally {
      setBulkProgress(null);
      exitSelectMode();
    }
  };

  const handleBulkClearTag = async () => {
    if (selectedMods.length === 0) return;
    setTagMenuOpen(false);
    const targets = [...selectedMods];
    setBulkProgress({ verb: 'Tagging', done: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await setModLockerHero(targets[i].id, null);
        await setModGlobalType(targets[i].id, null);
        setBulkProgress({ verb: 'Tagging', done: i + 1, total: targets.length });
      }
      await loadMods();
    } catch (err) {
      console.error('[Installed] Bulk tag clear failed:', err);
    } finally {
      setBulkProgress(null);
      exitSelectMode();
    }
  };

  // Bulk-assign a Global (non-hero) cosmetic type to the selection, used when
  // the VPK-path classifier missed a mod or filed it wrong. Mirrors handleBulkTag
  // but writes the globalType axis; the main-process handler clears any hero tag.
  const handleBulkTagGlobal = async (globalType: GlobalModType) => {
    if (selectedMods.length === 0) return;
    setTagMenuOpen(false);
    const targets = [...selectedMods];
    setBulkProgress({ verb: 'Tagging', done: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await setModGlobalType(targets[i].id, globalType);
        setBulkProgress({ verb: 'Tagging', done: i + 1, total: targets.length });
      }
      await loadMods();
    } catch (err) {
      console.error('[Installed] Bulk global tag failed:', err);
    } finally {
      setBulkProgress(null);
      exitSelectMode();
    }
  };

  const openBulkDeleteConfirm = () => {
    if (selectedMods.length === 0) return;
    setModToDelete({
      ids: selectedMods.map((m) => m.id),
      name: `${selectedMods.length} mod${selectedMods.length === 1 ? '' : 's'}`,
      isGroup: false,
      isBulk: true,
    });
  };

  // Open the merge modal with the current selection. Skips sources that are
  // themselves merged mods (the backend rejects those anyway) — surfacing it
  // in the disabled state of the button is cleaner than letting the user
  // submit and get an error.
  const openBulkMerge = () => {
    if (selectedMods.length < 2) return;
    setMergeSources(selectedMods);
  };

  const handleMergeConfirm = async ({
    modIds,
    name,
    strict,
  }: {
    modIds: string[];
    name: string;
    strict: boolean;
  }) => {
    if (!mergeSources) return;
    await mergeMods({ modIds, name, strict });
    setMergeSources(null);
    await loadMods();
    exitSelectMode();
  };

  const handleUnmergeConfirm = async () => {
    if (!unmergeTarget) return;
    const target = unmergeTarget;
    setUnmergeTarget(null);
    try {
      const result = await unmergeMod(target.id);
      await loadMods();
      // Surface the missing-sources recovery dialog only when something
      // actually went missing; the common case is a clean unmerge with
      // every source restored. We write the share code to the clipboard
      // BEFORE opening the dialog so its "is on your clipboard now" copy
      // is true regardless of whether the user clicks OK or Close.
      if (result.missingSourceFileNames.length > 0) {
        let copied = false;
        try {
          await navigator.clipboard.writeText(result.shareCode);
          copied = true;
        } catch (err) {
          console.error('[Installed] clipboard write failed:', err);
        }
        setUnmergeResult({ mod: target, result, copied });
      }
    } catch (err) {
      console.error('[Installed] unmerge failed:', err);
      setCopyToast(`Unmerge failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCopyShareCode = async (mod: Mod) => {
    if (!mod.merged?.shareCode) return;
    try {
      await navigator.clipboard.writeText(mod.merged.shareCode);
      setCopyToast('Share code copied');
    } catch (err) {
      console.error('[Installed] clipboard write failed:', err);
      setCopyToast(`Couldn't copy: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Extract one source out of the open merged mod back to a standalone mod.
  // Errors propagate to the modal, which surfaces them inline; on success we
  // refresh the mod list and either re-sync the modal with the rebuilt merge or
  // close it when the merge collapsed (fewer than two sources left).
  const handleExtractMergeSource = async (source: MergedModSource) => {
    if (!mergedContentsMod) return;
    const result = await extractMergeSource(mergedContentsMod.id, source.fileName);
    await loadMods({ silent: true });
    if (result.collapsed) {
      setMergedContentsMod(null);
      setCopyToast(`Merge dissolved (extracted ${source.modName})`);
      return;
    }
    setMergedContentsMod(result.merged);
    setCopyToast(`Extracted ${source.modName}`);
  };

  // Auto-dismiss the copy toast after a short read time.
  useEffect(() => {
    if (!copyToast) return;
    const id = window.setTimeout(() => setCopyToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [copyToast]);

  // Surface a non-fatal store notice (e.g. the 99-enabled cap) through the same
  // transient toast, then clear it from the store so it doesn't re-fire.
  useEffect(() => {
    if (!modsNotice) return;
    setCopyToast(modsNotice);
    clearModsNotice();
  }, [modsNotice, clearModsNotice]);


  /**
   * Flip a single variant's enabled state. Variants are independent — a
   * mod's model VPK and its voice-lines VPK (same archive) or its red and
   * blue uploads (different archives on the same mod page) can each be on
   * or off without affecting the others. Sequential just because the store
   * action is single-mod.
   */
  const toggleVariant = async (target: Mod) => {
    await toggleMod(target.id);
  };

  const setGroupEnabled = async (group: Extract<ModEntry, { kind: 'group' }>, enabled: boolean) => {
    for (const v of group.variants) {
      if (v.enabled !== enabled) {
        await toggleMod(v.id);
      }
    }
  };

  const disableEntireGroup = async (group: Extract<ModEntry, { kind: 'group' }>) => {
    await setGroupEnabled(group, false);
  };

  /** Top-level toggle on a grouped card. If anything is enabled, disable the
   *  whole group; otherwise open the picker so the user can choose the files. */
  const handleGroupToggle = async (group: Extract<ModEntry, { kind: 'group' }>) => {
    if (group.enabledVariants.length > 0) {
      await setGroupEnabled(group, false);
    } else {
      setPickerGroupId(group.gameBananaId);
    }
  };

  /**
   * Reorder a variant relative to one of its picker-siblings. Used by both
   * the chevron up/down buttons and the picker's drag-and-drop. Returns
   * early when the neighbor lives in a different section — cross-section
   * moves would silently flip a variant's on/off status, which the picker
   * UI explicitly blocks.
   *
   * The picker shows a group's variants sorted by priority, so the
   * before/after semantics match what the user sees: drop "before" puts
   * the source at the neighbor's slot (loads earlier); drop "after" puts
   * it just past the neighbor (loads later, wins overlapping files).
   *
   * Implementation: splice the source out of its section list, re-find the
   * neighbor's index (it may have shifted when source was removed), splice
   * the source back in before/after the neighbor, then pass the full
   * filename list to reorderMods. The backend renumbers densely 1..N
   * inside each section, so the index changes manifest as pak##_ renames
   * on disk.
   */
  const reorderVariantTo = async (
    source: Mod,
    neighbor: Mod,
    position: ReorderPosition
  ) => {
    if (source.id === neighbor.id) return;
    if (source.enabled !== neighbor.enabled) return;

    // Use `visibleMods` so absorbed merge sources aren't passed to
    // reorderMods — their fileNames are recorded in the merged mod's
    // manifest, and a rename would silently break unmerge recovery.
    const enabledMods = visibleMods.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
    const disabledMods = visibleMods.filter((m) => !m.enabled).sort((a, b) => a.priority - b.priority);
    const section = source.enabled ? enabledMods : disabledMods;
    const next = section.slice();
    const srcIdx = next.findIndex((m) => m.id === source.id);
    if (srcIdx === -1) return;
    next.splice(srcIdx, 1);
    const neighborIdx = next.findIndex((m) => m.id === neighbor.id);
    if (neighborIdx === -1) return;
    const insertAt = position === 'before' ? neighborIdx : neighborIdx + 1;
    next.splice(insertAt, 0, source);
    const unchanged = next.every((m, i) => m.id === section[i]?.id);
    if (unchanged) return;

    const full = source.enabled
      ? [...next, ...disabledMods]
      : [...enabledMods, ...next];
    await reorderMods(full.map((m) => m.fileName));
  };

  /**
   * Convenience wrapper for the chevron buttons in the variant picker.
   * "Up" / "down" map to swapping with the picker-neighbor in the obvious
   * direction; reorderVariantTo handles the section-safety check.
   */
  const moveVariant = async (
    group: Extract<ModEntry, { kind: 'group' }>,
    target: Mod,
    direction: 'up' | 'down'
  ) => {
    const reorderableSiblings = group.variants.filter((v) => v.enabled === target.enabled);
    const idxInPicker = reorderableSiblings.findIndex((v) => v.id === target.id);
    if (idxInPicker === -1) return;
    const neighborIdx = direction === 'up' ? idxInPicker - 1 : idxInPicker + 1;
    if (neighborIdx < 0 || neighborIdx >= reorderableSiblings.length) return;
    const neighbor = reorderableSiblings[neighborIdx];
    await reorderVariantTo(target, neighbor, direction === 'up' ? 'before' : 'after');
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods({ silent: useAppStore.getState().modsLoaded });
    }
  }, [activeDeadlockPath, loadMods]);

  // Ctrl/Cmd+A: enter select mode (if not already) and select every visible
  // mod after search filtering. Must live above the early returns below so
  // the hook order is stable across renders. The handler reads the latest
  // `selectAllVisible` and `selectMode` via refs that are assigned
  // synchronously further down, after `selectAllVisible` is declared.
  const selectAllVisibleRef = useRef<() => void>(() => {});
  const selectModeRef = useRef(selectMode);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 'a' && e.key !== 'A') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Don't hijack Ctrl+A while the user is in a text field: the search
      // bar and any inline editors should keep their native select-all.
      if (tag === 'input' || tag === 'textarea' || (target?.isContentEditable ?? false)) {
        return;
      }
      e.preventDefault();
      if (!selectModeRef.current) setSelectMode(true);
      selectAllVisibleRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Refresh the mod list whenever any download completes — covers 1-Click
  // protocol installs (no UI navigation triggers loadMods) and the regular
  // Browse → Download flow when the user is already on this page.
  useEffect(() => {
    if (!activeDeadlockPath) return;
    const unsubscribe = window.electronAPI.onDownloadComplete(() => {
      loadMods();
    });
    return unsubscribe;
  }, [activeDeadlockPath, loadMods]);

  useEffect(() => {
    const loadConflictData = async () => {
      try {
        const conflicts = await getConflicts();
        const map = new Map<string, ModConflict[]>();
        for (const conflict of conflicts) {
          const existingA = map.get(conflict.modA) || [];
          existingA.push(conflict);
          map.set(conflict.modA, existingA);
          const existingB = map.get(conflict.modB) || [];
          existingB.push(conflict);
          map.set(conflict.modB, existingB);
        }
        setConflictMap(map);
        setConflictPairCount(conflicts.length);
      } catch {
        setConflictMap(new Map());
        setConflictPairCount(0);
      }
    };
    if (mods.length > 0) {
      loadConflictData();
    }
  }, [mods]);

  // Flag a mod when its stored gameBananaFileId is no longer in the live
  // non-archived file list. That is the only case runUpdate can meaningfully
  // act on: Pass 1 reinstalls when the id is still live (no real change), and
  // Pass 2 only swaps when the id is gone and a single replacement exists.
  // Matching that definition avoids false positives from page-only edits and
  // from authors adding alternate variants alongside an installed file.
  useEffect(() => {
    let cancelled = false;
    const checkUpdates = async () => {
      // Absorbed merge sources are intentionally excluded: updating them on
      // disk would leave the merged VPK stale, so we don't flag updates the
      // user can't act on without unmerging first.
      // Mods with `ignoreUpdates` set are excluded too: the user pinned the
      // installed version on purpose (e.g. the author replaced the file with
      // one they don't want) and shouldn't see the pulse.
      const targets = visibleMods.filter(
        (m) =>
          !!m.gameBananaId &&
          typeof m.gameBananaFileId === 'number' &&
          m.gameBananaFileId > 0 &&
          !m.ignoreUpdates,
      );
      if (targets.length === 0) {
        setUpdatesAvailable(new Set());
        return;
      }

      // One fetch per GB mod id; variants share the result.
      const uniqueIds = new Map<number, string>();
      for (const m of targets) {
        if (!uniqueIds.has(m.gameBananaId!)) {
          uniqueIds.set(m.gameBananaId!, m.sourceSection ?? 'Mod');
        }
      }

      // Cap concurrency. An unbounded Promise.all here bursts N parallel
      // requests through the rate limiter and pins ~N JSON payloads in
      // renderer memory; with 70+ installed mods that visibly stalls the
      // page on mount. The slim getModFileList only pulls _idRow + _aFiles.
      const queue = Array.from(uniqueIds.entries()).filter(
        ([gbId]) => !updateCheckCache.has(gbId),
      );
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const idx = cursor++;
          if (idx >= queue.length) return;
          const [gbId, section] = queue[idx];
          try {
            const list = await getModFileList(gbId, section);
            const liveIds = new Set(
              list.files.filter((f) => !f.isArchived).map((f) => f.id),
            );
            updateCheckCache.set(gbId, liveIds.size > 0 ? liveIds : null);
          } catch {
            // Network or API failure: leave uncached so a later mount retries.
          }
        }
      };
      const concurrency = Math.min(5, queue.length);
      await Promise.all(Array.from({ length: concurrency }, worker));

      if (cancelled) return;
      const available = new Set<string>();
      for (const mod of targets) {
        const liveIds = updateCheckCache.get(mod.gameBananaId!);
        if (!liveIds) continue;
        if (!liveIds.has(mod.gameBananaFileId!)) {
          available.add(mod.id);
        }
      }
      setUpdatesAvailable(available);
    };
    checkUpdates();
    return () => {
      cancelled = true;
    };
    // `visibleMods` is derived from `mods` and changes only when `mods`
    // does; listing it directly would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods]);

  if (!activeDeadlockPath) {
    return (
      <EmptyState
        icon={Package}
        title="No Game Path Set"
        description="Configure your Deadlock installation path or enable dev mode to start managing mods."
        action={
          <Button onClick={() => navigate('/settings')} icon={Settings}>
            Open Settings
          </Button>
        }
      />
    );
  }

  if (modsLoading) {
    return <InstalledSkeleton viewMode={viewMode} cardSize={cardSize} />;
  }

  if (modsError) {
    return (
      <EmptyState
        icon={Package}
        title="Error Loading Mods"
        description={modsError ?? undefined}
        variant="error"
        action={<Button onClick={() => loadMods()}>Retry</Button>}
      />
    );
  }

  // Group variants sharing a GB mod id under a single card. Singletons and
  // custom imports (no GB id) keep their old card behavior. Absorbed merge
  // sources are excluded — they're represented by the merged mod card.
  const allEntries = buildModEntries(visibleMods);
  const enabledEntries = allEntries
    .filter(isEntryEnabled)
    .sort((a, b) => entrySortPriority(a) - entrySortPriority(b));
  const disabledEntries = allEntries
    .filter((e) => !isEntryEnabled(e))
    .sort((a, b) => entrySortPriority(a) - entrySortPriority(b));
  const compactOrder = buildCompactPriorityOrder(allEntries);
  const conflictCount = conflictPairCount;
  const unknownMods = mods
    .filter((mod) => mod.isUnknown)
    .sort((a, b) => a.priority - b.priority);
  // Auto-matching against GameBanana (CRC + filter search) is the rate-
  // limited path. Gated behind an experimental toggle while it's being
  // reworked; when off, only the manual "Make Custom Mod" path is offered.
  const autoMatchEnabled = settings?.experimentalUnknownModMatching ?? false;
  const selectedUnknownState = unknownFilterGuess
    ? {
        mod: unknownFilterGuess.mod,
        loading: unknownFilterPendingIds.has(unknownFilterGuess.mod.id),
        result: unknownFilterPendingIds.has(unknownFilterGuess.mod.id)
          ? undefined
          : unknownFilterCache[unknownFilterGuess.mod.id] ?? unknownFilterGuess.result,
        error: unknownFilterPendingIds.has(unknownFilterGuess.mod.id)
          ? undefined
          : unknownFilterErrors[unknownFilterGuess.mod.id] ?? unknownFilterGuess.error,
        cancelled: unknownFilterPendingIds.has(unknownFilterGuess.mod.id) ? false : unknownFilterGuess.cancelled,
      }
    : null;
  // Filter by search query (case-insensitive substring on name). Drag-and-drop
  // reorder is still correct because it targets the full enabled list order,
  // not the filtered view.
  const searchNeedle = search.trim().toLowerCase();
  const matchesSearchEntry = (entry: ModEntry) =>
    !searchNeedle || entryName(entry).toLowerCase().includes(searchNeedle);
  const visibleEnabled = enabledEntries.filter(matchesSearchEntry);
  const visibleDisabled = disabledEntries.filter(matchesSearchEntry);
  const totalMatches = visibleEnabled.length + visibleDisabled.length;

  const selectAllVisible = () => {
    const ids = new Set<string>();
    for (const entry of [...visibleEnabled, ...visibleDisabled]) {
      if (entry.kind === 'single') ids.add(entry.mod.id);
      else entry.variants.forEach((v) => ids.add(v.id));
    }
    setSelectedIds(ids);
  };

  // Keep the Ctrl/Cmd+A handler (installed above) pointed at the latest
  // closures. Synchronous assignment (not useEffect) so the hook count stays
  // stable across the early returns higher up.
  selectAllVisibleRef.current = selectAllVisible;
  selectModeRef.current = selectMode;

  const resetDragState = () => {
    setDraggingKey(null);
    setDraggingSection(null);
    setDragDraftOrder(null);
  };

  const resetDragStateAfterDrop = () =>
    new Promise<void>((resolve) => {
      window.setTimeout(() => {
        resetDragState();
        dropCommitPendingRef.current = false;
        resolve();
      }, DROP_STATE_RESET_DELAY_MS);
    });

  /** Locate the entry that holds a given mod id within a section's entries. */
  const findEntryForModId = (entries: ModEntry[], id: string): ModEntry | undefined => {
    return entries.find((e) =>
      e.kind === 'single' ? e.mod.id === id : e.variants.some((v) => v.id === id)
    );
  };

  const orderEntriesByKeys = (entries: ModEntry[], keys: string[]): ModEntry[] => {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const ordered = keys
      .map((key) => byKey.get(key))
      .filter((entry): entry is ModEntry => !!entry);
    const seen = new Set(ordered.map((entry) => entry.key));
    const missing = entries.filter((entry) => !seen.has(entry.key));
    return [...ordered, ...missing];
  };

  const previewEntriesForDrag = (
    entries: ModEntry[],
    section: DragSection
  ): ModEntry[] => {
    if (dragDraftOrder?.section !== section) {
      return entries;
    }
    return orderEntriesByKeys(entries, dragDraftOrder.keys);
  };

  const previewEnabled = previewEntriesForDrag(visibleEnabled, 'enabled');
  const previewDisabled = previewEntriesForDrag(visibleDisabled, 'disabled');

  const sortableEnabled = !searchNeedle && !selectMode;

  const visibleEntriesForSection = (section: DragSection): ModEntry[] =>
    section === 'enabled' ? visibleEnabled : visibleDisabled;

  const previewEntriesForSection = (section: DragSection): ModEntry[] =>
    section === 'enabled' ? previewEnabled : previewDisabled;

  const handleSortableDragStart = ({ active }: DragStartEvent, section: DragSection) => {
    const activeKey = String(active.id);
    const entry = visibleEntriesForSection(section).find((candidate) => candidate.key === activeKey);
    if (!entry) return;
    setDraggingKey(entry.key);
    setDraggingSection(section);
  };

  const handleSortableDragEnd = async ({ active, over }: DragEndEvent, section: DragSection) => {
    const activeKey = String(active.id);
    const overKey = over ? String(over.id) : null;
    if (!overKey || activeKey === overKey) {
      resetDragState();
      return;
    }

    const entries = visibleEntriesForSection(section);
    const oldIndex = entries.findIndex((entry) => entry.key === activeKey);
    const newIndex = entries.findIndex((entry) => entry.key === overKey);
    if (oldIndex === -1 || newIndex === -1) {
      resetDragState();
      return;
    }

    const sourceEntry = entries[oldIndex];
    const targetEntry = entries[newIndex];
    const draftKeys = arrayMove(entries.map((entry) => entry.key), oldIndex, newIndex);
    setDragDraftOrder({ section, keys: draftKeys });
    dropCommitPendingRef.current = true;

    await applyReorder(
      entryRepresentativeId(sourceEntry),
      entryRepresentativeId(targetEntry),
      section,
      draftKeys
    ).then(resetDragStateAfterDrop, resetDragStateAfterDrop);
  };

  /**
   * Entry-aware drag reorder. Singles move one mod; groups move all their
   * files as a block, keeping internal priority order. After the reshuffle
   * we flatten back to a filename list and hand it to reorderMods, which
   * renames pak##_ prefixes to lock in new priorities.
   */
  const applyReorder = async (
    sourceId: string,
    targetId: string,
    section: DragSection,
    draftKeys: string[]
  ): Promise<boolean> => {
    if (sourceId === targetId) return false;
    const entries = section === 'enabled' ? enabledEntries : disabledEntries;
    const sourceEntry = findEntryForModId(entries, sourceId);
    const targetEntry = findEntryForModId(entries, targetId);
    if (!sourceEntry || !targetEntry || sourceEntry.key === targetEntry.key) return false;

    const orderedEntries = orderEntriesByKeys(entries, draftKeys);
    const next = flattenEntries(orderedEntries);
    const prev = flattenEntries(entries);
    if (next.length !== prev.length) return false;
    const unchanged = next.every((m, i) => m.id === prev[i]?.id);
    if (unchanged) return false;

    await reorderMods(next.map((m) => m.fileName));
    return true;
  };

  const fixOrder = () => {
    if (compactOrder.length === 0) return;
    reorderMods(compactOrder.map((m) => m.fileName));
  };

  /**
   * Commit a typed priority from the right-click Load editor. When the target
   * slot is held by another enabled mod we can't just rename (the file would
   * collide), so we rebuild the enabled-section order around the collider and
   * hand it to reorderMods. When moving down, the collider shifts up after the
   * moved mod is removed, so we insert after it; when moving up, we insert
   * before it. That preserves "type N, end at N" semantics.
   *
   * Calls the API directly (not the store wrappers) so errors propagate back
   * to PriorityEditor for inline display instead of being swallowed into
   * modsError.
   */
  const commitPriorityForMod = async (modId: string, newPriority: number): Promise<void> => {
    const mod = mods.find((m) => m.id === modId);
    if (!mod) throw new Error('Mod not found');
    if (mod.priority === newPriority) return;

    const collider = mods.find(
      (m) => m.id !== modId && m.enabled && m.priority === newPriority
    );

    if (!collider) {
      await apiSetModPriority(modId, newPriority);
      await loadMods();
      return;
    }

    const enabled = mods
      .filter((m) => m.enabled)
      .sort((a, b) => a.priority - b.priority);
    const withoutMoved = enabled.filter((m) => m.id !== modId);
    const insertIdx = withoutMoved.findIndex((m) => m.id === collider.id);
    if (insertIdx === -1) {
      // Defensive: collider must be enabled, so this shouldn't trigger.
      // Fall back to the single rename so the user still gets feedback.
      await apiSetModPriority(modId, newPriority);
      await loadMods();
      return;
    }
    const insertAt = mod.priority < newPriority ? insertIdx + 1 : insertIdx;
    const reordered = [
      ...withoutMoved.slice(0, insertAt),
      mod,
      ...withoutMoved.slice(insertAt),
    ];
    await apiReorderMods(reordered.map((m) => m.fileName));
    await loadMods();
  };

  /**
   * Render a single entry as a ModCard. Centralizes both the "single mod"
   * and "grouped variants" paths so the enabled/disabled sections don't
   * each carry a 40-line inline JSX block.
   *
   * Group cards:
   *   - Drag-reorder moves every variant as a contiguous block, preserving
   *     their internal order (applyReorder + buildModEntries handle the
   *     block math). Disabled during search since the visible order doesn't
   *     match the full priority order.
   *   - Toggle disables every enabled file, or opens the picker when none
   *     are enabled yet.
   *   - Delete asks the user to confirm removing every variant.
   *   - Card body click opens the variant picker modal.
   *   - Conflicts shown are the union of conflicts on every currently-enabled
   *     variant.
   */
  const renderEntryCard = (entry: ModEntry) => {
    const entrySelected = isEntrySelected(entry);
    if (entry.kind === 'single') {
      const mod = entry.mod;
      const sourceEntryKey = entry.key;
      return (
        <ModCard
          key={entry.key}
          mod={mod}
          viewMode={viewMode}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          conflicts={conflictMap.get(mod.id) || []}
          soundVolume={soundVolume}
          updateAvailable={updatesAvailable.has(mod.id)}
          entryKey={sourceEntryKey}
          onOpenDetails={
            mod.merged
              ? () => setMergedContentsMod(mod)
              : mod.gameBananaId
                ? () => openModDetails(mod)
                : undefined
          }
          onToggle={() => toggleMod(mod.id)}
          onDelete={() => setModToDelete({ ids: [mod.id], name: mod.name, isGroup: false })}
          onEditLocal={!mod.gameBananaId ? () => setLocalEditMod(mod) : undefined}
          onTagLocker={(heroName) => setModLockerHero(mod.id, heroName)}
          onTagGlobal={async (globalType) => {
            await setModGlobalType(mod.id, globalType);
          }}
          onFixUnknown={mod.isUnknown ? () => openUnknownModFix(mod, 'single') : undefined}
          fixingUnknown={unknownFilterPendingIds.has(mod.id)}
          onCommitPriority={(p) => commitPriorityForMod(mod.id, p)}
          onUnmerge={mod.merged ? () => setUnmergeTarget(mod) : undefined}
          onCopyShareCode={mod.merged ? () => void handleCopyShareCode(mod) : undefined}
          selectMode={selectMode}
          selected={entrySelected}
          onSelectToggle={() => toggleEntrySelection(entry)}
        />
      );
    }
    // Group entry. Stand-in `mod` is the primary so the card visuals look
    // right; the `group` prop tells ModCard to swap filename for file
    // selection metadata and route clicks to the picker.
    const aggregateConflicts: ModConflict[] = [];
    for (const v of entry.variants) {
      if (v.enabled) {
        const c = conflictMap.get(v.id);
        if (c) aggregateConflicts.push(...c);
      }
    }
    const anyUpdateAvailable = entry.variants.some((v) => updatesAvailable.has(v.id));
    const sourceEntryKey = entry.key;
    return (
      <ModCard
        key={entry.key}
        mod={{
          ...entry.primary,
          // Group's overall enable state is "one or more files enabled", not
          // the primary's individual flag (matches sort + section choice).
          enabled: entry.enabledVariants.length > 0,
          // Card meta shows total size across the grouped files.
          size: entry.totalSize,
          installedAt: entry.variants.reduce(
            (latest, v) => (v.installedAt > latest ? v.installedAt : latest),
            entry.primary.installedAt
          ),
        }}
        viewMode={viewMode}
        hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
        conflicts={aggregateConflicts}
        soundVolume={soundVolume}
        updateAvailable={anyUpdateAvailable}
        entryKey={sourceEntryKey}
        onOpenDetails={() => setPickerGroupId(entry.gameBananaId)}
        onToggle={() => handleGroupToggle(entry)}
        onDelete={() =>
          setModToDelete({
            ids: entry.variants.map((v) => v.id),
            name: entry.primary.name,
            isGroup: true,
          })
        }
        onTagLocker={async (heroName) => {
          for (const variant of entry.variants) {
            await setModLockerHero(variant.id, heroName);
          }
        }}
        onTagGlobal={async (globalType) => {
          for (const variant of entry.variants) {
            await setModGlobalType(variant.id, globalType);
          }
        }}
        onCommitPriority={(p) => commitPriorityForMod(entry.primary.id, p)}
        selectMode={selectMode}
        selected={entrySelected}
        onSelectToggle={() => toggleEntrySelection(entry)}
        group={{
          variantCount: entry.variants.length,
          // Display friendly names for enabled files when possible.
          enabledCount: entry.enabledVariants.length,
          enabledLabels: entry.enabledVariants.map((variant) =>
            variant.variantLabel ??
            variant.fileDescription ??
            variant.sourceFileName ??
            variant.fileName
          ),
          onOpenPicker: () => setPickerGroupId(entry.gameBananaId),
        }}
      />
    );
  };

  const renderSortableSection = (section: DragSection) => {
    const entries = previewEntriesForSection(section);
    const activeEntry = draggingSection === section
      ? entries.find((entry) => entry.key === draggingKey)
      : undefined;
    // Grid column min-width is the slider value, so it can't be a static
    // Tailwind arbitrary class (the JIT scanner never sees it). Drive it with
    // an inline style instead. Gap still tracks the compact/grid threshold.
    const gridClasses =
      layout === 'list' ? 'space-y-1.5' : viewMode === 'compact' ? 'grid gap-3' : 'grid gap-4';
    const gridStyle =
      layout === 'list'
        ? undefined
        : { gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` };

    return (
      <DndContext
        sensors={sortableSensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => handleSortableDragStart(event, section)}
        onDragEnd={(event) => {
          void handleSortableDragEnd(event, section);
        }}
        onDragCancel={resetDragState}
      >
        <SortableContext
          items={entries.map((entry) => entry.key)}
          strategy={layout === 'list' ? verticalListSortingStrategy : rectSortingStrategy}
        >
          <div className={gridClasses} style={gridStyle}>
            {entries.map((entry) => (
              <SortableModEntry key={entry.key} id={entry.key} disabled={!sortableEnabled}>
                {renderEntryCard(entry)}
              </SortableModEntry>
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeEntry ? (
            <div className="pointer-events-none opacity-95 shadow-2xl">
              {renderEntryCard(activeEntry)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  };

  // No mods at all
  if (mods.length === 0) {
    return (
      <>
        <EmptyState
          icon={Package}
          title="No Mods Found"
          description="No mods installed yet. Download mods from the Browse tab, import a custom VPK, or manually place VPK files in your addons folder."
          action={
            <div className="flex items-center gap-3">
              <Button onClick={() => navigate('/browse')} icon={Search}>
                Browse Mods
              </Button>
              <Button variant="secondary" onClick={() => setImportOpen(true)} icon={FilePlus}>
                Import Custom Mod
              </Button>
            </div>
          }
        />
        {importOpen && (
          <ImportCustomModModal
            onClose={() => setImportOpen(false)}
            onImport={async (args) => {
              await importCustomMod(args);
            }}
          />
        )}
      </>
    );
  }

  // Conflicts and update-all buttons live on the section header row (next to
  // Fix Order) rather than the top action bar — when both are active the top
  // bar gets cramped, so move them to the line below where there's room.
  const hasStatusButtons =
    conflictCount > 0 || updatesAvailable.size > 0 || !!updateAllProgress || unknownMods.length > 0;
  const statusButtons = hasStatusButtons ? (
    <div className="flex items-center gap-2">
      {conflictCount > 0 && (
        <Button
          variant="warning"
          size="sm"
          onClick={() => navigate('/conflicts')}
          icon={AlertTriangle}
        >
          {conflictPairCount} conflict{conflictPairCount === 1 ? '' : 's'}
        </Button>
      )}
      {(updatesAvailable.size > 0 || updateAllProgress) && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setUpdateAllConfirmOpen(true)}
          icon={Download}
          isLoading={!!updateAllProgress}
          aria-live="polite"
          title={
            updateAllProgress
              ? 'Update in progress. Please wait until all mods finish before starting another.'
              : "Re-download every mod with a newer version on GameBanana and restore each one's enabled state"
          }
        >
          {updateAllProgress
            ? `Updating ${updateAllProgress.done}/${updateAllProgress.total}…`
            : `Update all (${updatesAvailable.size})`}
        </Button>
      )}
      {unknownMods.length > 0 && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => openBulkUnknownFix(unknownMods)}
          icon={Wrench}
          title="Find GameBanana matches or add custom metadata for unknown local mods"
        >
          Fix unknown ({unknownMods.length})
        </Button>
      )}
    </div>
  ) : null;

  return (
    <div ref={installedScrollRef} className="h-full overflow-y-auto px-4 pb-5 sm:px-6">
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-white/5 bg-bg-primary/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-bg-primary/80 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[12rem] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search installed..."
              className={`bg-bg-secondary border border-border rounded-lg pl-8 ${search ? 'pr-8' : 'pr-3'} py-2 text-sm text-text-primary placeholder:text-text-primary/55 focus:outline-none focus:ring-2 focus:ring-accent w-full`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-tertiary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {statusButtons}
            {!searchNeedle && (
              <button
                type="button"
                onClick={fixOrder}
                title="Renumber enabled mods 1, 2, 3, ... to tidy priority slots"
                className="text-[10px] uppercase tracking-wider px-2.5 py-1 border border-white/10 hover:border-accent/50 bg-white/[0.02] hover:bg-accent/10 text-text-secondary hover:text-text-primary rounded-full transition-colors cursor-pointer"
              >
                Fix Order
              </button>
            )}
            <Button
              variant="secondary"
              onClick={() => setImportOpen(true)}
              icon={FilePlus}
              className="!px-2.5"
              aria-label="Add custom mod"
              title="Add custom mod: import a VPK from disk with a custom name and thumbnail"
            />
            <Button
              variant="secondary"
              onClick={() => openModsFolder().catch(() => {})}
              icon={FolderOpen}
              className="!px-2.5"
              aria-label="Open mods folder"
              title="Open mods folder"
            />
            <Button
              variant={selectMode ? 'primary' : 'secondary'}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              icon={CheckSquare}
              disabled={!!bulkProgress}
              className="!px-2.5"
              aria-label={selectMode ? 'Exit selection mode' : 'Select multiple mods'}
              title={selectMode ? 'Exit selection mode' : 'Select multiple mods for bulk delete, enable, or disable'}
            />

            {/* Card-size slider: only meaningful in grid layout, so it's
                disabled (and dimmed) while List is active rather than hidden,
                keeping the toolbar from reflowing as you switch. */}
            <div
              className={`flex items-center gap-2 rounded-sm border border-border bg-bg-secondary px-2 py-1.5 transition-opacity ${
                layout === 'list' ? 'opacity-40' : ''
              }`}
              title="Card size"
            >
              <Grid3x3 className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
              <input
                type="range"
                min={CARD_SIZE_MIN}
                max={CARD_SIZE_MAX}
                step={5}
                value={cardSize}
                disabled={layout === 'list'}
                onChange={(e) => setCardSize(Number(e.target.value))}
                aria-label="Card size"
                className="h-1.5 w-24 cursor-pointer accent-accent disabled:cursor-default"
              />
              <LayoutGrid className="h-5 w-5 flex-shrink-0 text-text-secondary" aria-hidden="true" />
            </div>

            <ViewModeToggle
              value={layout}
              options={[
                { value: 'grid', label: 'Grid view', icon: LayoutGrid },
                { value: 'list', label: 'List view', icon: List },
              ]}
              onChange={(mode) => setLayout(mode === 'list' ? 'list' : 'grid')}
            />
          </div>
        </div>
      </div>

      {searchNeedle && totalMatches === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
          <Search className="w-12 h-12 mb-3 opacity-50" />
          <p className="mb-2">No installed mods match &ldquo;{search}&rdquo;</p>
          <button
            onClick={() => setSearch('')}
            className="mt-1 px-3 py-1.5 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary rounded-lg transition-colors cursor-pointer text-sm"
          >
            Clear search
          </button>
        </div>
      )}

      {visibleEnabled.length > 0 && (
        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-[14px]">
            <SectionHeader count={visibleEnabled.length} className="!mb-0 !text-xs !font-semibold !tracking-[0.06em]">Enabled</SectionHeader>
          </div>
          {renderSortableSection('enabled')}
        </div>
      )}

      {visibleDisabled.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-[14px]">
            <SectionHeader count={visibleDisabled.length} className="!mb-0 !text-xs !font-semibold !tracking-[0.06em]">Disabled</SectionHeader>
            {/* Fall back here when there's nothing in the Enabled section to host the status buttons. */}
            {visibleEnabled.length === 0 && statusButtons}
          </div>
          {renderSortableSection('disabled')}
        </div>
      )}

      <ConfirmModal
        isOpen={updateAllConfirmOpen}
        title={`Update all (${updatesAvailable.size})?`}
        message={
          <>
            <p className="mb-3">
              Re-download every mod flagged with an available update. Each one's enabled state
              will be restored after the install finishes. Downloads run one at a time and may
              take a while.
            </p>
            {(() => {
              const pending = mods.filter((m) => updatesAvailable.has(m.id));
              if (pending.length === 0) return null;
              return (
                <div className="update-stripes border border-accent/20 bg-bg-tertiary/40 rounded-md px-3 py-2 max-h-48 overflow-y-auto">
                  <div className="text-[10px] uppercase tracking-wider text-accent mb-1.5 font-semibold">
                    Mods receiving updates ({pending.length})
                  </div>
                  <ul className="space-y-1 text-sm text-text-primary">
                    {pending.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 min-w-0">
                        <Download className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                        <span className="truncate" title={m.name}>{m.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </>
        }
        confirmLabel={`Update ${updatesAvailable.size}`}
        variant="primary"
        onConfirm={handleUpdateAll}
        onCancel={() => setUpdateAllConfirmOpen(false)}
      />

      {updateAllError && (
        <div
          role="alert"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 max-w-md bg-state-danger/10 border border-state-danger/40 text-state-danger rounded-sm px-4 py-3 shadow-lg flex items-start gap-3 animate-fade-in"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm text-text-primary">{updateAllError}</div>
          <button
            type="button"
            onClick={() => setUpdateAllError(null)}
            className="text-state-danger hover:text-text-primary p-1 -m-1 cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-state-danger"
            aria-label="Dismiss update error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={!!modToDelete}
        title={
          modToDelete?.isBulk
            ? `Delete ${modToDelete.name}?`
            : modToDelete?.isGroup
              ? `Delete ${modToDelete.ids.length} files?`
              : 'Delete Mod?'
        }
        message={
          modToDelete?.isBulk ? (
            <>
              Delete{' '}
              <span className="font-medium text-text-primary">{modToDelete.name}</span>?
              This removes every VPK in the selection and cannot be undone.
            </>
          ) : modToDelete?.isGroup ? (
            <>
              Delete all {modToDelete.ids.length} files from{' '}
              <span className="font-medium text-text-primary">{modToDelete.name}</span>? This
              removes every VPK in the group. To keep some, cancel and use the file picker
              instead.
            </>
          ) : (
            <>
              Are you sure you want to delete{' '}
              <span className="font-medium text-text-primary">{modToDelete?.name}</span>? This
              action cannot be undone.
            </>
          )
        }
        confirmLabel={
          modToDelete?.isBulk
            ? `Delete ${modToDelete.name}`
            : modToDelete?.isGroup
              ? `Delete ${modToDelete.ids.length}`
              : 'Delete'
        }
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setModToDelete(null)}
      />

      {importOpen && (
        <ImportCustomModModal
          onClose={() => setImportOpen(false)}
          onImport={async (args) => {
            await importCustomMod(args);
          }}
        />
      )}

      {localEditMod && (
        <EditLocalModModal
          mod={localEditMod}
          onClose={() => setLocalEditMod(null)}
          onSave={async (args) => {
            await editLocalInstalledMod(localEditMod, args);
            setLocalEditMod(null);
          }}
        />
      )}

      {(() => {
        if (pickerGroupId === null) return null;
        // Derive the live entry from current mods so deletes inside the
        // picker reflect immediately. If the group has disappeared (all
        // files deleted or moved), auto-close the picker.
        const liveEntry = allEntries.find(
          (e) => e.kind === 'group' && e.gameBananaId === pickerGroupId
        ) as Extract<ModEntry, { kind: 'group' }> | undefined;
        if (!liveEntry) {
          // Defer close to avoid setState during render warnings.
          queueMicrotask(() => setPickerGroupId(null));
          return null;
        }
        const liveVariantIds = new Set(liveEntry.variants.map((v) => v.id));
        const conflictsByVariantId = Object.fromEntries(
          liveEntry.variants.map((variant) => {
            const conflicts = (conflictMap.get(variant.id) ?? [])
              .filter((conflict) => {
                const peerId = conflict.modA === variant.id ? conflict.modB : conflict.modA;
                return liveVariantIds.has(peerId);
              })
              .map((conflict) => {
                const peerName = conflict.modA === variant.id ? conflict.modBName : conflict.modAName;
                return `${peerName}: ${conflict.details}`;
              });
            return [variant.id, conflicts];
          })
        );
        const variantsWithUpdate = new Set(
          liveEntry.variants.filter((v) => updatesAvailable.has(v.id)).map((v) => v.id),
        );
        return (
          <VariantPickerModal
            modName={liveEntry.primary.name}
            variants={liveEntry.variants}
            conflictsByVariantId={conflictsByVariantId}
            onToggle={(target) => toggleVariant(target)}
            onMoveVariant={(target, direction) => moveVariant(liveEntry, target, direction)}
            onReorderVariantTo={(source, neighbor, position) =>
              reorderVariantTo(source, neighbor, position)
            }
            onDisableAll={() => disableEntireGroup(liveEntry)}
            onDeleteVariant={(variant) => deleteMod(variant.id)}
            onRenameVariant={(variant, label) => setVariantLabel(variant.id, label)}
            onOpenModDetails={
              liveEntry.primary.gameBananaId
                ? () => {
                    // Stash the picker so the user can return to it after
                    // closing the details modal.
                    setPickerGroupId(null);
                    openModDetails(liveEntry.primary);
                  }
                : undefined
            }
            variantsWithUpdate={variantsWithUpdate}
            onUpdateGroup={
              variantsWithUpdate.size > 0
                ? () => handleUpdateGroup(liveEntry.gameBananaId)
                : undefined
            }
            isUpdating={!!updateAllProgress}
            updateProgress={updateAllProgress}
            onClose={() => setPickerGroupId(null)}
          />
        );
      })()}

      {detailsLoading && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
          onClick={closeModDetails}
        >
          <div
            className="bg-bg-secondary border border-border rounded-xl p-6 flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="text-sm text-text-secondary">Loading mod details...</span>
          </div>
        </div>
      )}

      {detailsError && !detailsMod && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={closeModDetails}
        >
          <div
            className="bg-bg-secondary border border-border rounded-xl p-6 max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-red-400 mb-2">Couldn't load mod details</h3>
            <p className="text-sm text-text-secondary mb-4">{detailsError}</p>
            <div className="flex justify-end">
              <Button onClick={closeModDetails}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {detailsMod && (
        <ModDetailsModal
          mod={detailsMod}
          section={detailsSection}
          installed={true}
          installedFileIds={detailsInstalledFileIds}
          activeFileIds={detailsActiveFileIds}
          downloadingFileId={null}
          extracting={false}
          progress={null}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          dateAdded={detailsDates?.dateAdded}
          dateModified={detailsDates?.dateModified}
          updateAvailable={detailsUpdateAvailable}
          ignoreUpdates={detailsIgnoreUpdates}
          onToggleIgnoreUpdates={handleToggleIgnoreUpdates}
          onClose={closeModDetails}
          onDownload={handleDetailsDownload}
        />
      )}

      {selectedUnknownState && unknownFixMode === 'single' && (
        <UnknownFilterGuessModal
          state={selectedUnknownState}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          autoMatchEnabled={autoMatchEnabled}
          onApplyMatch={applyUnknownMatch}
          onViewMatch={viewUnknownMatch}
          onMakeCustom={makeUnknownCustomMod}
          onFind={(mod) => void inspectUnknownModFilters(mod, false, 'single')}
          onRetry={(mod) => void inspectUnknownModFilters(mod, true, 'single')}
          onCancel={cancelUnknownMatch}
          onClose={closeUnknownFix}
        />
      )}

      {selectedUnknownState && unknownFixMode === 'bulk' && (
        <BulkUnknownFixModal
          unknownMods={unknownMods}
          state={selectedUnknownState}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          autoMatchEnabled={autoMatchEnabled}
          cache={unknownFilterCache}
          pendingIds={unknownFilterPendingIds}
          errors={unknownFilterErrors}
          onSelect={(mod) => openUnknownModFix(mod, 'bulk')}
          onApplyMatch={applyUnknownMatch}
          onViewMatch={viewUnknownMatch}
          onMakeCustom={makeUnknownCustomMod}
          onFindAll={findAllUnknownMods}
          onFind={(mod) => void inspectUnknownModFilters(mod, false, 'bulk')}
          onRetry={(mod) => void inspectUnknownModFilters(mod, true, 'bulk')}
          onCancel={cancelUnknownMatch}
          onClose={closeUnknownFix}
        />
      )}

      {customUnknownMod && (
        <ImportCustomModModal
          title="Make Custom Mod"
          submitLabel="Save Custom Mod"
          initialVpkPath={customUnknownMod.path}
          initialName={deriveModNameFromPath(customUnknownMod.fileName)}
          lockVpk
          vpkHelpText="This VPK is already installed. Saving will only add custom metadata to it."
          onClose={() => setCustomUnknownMod(null)}
          onImport={async ({ name, thumbnailDataUrl, nsfw }) => {
            await applyUnknownCustomMod(customUnknownMod.id, { name, thumbnailDataUrl, nsfw });
            await loadMods();
            setUnknownFilterCache((prev) => {
              const next = { ...prev };
              delete next[customUnknownMod.id];
              return next;
            });
            setUnknownFilterErrors((prev) => {
              const next = { ...prev };
              delete next[customUnknownMod.id];
              return next;
            });
            delete unknownRequestIdsRef.current[customUnknownMod.id];
            setUnknownFilterPendingIds((prev) => {
              const next = new Set(prev);
              next.delete(customUnknownMod.id);
              return next;
            });
            setCustomUnknownMod(null);
          }}
        />
      )}

      {mergeSources && (
        <MergeModsModal
          sources={mergeSources}
          hideNsfw={settings?.hideNsfwPreviews ?? true}
          onCancel={() => setMergeSources(null)}
          onConfirm={handleMergeConfirm}
        />
      )}

      {mergedContentsMod && (
        <MergedContentsModal
          mod={mergedContentsMod}
          hideNsfw={settings?.hideNsfwPreviews ?? true}
          onClose={() => setMergedContentsMod(null)}
          onUnmerge={() => setUnmergeTarget(mergedContentsMod)}
          onExtractSource={handleExtractMergeSource}
        />
      )}

      <ConfirmModal
        isOpen={!!unmergeTarget}
        title="Unmerge mod?"
        message={
          unmergeTarget ? (
            <div className="space-y-2">
              <p>
                <span className="text-text-primary font-medium">{unmergeTarget.name}</span> will be deleted and
                its {unmergeTarget.merged?.sources.length ?? 0} source mod
                {(unmergeTarget.merged?.sources.length ?? 0) === 1 ? '' : 's'} will be restored.
              </p>
              <ul className="text-xs text-text-secondary list-disc pl-5">
                {unmergeTarget.merged?.sources.map((s) => (
                  <li key={s.fileName} className="truncate">{s.modName}</li>
                ))}
              </ul>
            </div>
          ) : null
        }
        variant="danger"
        confirmLabel="Unmerge"
        onConfirm={() => void handleUnmergeConfirm()}
        onCancel={() => setUnmergeTarget(null)}
      />

      {unmergeResult && (
        <ConfirmModal
          isOpen
          title="Some sources were missing"
          message={
            <div className="space-y-2 text-sm">
              <p>
                {unmergeResult.result.recovered.length} source mod
                {unmergeResult.result.recovered.length === 1 ? ' was' : 's were'} restored, but{' '}
                {unmergeResult.result.missingSourceFileNames.length} could not be found on disk.
              </p>
              <p className="text-text-secondary">
                {unmergeResult.copied
                  ? 'The share code captured at merge time is on your clipboard now. Paste it into the portable-profile import flow to re-download the missing sources from GameBanana.'
                  : 'Copying the share code to your clipboard failed. Click "Copy share code" below, then paste it into the portable-profile import flow to re-download the missing sources.'}
              </p>
              <ul className="text-xs text-text-secondary list-disc pl-5 max-h-24 overflow-y-auto">
                {unmergeResult.result.missingSourceFileNames.map((fn) => (
                  <li key={fn} className="font-mono truncate">{fn}</li>
                ))}
              </ul>
            </div>
          }
          confirmLabel={unmergeResult.copied ? 'OK' : 'Copy share code'}
          cancelLabel="Close"
          onConfirm={() => {
            if (!unmergeResult.copied) {
              void navigator.clipboard.writeText(unmergeResult.result.shareCode);
            }
            setUnmergeResult(null);
          }}
          onCancel={() => setUnmergeResult(null)}
        />
      )}

      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] bg-bg-secondary border border-border rounded-lg shadow-lg shadow-black/40 px-4 py-2 text-sm text-text-primary animate-fade-in"
        >
          {copyToast}
        </div>
      )}

      {selectMode && (
        // z-40 keeps this floating bar above the page + sticky header (z-30)
        // but below modal overlays (z-50), so an open modal's backdrop dims it
        // like the rest of the page instead of the bar painting over the modal
        // (e.g. the variant picker overlapping it in a short window).
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-max max-w-[calc(100vw-2rem)] bg-bg-secondary border border-border rounded-xl shadow-lg shadow-black/40 px-3 py-2 flex flex-wrap items-center gap-2">
          {bulkProgress ? (
            <span className="text-sm text-text-primary tabular-nums px-2 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              {bulkProgress.verb} {bulkProgress.done}/{bulkProgress.total}…
            </span>
          ) : (
            <>
              <span className="text-sm text-text-primary tabular-nums px-2">
                {selectedMods.length === 0
                  ? 'No mods selected'
                  : `${selectedMods.length} mod${selectedMods.length === 1 ? '' : 's'} selected`}
              </span>
              <span className="h-5 w-px bg-border" />
              <button
                type="button"
                onClick={selectAllVisible}
                className="text-sm text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-bg-tertiary cursor-pointer"
              >
                Select all
              </button>
              {selectedMods.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-sm text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-bg-tertiary cursor-pointer"
                >
                  Clear
                </button>
              )}
              <span className="h-5 w-px bg-border" />
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedDisabledCount === 0}
                onClick={handleBulkEnable}
                title={selectedDisabledCount === 0 ? 'No disabled mods selected' : `Enable ${selectedDisabledCount} mod${selectedDisabledCount === 1 ? '' : 's'}`}
              >
                Enable{selectedDisabledCount > 0 ? ` (${selectedDisabledCount})` : ''}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedEnabledCount === 0}
                onClick={handleBulkDisable}
                title={selectedEnabledCount === 0 ? 'No enabled mods selected' : `Disable ${selectedEnabledCount} mod${selectedEnabledCount === 1 ? '' : 's'}`}
              >
                Disable{selectedEnabledCount > 0 ? ` (${selectedEnabledCount})` : ''}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  selectedMods.length < 2 ||
                  selectedMods.some((m) => !!m.merged)
                }
                icon={Layers}
                onClick={openBulkMerge}
                title={
                  selectedMods.length < 2
                    ? 'Select 2+ mods to merge'
                    : selectedMods.some((m) => !!m.merged)
                      ? 'Cannot merge an already-merged mod. Unmerge it first.'
                      : `Combine ${selectedMods.length} mods into one VPK`
                }
              >
                Merge{selectedMods.length >= 2 ? ` (${selectedMods.length})` : ''}
              </Button>
              <div className="relative" ref={tagMenuRef}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selectedMods.length === 0}
                  icon={TagIcon}
                  onClick={() => setTagMenuOpen((v) => !v)}
                  title={
                    selectedMods.length === 0
                      ? 'Select mods to tag for the Locker'
                      : `Tag ${selectedMods.length} mod${selectedMods.length === 1 ? '' : 's'} for a hero or Global category in the Locker`
                  }
                >
                  Tag{selectedMods.length > 0 ? ` (${selectedMods.length})` : ''}
                </Button>
                {tagMenuOpen && selectedMods.length > 0 && (
                  <div
                    role="dialog"
                    aria-label="Tag selected mods for the Locker"
                    className="absolute bottom-full mb-2 right-0 z-[60] w-56 max-h-80 overflow-y-auto bg-bg-secondary border border-border rounded-lg shadow-xl p-1 animate-fade-in"
                  >
                    <button
                      type="button"
                      onClick={() => handleBulkClearTag()}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-bg-tertiary text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Clear Locker tag
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      Global
                    </div>
                    {GLOBAL_MOD_TYPE_ORDER.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleBulkTagGlobal(type)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-bg-tertiary text-text-primary cursor-pointer"
                      >
                        {GLOBAL_MOD_TYPE_LABELS[type]}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-border" />
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      Hero
                    </div>
                    {HERO_NAMES.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleBulkTag(name)}
                        className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-bg-tertiary cursor-pointer"
                      >
                        <HeroTagLabel heroName={name} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={selectedMods.length === 0}
                icon={Trash2}
                onClick={openBulkDeleteConfirm}
              >
                Delete{selectedMods.length > 0 ? ` (${selectedMods.length})` : ''}
              </Button>
              <span className="h-5 w-px bg-border" />
              <button
                type="button"
                onClick={exitSelectMode}
                className="p-1.5 text-text-secondary hover:text-text-primary rounded hover:bg-bg-tertiary cursor-pointer"
                aria-label="Exit selection mode"
                title="Exit selection mode"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function InstalledSkeleton({ viewMode, cardSize }: { viewMode: ViewMode; cardSize: number }) {
  const isGridLike = viewMode !== 'list';
  const rows = viewMode === 'compact' ? 12 : viewMode === 'grid' ? 8 : 6;
  return (
    <div className="p-6 animate-fade-in" aria-busy="true" aria-live="polite">
      <div className="flex items-end justify-between gap-4 pb-4 border-b border-border mb-4">
        <div className="space-y-2">
          <div className="skeleton-shimmer bg-bg-tertiary rounded-md h-9 w-52" />
          <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-36" />
        </div>
        <div className="skeleton-shimmer bg-bg-tertiary rounded-lg h-9 w-56" />
      </div>
      <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-20 mb-3" />
      <div
        className={
          viewMode === 'list' ? 'space-y-2' : viewMode === 'compact' ? 'grid gap-3' : 'grid gap-4'
        }
        style={
          isGridLike
            ? { gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }
            : undefined
        }
      >
        {Array.from({ length: rows }).map((_, i) =>
          isGridLike ? (
            <div key={i} className="rounded-lg border border-border bg-bg-secondary p-3 flex flex-col gap-3">
              <div className="skeleton-shimmer w-full aspect-video bg-bg-tertiary rounded-md" />
              <div className="flex items-center gap-3">
                <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-5 h-5" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-shimmer bg-bg-tertiary rounded h-3.5 w-3/4" />
                  <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-1/2" />
                </div>
                <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-11 h-6" />
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-border bg-bg-secondary p-4 flex items-center gap-4">
              <div className="skeleton-shimmer bg-bg-tertiary rounded w-5 h-5" />
              <div className="skeleton-shimmer bg-bg-tertiary rounded-md w-20 h-12 flex-shrink-0" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <div className="skeleton-shimmer bg-bg-tertiary rounded h-3.5 w-1/2" />
                <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-1/3" />
              </div>
              <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-11 h-6" />
              <div className="skeleton-shimmer bg-bg-tertiary rounded-md w-8 h-8" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function UnknownFilterGuessModal({
  state,
  hideNsfwPreviews,
  autoMatchEnabled,
  onApplyMatch,
  onViewMatch,
  onMakeCustom,
  onFind,
  onRetry,
  onCancel,
  onClose,
}: {
  state: {
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
  };
  hideNsfwPreviews: boolean;
  autoMatchEnabled: boolean;
  onApplyMatch: (mod: Mod, match: FoundUnknownMatch) => Promise<void>;
  onViewMatch: (mod: Mod, match: FoundUnknownMatch) => void;
  onMakeCustom: (mod: Mod) => void;
  onFind: (mod: Mod) => void;
  onRetry: (mod: Mod) => void;
  onCancel: (mod: Mod) => void;
  onClose: () => void;
}) {
  const { mod } = state;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unknown-filter-title"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-white/10 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h2 id="unknown-filter-title" className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Wrench className="w-4 h-4 text-orange-400" />
              Fix Unknown Mod
            </h2>
            <p className="text-xs text-text-secondary mt-1 truncate" title={mod.fileName}>
              {mod.fileName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <UnknownMatchPanel
          key={mod.id}
          state={state}
          hideNsfwPreviews={hideNsfwPreviews}
          autoMatchEnabled={autoMatchEnabled}
          onApplyMatch={onApplyMatch}
          onViewMatch={onViewMatch}
          onMakeCustom={onMakeCustom}
          onFind={onFind}
          onRetry={onRetry}
          onCancel={onCancel}
        />

      </div>
    </div>
  );
}

function BulkUnknownFixModal({
  unknownMods,
  state,
  hideNsfwPreviews,
  autoMatchEnabled,
  cache,
  pendingIds,
  errors,
  onSelect,
  onApplyMatch,
  onViewMatch,
  onMakeCustom,
  onFindAll,
  onFind,
  onRetry,
  onCancel,
  onClose,
}: {
  unknownMods: Mod[];
  state: {
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
  };
  hideNsfwPreviews: boolean;
  autoMatchEnabled: boolean;
  cache: Record<string, UnknownModFilterGuess>;
  pendingIds: Set<string>;
  errors: Record<string, string>;
  onSelect: (mod: Mod) => void;
  onApplyMatch: (mod: Mod, match: FoundUnknownMatch) => Promise<void>;
  onViewMatch: (mod: Mod, match: FoundUnknownMatch) => void;
  onMakeCustom: (mod: Mod) => void;
  onFindAll: (mods: Mod[]) => void;
  onFind: (mod: Mod) => void;
  onRetry: (mod: Mod) => void;
  onCancel: (mod: Mod) => void;
  onClose: () => void;
}) {
  const findableCount = unknownMods.filter((mod) => !pendingIds.has(mod.id) && !cache[mod.id]).length;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-unknown-title"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-white/10 rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h2 id="bulk-unknown-title" className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Wrench className="w-4 h-4 text-orange-400" />
              Fix Unknown Mods
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              {unknownMods.length} unknown mod{unknownMods.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {autoMatchEnabled && (
              <Button
                variant="primary"
                size="sm"
                icon={Search}
                disabled={findableCount === 0}
                onClick={() => onFindAll(unknownMods)}
                title="Search every unknown mod that has not already been checked"
              >
                Find all
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[240px_1fr] flex-1">
          <div className="border-r border-white/10 p-3 overflow-y-auto space-y-1.5">
            {unknownMods.map((mod) => {
              const cached = cache[mod.id];
              const cachedMatch = cached?.crcMatch;
              const isSelected = state.mod.id === mod.id;
              const isLoading = pendingIds.has(mod.id);
              const hasError = !!errors[mod.id];
              const statusLabel = isLoading
                ? 'Searching'
                : hasError
                  ? 'Error'
                : cachedMatch?.status === 'found'
                  ? 'Found'
                  : cachedMatch?.status === 'not-found'
                    ? 'No match'
                    : 'Unknown';
              const statusTone = cachedMatch?.status === 'found'
                ? 'text-state-success'
                : hasError
                  ? 'text-state-danger'
                : cachedMatch?.status === 'not-found'
                  ? 'text-text-tertiary'
                  : 'text-text-secondary';

              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => onSelect(mod)}
                  className={`w-full text-left rounded-md border px-3 py-2 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-accent/10 border-accent/40'
                      : 'bg-bg-tertiary/40 border-white/5 hover:bg-bg-tertiary hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">{mod.name}</span>
                    {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent flex-shrink-0" />}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] min-w-0">
                    <span className="font-mono text-text-tertiary truncate" title={mod.fileName}>{mod.fileName}</span>
                    <span className={`flex-shrink-0 ${statusTone}`}>{statusLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <UnknownMatchPanel
            key={state.mod.id}
            state={state}
            hideNsfwPreviews={hideNsfwPreviews}
            autoMatchEnabled={autoMatchEnabled}
            onApplyMatch={onApplyMatch}
            onViewMatch={onViewMatch}
            onMakeCustom={onMakeCustom}
            onFind={onFind}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  );
}

function UnknownMatchPanel({
  state,
  hideNsfwPreviews,
  autoMatchEnabled,
  onApplyMatch,
  onViewMatch,
  onMakeCustom,
  onFind,
  onRetry,
  onCancel,
}: {
  state: {
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
  };
  hideNsfwPreviews: boolean;
  autoMatchEnabled: boolean;
  onApplyMatch: (mod: Mod, match: FoundUnknownMatch) => Promise<void>;
  onViewMatch: (mod: Mod, match: FoundUnknownMatch) => void;
  onMakeCustom: (mod: Mod) => void;
  onFind: (mod: Mod) => void;
  onRetry: (mod: Mod) => void;
  onCancel: (mod: Mod) => void;
}) {
  const { mod, loading, result, error, cancelled } = state;
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const match = result?.crcMatch;
  const foundMatch = isFoundUnknownMatch(match) ? match : null;

  const handleApply = async (matchToApply: FoundUnknownMatch) => {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await onApplyMatch(mod, matchToApply);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const handleRetry = () => {
    if (applying) return;
    setApplyError(null);
    onRetry(mod);
  };

  const handleFind = () => {
    if (applying) return;
    setApplyError(null);
    onFind(mod);
  };

  const handleCancel = () => {
    if (applying) return;
    setApplyError(null);
    onCancel(mod);
  };

  return (
    <div className="p-5 overflow-y-auto space-y-4">
      {loading && (
        <div className="rounded-md bg-bg-tertiary/50 border border-white/5 px-4 py-4 text-sm text-text-secondary flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Loader2 className="w-4 h-4 animate-spin text-accent flex-shrink-0" />
            <span>Finding a matching mod...</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={X}
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {foundMatch && (
        <UnknownMatchCard
          match={foundMatch}
          hideNsfwPreviews={hideNsfwPreviews}
          applying={applying}
          onApply={() => void handleApply(foundMatch)}
          onView={() => onViewMatch(mod, foundMatch)}
          onRetry={autoMatchEnabled ? handleRetry : undefined}
        />
      )}

      {applyError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{applyError}</span>
        </div>
      )}

      {result && match && !foundMatch && (
        <div className="rounded-md bg-bg-tertiary/50 border border-white/5 overflow-hidden">
          <div className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  {match.status === 'error' ? 'Match Check Failed' : 'No Match Found'}
                </div>
                <p className="text-sm text-text-secondary mt-1">
                  {match.reason ?? 'No GameBanana archive matched this local VPK by CRC-32.'}
                </p>
                <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-text-tertiary">
                  <span>{match.checkedMods} mods checked</span>
                  <span>{match.checkedFiles} files checked</span>
                  <span>{match.bytesFetched.toLocaleString()} bytes fetched</span>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-white/5 px-4 py-3 bg-black/10 flex flex-wrap justify-end gap-2">
            {autoMatchEnabled && (
              <Button
                variant="secondary"
                size="sm"
                icon={RotateCcw}
                onClick={handleRetry}
              >
                Retry
              </Button>
            )}
            {match.status !== 'error' && (
              <Button
                variant="secondary"
                size="sm"
                icon={FilePlus}
                onClick={() => onMakeCustom(mod)}
              >
                Make Custom Mod
              </Button>
            )}
          </div>
        </div>
      )}

      {!loading && !error && !result && autoMatchEnabled && (
        <div className="rounded-md bg-bg-tertiary/50 border border-white/5 px-4 py-4 text-sm text-text-secondary flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {cancelled ? (
              <X className="w-4 h-4 text-text-tertiary flex-shrink-0" />
            ) : (
              <Search className="w-4 h-4 text-accent flex-shrink-0" />
            )}
            <span>{cancelled ? 'Search cancelled.' : 'Look for a matching mod from GameBanana.'}</span>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={Search}
            onClick={handleFind}
          >
            Search
          </Button>
        </div>
      )}

      {!loading && !error && !result && !autoMatchEnabled && (
        <div className="rounded-md bg-bg-tertiary/50 border border-white/5 px-4 py-4 space-y-3">
          <div className="flex items-start gap-3 text-sm text-text-secondary">
            <Beaker className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
            <span>
              Automatic GameBanana matching is off. It hits rate limits on larger
              libraries; we're reworking it. Enable it under Settings (Experimental
              Features) once you're ready to retry, or add custom metadata below.
            </span>
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              icon={FilePlus}
              onClick={() => onMakeCustom(mod)}
            >
              Make Custom Mod
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type FoundUnknownMatch = UnknownModFilterGuess['crcMatch'] & { status: 'found' };

function isFoundUnknownMatch(match: UnknownModFilterGuess['crcMatch'] | undefined): match is FoundUnknownMatch {
  return match?.status === 'found';
}

function UnknownMatchCard({
  match,
  hideNsfwPreviews,
  applying,
  onApply,
  onView,
  onRetry,
}: {
  match: FoundUnknownMatch;
  hideNsfwPreviews: boolean;
  applying: boolean;
  onApply: () => void;
  onView: () => void;
  /** Omitted when the experimental matcher is disabled (nothing to retry
   *  against), so the card hides the Retry button entirely. */
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-state-success/35 bg-state-success/10 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-4">
          <ModThumbnail
            src={match.thumbnailUrl}
            alt={match.modName ?? 'GameBanana mod'}
            nsfw={match.nsfw}
            hideNsfw={hideNsfwPreviews}
            className="w-24 h-16 rounded-md bg-bg-primary border border-white/10 flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-state-success">
              Likely Match
            </div>
            <h3 className="text-base font-semibold text-text-primary mt-1 truncate" title={match.modName}>
              {match.modName ?? 'GameBanana mod'}
            </h3>
            {match.fileName && (
              <p className="text-sm text-text-secondary mt-1 truncate" title={match.fileName}>
                {match.fileName}
              </p>
            )}
          </div>
          <Tag tone="success">Exact CRC</Tag>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {match.section && <Tag tone="neutral">{match.section === 'Mod' ? 'Mods' : 'Sounds'}</Tag>}
          {match.categoryName && <Tag tone="neutral">{match.categoryName}</Tag>}
          {typeof match.modId === 'number' && <Tag tone="neutral">Mod #{match.modId}</Tag>}
          {typeof match.fileId === 'number' && <Tag tone="neutral">File #{match.fileId}</Tag>}
        </div>

        {match.reason && (
          <p className="text-xs text-text-secondary mt-3">{match.reason}</p>
        )}

        <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-text-tertiary">
          <span>{match.checkedMods} mods checked</span>
          <span>{match.checkedFiles} files checked</span>
          <span>{match.bytesFetched.toLocaleString()} bytes fetched</span>
          {match.skipped7z > 0 && <span>{match.skipped7z} 7z skipped</span>}
        </div>
      </div>

      <div className="border-t border-state-success/20 px-4 py-3 bg-black/10 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={Info}
          disabled={applying}
          onClick={onView}
        >
          View Mod
        </Button>
        {onRetry && (
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            disabled={applying}
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
        <Button
          variant="success"
          size="sm"
          icon={Check}
          isLoading={applying}
          onClick={onApply}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

interface ModCardProps {
  mod: {
    id: string;
    name: string;
    fileName: string;
    enabled: boolean;
    priority: number;
    size: number;
    installedAt: string;
    thumbnailUrl?: string;
    audioUrl?: string;
    sourceSection?: string;
    categoryName?: string;
    nsfw?: boolean;
    gameBananaId?: number;
    isUnknown?: boolean;
    lockerHero?: string;
    lockerHeroSource?: Mod['lockerHeroSource'];
    globalType?: GlobalModType;
    merged?: import('../types/mod').MergedModInfo;
  };
  viewMode: ViewMode;
  hideNsfwPreviews: boolean;
  conflicts: ModConflict[];
  soundVolume: number;
  updateAvailable?: boolean;
  onOpenDetails?: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onEditLocal?: () => void;
  onTagLocker?: (heroName: string | null) => void | Promise<void>;
  onTagGlobal?: (globalType: GlobalModType | null) => void | Promise<void>;
  onFixUnknown?: () => void;
  fixingUnknown?: boolean;
  /** Collision-tolerant priority commit. Passed through to PriorityEditor so
   *  retyping an already-used slot insert-shifts instead of throwing. */
  onCommitPriority?: (newPriority: number) => Promise<void>;
  /** Open the unmerge confirm flow. Only meaningful when `mod.merged` is set. */
  onUnmerge?: () => void;
  /** Copy the merged mod's share code to the clipboard. */
  onCopyShareCode?: () => void;
  /** When true, the card renders a selection checkbox overlay and clicks
   *  anywhere on the card route to `onSelectToggle` instead of opening
   *  details / firing toggle / delete. */
  selectMode?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
  entryKey?: string;
  /** Present when this card represents grouped files from the same
   *  GameBanana mod. Swaps the filename meta for an enabled/total count and
   *  routes the card-body click to the picker modal. */
  group?: {
    variantCount: number;
    /** Enabled file labels for this group. Empty when fully disabled. */
    enabledCount: number;
    enabledLabels: string[];
    onOpenPicker: () => void;
  };
}

interface ModMediaPreviewProps {
  mod: ModCardProps['mod'];
  hideNsfwPreviews: boolean;
  soundVolume: number;
  overlayBadges: ReactNode;
  mediaSpacingClasses: string;
  mediaFrameClasses: string;
  audioOverlayClasses: string;
  audioPlayerClassName: string;
  onOpenDetails?: () => void;
  isGroupCard: boolean;
}

function SoundPlaceholder() {
  const bars = [6, 10, 15, 21, 27, 19, 13, 23, 29, 18, 11, 16, 24];
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary text-text-secondary">
      <div className="flex h-8 items-end gap-1 opacity-70">
        {bars.map((height, index) => (
          <span
            key={index}
            className="w-1 rounded-full bg-accent/70"
            style={{ height }}
          />
        ))}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary/80">
        Sound Preview
      </span>
    </div>
  );
}

function stopMediaDrag(e: React.DragEvent<HTMLElement>) {
  e.preventDefault();
  e.stopPropagation();
}

function ModMediaPreview({
  mod,
  hideNsfwPreviews,
  soundVolume,
  overlayBadges,
  mediaSpacingClasses,
  mediaFrameClasses,
  audioOverlayClasses,
  audioPlayerClassName,
  onOpenDetails,
  isGroupCard,
}: ModMediaPreviewProps) {
  const isSound = mod.sourceSection === 'Sound' && !!mod.audioUrl;
  const canOpen = !!onOpenDetails;
  // Desaturate + dim the cover art for disabled mods so an "off" card reads
  // differently at a glance. Applied to a wrapper around the media only, so
  // overlay badges (Disabled/Update/Conflict) keep their color.
  const mediaDisabledClass = mod.enabled
    ? ''
    : 'grayscale-[0.6] opacity-[0.7] transition-[filter,opacity] duration-200';
  const detailsLabel = canOpen ? (isGroupCard ? `Choose files for ${mod.name}` : `View details for ${mod.name}`) : undefined;
  // Prefer an explicit mod thumbnail. For sound-only mods without one, fall
  // back to the inferred hero render before using the waveform placeholder.
  // `lockerHero` is persisted from VPK path inference and catches titles that
  // don't name the hero; title matching covers not-yet-enriched mods.
  const soundHeroName = isSound && !mod.thumbnailUrl
    ? mod.lockerHero ?? inferHeroFromTitle(mod.name)
    : null;
  const soundHeroRenderUrl = soundHeroName ? getHeroRenderPath(soundHeroName) : null;
  const soundHeroFacePos = soundHeroName ? getHeroFacePosition(soundHeroName) : 50;
  const image = (
    <ModThumbnail
      src={mod.thumbnailUrl}
      alt={mod.name}
      nsfw={mod.nsfw}
      hideNsfw={hideNsfwPreviews}
      className="w-full h-full"
      imageClassName="origin-center transform-gpu will-change-transform transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
      mergedSources={mod.merged?.sources}
    />
  );
  const soundMedia = mod.thumbnailUrl ? image : soundHeroRenderUrl ? (
    <img
      src={soundHeroRenderUrl}
      alt={soundHeroName ?? mod.name}
      draggable={false}
      className="block h-full w-full object-cover origin-center transform-gpu will-change-transform transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
      style={{ objectPosition: `${soundHeroFacePos}% 25%` }}
    />
  ) : (
    <SoundPlaceholder />
  );

  if (!isSound) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetails?.();
        }}
        disabled={!canOpen}
        className={`group relative w-full ${mediaFrameClasses} bg-bg-tertiary rounded-lg overflow-hidden block border border-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer ${mediaSpacingClasses}`}
        aria-label={detailsLabel}
        data-card-action="true"
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        <div className={`h-full w-full ${mediaDisabledClass}`}>{image}</div>
        {canOpen && (
          <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover:bg-bg-primary/20" />
        )}
        {overlayBadges}
      </button>
    );
  }

  return (
    <div className={`group relative w-full ${mediaFrameClasses} overflow-hidden rounded-lg bg-bg-tertiary border border-white/[0.08] ${mediaSpacingClasses}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetails?.();
        }}
        disabled={!canOpen}
        className="absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
        aria-label={detailsLabel}
        data-card-action="true"
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        <div className={`h-full w-full ${mediaDisabledClass}`}>{soundMedia}</div>
        {(mod.thumbnailUrl || soundHeroRenderUrl) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-bg-primary/80 via-bg-primary/25 to-transparent" />
        )}
        {canOpen && (
          <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover:bg-bg-primary/15" />
        )}
      </button>
      {overlayBadges}
      <div
        className={audioOverlayClasses}
        data-card-action="true"
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <AudioPreviewPlayer
          src={mod.audioUrl!}
          compact
          variant="inline"
          volume={soundVolume}
          className={audioPlayerClassName}
        />
      </div>
    </div>
  );
}

interface ModListRowContentProps {
  mod: ModCardProps['mod'];
  hideNsfwPreviews: boolean;
  soundVolume: number;
  onOpenDetails?: () => void;
  onCommitPriority?: (newPriority: number) => Promise<void>;
  isGroupCard: boolean;
  group?: ModCardProps['group'];
  variantStatusLabel: string | null;
  variantStatusTitle: string;
  metaChipClasses: string;
  manualTagChipClasses: string;
  inferredTagChipClasses: string;
  dangerInlineChipClasses: string;
  accentInlineChipClasses: string;
  tagIconClassName: string;
  technicalMetaClasses: string;
  actions: ReactNode;
}

function lockerHeroSourceLabel(source: Mod['lockerHeroSource']): string {
  switch (source) {
    case 'manual':
      return 'Manual override';
    case 'download-title':
    case 'title':
      return 'Inferred from title';
    case 'download-vpk':
    case 'vpk':
      return 'Inferred from VPK files';
    default:
      return 'Inferred by Grimoire';
  }
}

function ChipText({ children }: { children: ReactNode }) {
  return <span className="relative top-[1.5px] min-w-0 truncate leading-[14px]">{children}</span>;
}

function HeroTagLabel({ heroName, iconClassName = 'h-4 w-4' }: { heroName: string; iconClassName?: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle leading-none">
      <img
        src={getHeroChipIconPath(heroName)}
        alt=""
        aria-hidden="true"
        className={`${iconClassName} block flex-shrink-0 rounded-full object-cover`}
        loading="lazy"
      />
      <ChipText>{heroName}</ChipText>
    </span>
  );
}

function heroNameForLabel(label?: string): string | null {
  if (!label) return null;
  const needle = label.trim().toLowerCase();
  return HERO_NAMES.find((name) => name.toLowerCase() === needle) ?? null;
}

function CategoryChip({
  label,
  className,
  iconClassName = 'h-4 w-4',
}: {
  label: string;
  className: string;
  iconClassName?: string;
}) {
  const heroName = heroNameForLabel(label);
  return (
    <span className={className} title={label}>
      {heroName ? (
        <HeroTagLabel heroName={heroName} iconClassName={iconClassName} />
      ) : (
        <ChipText>{label}</ChipText>
      )}
    </span>
  );
}

function MetaTextChip({ label, className, title }: { label: string; className: string; title?: string }) {
  return (
    <span className={className} title={title ?? label}>
      <ChipText>{label}</ChipText>
    </span>
  );
}

function LockerHeroChip({
  mod,
  manualTagChipClasses,
  inferredTagChipClasses,
  iconClassName = 'h-4 w-4',
}: {
  mod: { lockerHero?: string; lockerHeroSource?: Mod['lockerHeroSource'] };
  manualTagChipClasses: string;
  inferredTagChipClasses: string;
  iconClassName?: string;
}) {
  if (!mod.lockerHero) return null;
  const isManual = mod.lockerHeroSource === 'manual';
  return (
    <span
      className={isManual ? manualTagChipClasses : inferredTagChipClasses}
      title={`${lockerHeroSourceLabel(mod.lockerHeroSource)}: ${mod.lockerHero}`}
    >
      <HeroTagLabel heroName={mod.lockerHero} iconClassName={iconClassName} />
    </span>
  );
}

function ModListRowContent({
  mod,
  hideNsfwPreviews,
  soundVolume,
  onOpenDetails,
  onCommitPriority,
  isGroupCard,
  group,
  variantStatusLabel,
  variantStatusTitle,
  metaChipClasses,
  manualTagChipClasses,
  inferredTagChipClasses,
  dangerInlineChipClasses,
  accentInlineChipClasses,
  tagIconClassName,
  technicalMetaClasses,
  actions,
}: ModListRowContentProps) {
  const isSound = mod.sourceSection === 'Sound' && !!mod.audioUrl;
  const canOpen = !!onOpenDetails;
  const listHeroName = isSound && !mod.thumbnailUrl
    ? mod.lockerHero ?? inferHeroFromTitle(mod.name)
    : null;
  const listHeroRenderUrl = listHeroName ? getHeroRenderPath(listHeroName) : null;
  const listHeroFacePos = listHeroName ? getHeroFacePosition(listHeroName) : 50;

  return (
    <>
      <div className="flex min-w-0 items-center justify-start">
        {mod.enabled ? (
          <span data-card-action="true">
            <PriorityEditor
              modId={mod.id}
              modName={mod.name}
            priority={mod.priority}
            variant="inline"
            onCommit={onCommitPriority}
          />
          </span>
        ) : (
          <span className="inline-flex h-5 items-center rounded border border-white/[0.06] bg-bg-tertiary/60 px-1.5 text-[11px] font-semibold text-text-secondary/70">
            Off
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetails?.();
        }}
        disabled={!canOpen}
        className={`group relative h-10 w-14 flex-shrink-0 overflow-hidden rounded-md bg-bg-tertiary border border-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer transition-[filter,opacity] duration-200 ${
          mod.enabled ? '' : 'grayscale-[0.6] opacity-[0.7]'
        }`}
        aria-label={canOpen ? (isGroupCard ? `Choose files for ${mod.name}` : `View details for ${mod.name}`) : undefined}
        data-card-action="true"
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        {listHeroRenderUrl ? (
          <img
            src={listHeroRenderUrl}
            alt={listHeroName ?? mod.name}
            draggable={false}
            className="block h-full w-full object-cover origin-center transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
            style={{ objectPosition: `${listHeroFacePos}% 25%` }}
          />
        ) : isSound && !mod.thumbnailUrl ? (
          <SoundPlaceholder />
        ) : (
          <ModThumbnail
            src={mod.thumbnailUrl}
            alt={mod.name}
            nsfw={mod.nsfw}
            hideNsfw={hideNsfwPreviews}
            className="w-full h-full"
            imageClassName="origin-center transform-gpu will-change-transform transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
            mergedSources={mod.merged?.sources}
          />
        )}
        {canOpen && (
          <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover:bg-bg-primary/20" />
        )}
      </button>

      <div className="grid min-w-0 grid-rows-[22px_24px]">
        <h3 className="min-w-0 truncate text-[13px] font-semibold leading-[22px] text-text-primary" title={mod.name}>
          {mod.name}
        </h3>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] leading-[24px] text-text-secondary">
          <LockerHeroChip
            mod={mod}
            manualTagChipClasses={manualTagChipClasses}
            inferredTagChipClasses={inferredTagChipClasses}
            iconClassName={tagIconClassName}
          />
          {mod.categoryName && (
            <CategoryChip
              label={mod.categoryName}
              className={metaChipClasses}
              iconClassName={tagIconClassName}
            />
          )}
          {mod.nsfw && (
            <MetaTextChip label="18+" className={dangerInlineChipClasses} />
          )}
          <span className="flex-shrink-0">{formatBytes(mod.size)}</span>
          <span className="flex-shrink-0 tabular-nums" title={`Installed ${formatAbsoluteDate(mod.installedAt)}`}>
            {formatRelativeDate(mod.installedAt)}
          </span>
          {group && (
            <MetaTextChip
              label={`${variantStatusLabel} files`}
              className={accentInlineChipClasses}
              title={variantStatusTitle}
            />
          )}
          {!group && (
            <span className={technicalMetaClasses} title={mod.fileName}>
              {mod.fileName}
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto flex min-w-0 items-center justify-end gap-3">
        {isSound && (
          <div
            className="hidden w-48 min-w-0 flex-shrink items-center rounded-md border border-white/[0.06] bg-bg-secondary/45 px-2 py-1 opacity-85 transition-opacity duration-200 group-hover/card:opacity-100 lg:flex"
            data-card-action="true"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <AudioPreviewPlayer
              src={mod.audioUrl!}
              compact
              variant="inline"
              volume={soundVolume}
              className="w-full gap-2 [&>button:first-of-type]:h-6 [&>button:first-of-type]:w-6 [&>div]:h-1 [&>span]:text-[10px]"
            />
          </div>
        )}
        {actions}
      </div>
    </>
  );
}

function ModCard({
  mod,
  viewMode,
  hideNsfwPreviews,
  conflicts,
  soundVolume,
  updateAvailable,
  onOpenDetails,
  onToggle,
  onDelete,
  onEditLocal,
  onTagLocker,
  onTagGlobal,
  onFixUnknown,
  fixingUnknown,
  onCommitPriority,
  onUnmerge,
  onCopyShareCode,
  selectMode,
  selected,
  onSelectToggle,
  entryKey,
  group,
}: ModCardProps) {
  const hasConflicts = conflicts.length > 0;
  const isGroupCard = !!group;
  const variantStatusLabel = group ? `${group.enabledCount}/${group.variantCount}` : null;
  const enabledTitle = group?.enabledLabels.join(', ') ?? '';
  const variantStatusTitle = group
    ? `${enabledTitle || 'No files enabled'} - click card to choose files`
    : '';
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setTagPickerOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setTagPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const applyLockerTag = async (heroName: string | null) => {
    if (!onTagLocker || menuBusy) return;
    setMenuBusy(true);
    setMenuError(null);
    try {
      await onTagLocker(heroName);
      setMenuOpen(false);
      setTagPickerOpen(false);
    } catch (err) {
      console.error('[Installed] Failed to set locker hero:', err);
      setMenuError(err instanceof Error ? err.message : String(err));
    } finally {
      setMenuBusy(false);
    }
  };

  const applyGlobalTag = async (globalType: GlobalModType) => {
    if (!onTagGlobal || menuBusy) return;
    setMenuBusy(true);
    setMenuError(null);
    try {
      await onTagGlobal(globalType);
      setMenuOpen(false);
      setTagPickerOpen(false);
    } catch (err) {
      console.error('[Installed] Failed to set global locker tag:', err);
      setMenuError(err instanceof Error ? err.message : String(err));
    } finally {
      setMenuBusy(false);
    }
  };

  const clearLockerTag = async () => {
    if (menuBusy) return;
    setMenuBusy(true);
    setMenuError(null);
    try {
      await onTagLocker?.(null);
      await onTagGlobal?.(null);
      setMenuOpen(false);
      setTagPickerOpen(false);
    } catch (err) {
      console.error('[Installed] Failed to clear locker tag:', err);
      setMenuError(err instanceof Error ? err.message : String(err));
    } finally {
      setMenuBusy(false);
    }
  };

  const stateClasses = hasConflicts
    ? 'bg-state-warning/5 border-state-warning/45'
    : mod.enabled
      ? 'bg-[#242424] border-white/[0.08] hover:border-white/[0.14] hover:bg-bg-secondary'
      : 'bg-[#242424]/85 border-white/[0.08] text-text-primary/80 hover:border-white/[0.14] hover:bg-bg-secondary hover:text-text-primary';

  // Glass surface for grid/compact cards: a translucent base over which a
  // blurred copy of the cover art (see glassBackdropUrl) bleeds, so the card
  // is tinted by its own thumbnail. List view keeps the solid stateClasses.
  const glassStateClasses = hasConflicts
    ? 'border-state-warning/45 bg-state-warning/[0.07]'
    : mod.enabled
      ? 'border-white/[0.12] bg-[#141414]/65 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] hover:border-white/[0.2]'
      : 'border-white/[0.08] bg-[#141414]/55 text-text-primary/75 hover:border-white/[0.16] hover:text-text-primary';

  // Merged mods get a "stacked card" silhouette via two offset box-shadows
  // that read as cards-behind-the-card. Uses only neutral surface/border
  // tokens so it stays correct under any accent color the user picks.
  // Suppressed in compact view (cards are too small for the offset to look
  // intentional) and in list view (the card is a horizontal strip).
  const mergedStackShadow =
    mod.merged && viewMode === 'grid'
      ? 'shadow-[3px_3px_0_0_var(--color-bg-secondary),3px_3px_0_1px_var(--color-border),6px_6px_0_0_var(--color-bg-secondary),6px_6px_0_1px_var(--color-border)] mr-1.5 mb-1.5'
      : '';
  const chipMaxClass =
    viewMode === 'compact' ? 'max-w-[152px]' : viewMode === 'list' ? 'max-w-[148px]' : 'max-w-[170px]';
  const chipSizeClasses =
    viewMode === 'list'
      ? 'h-6 rounded-[7px] px-2 text-[11px]'
      : viewMode === 'compact'
        ? 'h-[26px] rounded-lg px-2 text-[12px]'
        : 'h-7 rounded-lg px-2.5 text-[12px]';
  const tagIconClassName =
    viewMode === 'list' ? 'h-[18px] w-[18px]' : viewMode === 'compact' ? 'h-5 w-5' : 'h-[22px] w-[22px]';
  const baseChipClasses = `inline-flex min-w-0 ${chipMaxClass} ${chipSizeClasses} items-center overflow-hidden font-semibold leading-none`;
  const metaChipClasses = `${baseChipClasses} border border-white/[0.06] bg-bg-tertiary/65 text-text-secondary/80`;
  const manualTagChipClasses = `${baseChipClasses} border border-accent/30 bg-accent/10 text-accent`;
  const inferredTagChipClasses = `${baseChipClasses} border border-sky-400/35 bg-sky-500/15 text-sky-100`;
  const dangerInlineChipClasses = `${baseChipClasses} flex-shrink-0 border border-state-danger/40 bg-state-danger/10 text-state-danger`;
  const accentInlineChipClasses = `${baseChipClasses} flex-shrink-0 border border-accent/30 bg-accent/10 text-accent tabular-nums`;
  const technicalMetaClasses = 'min-w-0 truncate font-mono text-[11px] text-text-secondary/55 hover:text-text-secondary cursor-help';
  const utilityActionClasses = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-all duration-200 hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 cursor-pointer disabled:opacity-60';
  const menuItemClasses = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-primary hover:bg-bg-tertiary focus:outline-none focus-visible:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50';
  const dangerMenuItemClasses = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-state-danger hover:bg-state-danger/10 focus:outline-none focus-visible:bg-state-danger/10 disabled:cursor-not-allowed disabled:opacity-50';
  const toggleHitboxClasses = 'inline-flex h-7 w-12 items-center justify-center rounded-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary';
  const toggleTrackClasses = `relative h-6 w-11 rounded-full transition-colors duration-200 ${
    mod.enabled ? 'bg-accent shadow-[0_0_0_1px_rgba(255,122,47,0.25)]' : 'bg-bg-tertiary border border-border group-hover/toggle:border-white/20'
  }`;
  const isList = viewMode === 'list';
  const isCompact = viewMode === 'compact';
  // Cover-art source for the glass backdrop. Skipped when NSFW previews are
  // hidden so we never bleed hidden imagery, even blurred.
  const glassBackdropUrl =
    !isList && mod.thumbnailUrl && !(mod.nsfw && hideNsfwPreviews)
      ? mod.thumbnailUrl
      : null;
  const shellClasses = isList
    ? 'grid min-h-[58px] grid-cols-[52px_64px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-0'
    : isCompact
      ? 'flex flex-col gap-0 p-2'
      : 'flex flex-col gap-0 p-2.5';
  const mediaSpacingClasses = 'mb-2';
  const mediaFrameClasses = isCompact ? 'h-[116px]' : 'aspect-video';
  const audioOverlayClasses = isCompact
    ? 'absolute bottom-2 left-2 right-2 z-20 flex h-[30px] cursor-pointer items-center rounded-md border border-white/[0.10] bg-bg-secondary/75 px-2 shadow-sm backdrop-blur-sm [&_*]:cursor-pointer'
    : 'absolute bottom-2.5 left-3 right-3 z-20 flex h-[34px] cursor-pointer items-center rounded-md border border-white/[0.10] bg-bg-secondary/75 px-2.5 shadow-sm backdrop-blur-sm [&_*]:cursor-pointer';
  const audioPlayerClassName = isCompact
    ? 'w-full gap-2 [&>button:first-of-type]:h-6 [&>button:first-of-type]:w-6 [&>div]:h-1 [&>span]:text-[10px]'
    : 'w-full gap-2.5 [&>button:first-of-type]:h-7 [&>button:first-of-type]:w-7 [&>div]:h-1 [&>span]:text-[10px]';
  const titleClasses = isCompact
    ? 'text-[14px] font-semibold leading-[18px] truncate'
    : 'text-[15px] font-medium leading-[19px] truncate';
  const gridTagsClasses = viewMode === 'compact' ? 'h-[26px] flex-nowrap' : 'h-7 flex-nowrap';
  const showCategoryChip = viewMode !== 'compact' || !mod.lockerHero;
  const compactBaseChipCount =
    (mod.lockerHero ? 1 : 0) + (showCategoryChip && mod.categoryName ? 1 : 0);
  const showNsfwChip = !!mod.nsfw && (!isCompact || compactBaseChipCount < 2);
  const showGroupChip = !!group && (!isCompact || compactBaseChipCount + (showNsfwChip ? 1 : 0) < 2);
  const actions = (
    <div className="ml-auto flex items-center gap-1">
      <div className="relative" ref={menuRef} data-card-action="true">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((open) => !open);
            setTagPickerOpen(false);
            setMenuError(null);
          }}
          className={`${utilityActionClasses} ${isList ? '' : 'opacity-0 group-hover/card:opacity-90 focus:opacity-100 aria-expanded:opacity-100'}`}
          title="More actions"
          aria-label={`More actions for ${mod.name}`}
          aria-expanded={menuOpen}
          data-card-action="true"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute bottom-full right-0 z-[70] mb-2 w-56 rounded-lg border border-border bg-bg-secondary p-1 shadow-xl animate-fade-in"
          >
            {menuError && (
              <div className="mb-1 rounded-md border border-state-danger/30 bg-state-danger/10 px-2 py-1.5 text-xs text-state-danger">
                {menuError}
              </div>
            )}
            {onEditLocal && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onEditLocal();
                }}
                className={menuItemClasses}
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            {onOpenDetails && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onOpenDetails();
                }}
                className={menuItemClasses}
              >
                <Info className="w-3.5 h-3.5" />
                View details
              </button>
            )}
            {(onTagLocker || onTagGlobal) && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagPickerOpen((open) => !open);
                  }}
                  className={menuItemClasses}
                >
                  <TagIcon className="w-3.5 h-3.5" />
                  Set Locker tag
                </button>
                {tagPickerOpen && (
                  <div className="my-1 max-h-64 overflow-y-auto rounded-md border border-border bg-bg-primary/40 p-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void clearLockerTag();
                      }}
                      disabled={menuBusy || (!mod.lockerHero && !mod.globalType)}
                      className="w-full rounded px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear Locker tag
                    </button>
                    <div className="my-1 h-px bg-border" />
                    {onTagGlobal && (
                      <>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                          Global
                        </div>
                        {GLOBAL_MOD_TYPE_ORDER.map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void applyGlobalTag(type);
                            }}
                            disabled={menuBusy}
                            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50 ${
                              mod.globalType === type ? 'text-accent' : 'text-text-primary'
                            }`}
                          >
                            <span className="truncate">{GLOBAL_MOD_TYPE_LABELS[type]}</span>
                            {mod.globalType === type && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                          </button>
                        ))}
                        <div className="my-1 h-px bg-border" />
                      </>
                    )}
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      Hero
                    </div>
                    {HERO_NAMES.map((heroName) => (
                      <button
                        key={heroName}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void applyLockerTag(heroName);
                        }}
                        disabled={menuBusy}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50 ${
                          mod.lockerHero === heroName
                            ? mod.lockerHeroSource === 'manual'
                              ? 'text-accent'
                              : 'text-sky-200'
                            : 'text-text-primary'
                        }`}
                      >
                        <HeroTagLabel heroName={heroName} />
                        {mod.lockerHero === heroName && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {mod.isUnknown && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onFixUnknown?.();
                }}
                disabled={!onFixUnknown}
                className={menuItemClasses}
              >
                {fixingUnknown ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wrench className="w-3.5 h-3.5" />
                )}
                Fix unknown match
              </button>
            )}
            {mod.merged && onCopyShareCode && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onCopyShareCode();
                }}
                className={menuItemClasses}
              >
                <Share2 className="w-3.5 h-3.5" />
                Copy share code
              </button>
            )}
            {mod.merged && onUnmerge && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onUnmerge();
                }}
                className={menuItemClasses}
              >
                <Scissors className="w-3.5 h-3.5" />
                Unmerge
              </button>
            )}
            {/* A merged mod is removed via Unmerge (which deletes the merged VPK
                and restores its sources), so a raw Delete alongside it would be
                redundant and confusing. Non-merged mods keep Delete. */}
            {!mod.merged && (
              <>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className={dangerMenuItemClasses}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
        <button
          onClick={onToggle}
          aria-pressed={mod.enabled}
          aria-label={mod.enabled ? 'Disable mod' : 'Enable mod'}
          title={mod.enabled ? 'Disable mod' : 'Enable mod'}
          className={`${toggleHitboxClasses} group/toggle`}
          data-card-action="true"
        >
          <span className={toggleTrackClasses} aria-hidden>
            <span
              className={`absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-text-primary shadow-sm transition-transform duration-200 ${
                mod.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </span>
        </button>
    </div>
  );
  return (
    <div
      data-mod-entry-key={entryKey}
      className={`group/card relative rounded-[10px] border transform-gpu transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ease-out ${isList ? stateClasses : glassStateClasses} ${mergedStackShadow} ${updateAvailable ? 'update-stripes' : ''} ${shellClasses} ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-primary' : ''}`}
    >
      <div className={isList ? 'contents' : ''}>
        {selectMode && (
        <>
          {/* Full-card click target. Sits above thumbnail button, toggle, and
              delete (their non-positioned containers stack below this absolute
              z-30 element) so every click in select mode lands here. */}
          <button
            type="button"
            onClick={onSelectToggle}
            className="absolute inset-0 z-30 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
            aria-label={selected ? `Deselect ${mod.name}` : `Select ${mod.name}`}
            aria-pressed={!!selected}
          />
          {/* Visible checkbox indicator. pointer-events-none so the overlay
              button below it still receives the click. */}
          <div
            className={`absolute top-2 left-2 z-40 w-6 h-6 rounded-md border-2 transition-colors pointer-events-none flex items-center justify-center shadow-md ${
              selected ? 'bg-accent border-accent' : 'bg-bg-primary/85 border-white/40'
            }`}
          >
            {selected && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
          </div>
        </>
        )}

        {isList ? (
          <ModListRowContent
            mod={mod}
            hideNsfwPreviews={hideNsfwPreviews}
            soundVolume={soundVolume}
            onOpenDetails={onOpenDetails}
            onCommitPriority={onCommitPriority}
            isGroupCard={isGroupCard}
            group={group}
            variantStatusLabel={variantStatusLabel}
            variantStatusTitle={variantStatusTitle}
            metaChipClasses={metaChipClasses}
            manualTagChipClasses={manualTagChipClasses}
            inferredTagChipClasses={inferredTagChipClasses}
            dangerInlineChipClasses={dangerInlineChipClasses}
            accentInlineChipClasses={accentInlineChipClasses}
            tagIconClassName={tagIconClassName}
            technicalMetaClasses={technicalMetaClasses}
            actions={actions}
          />
        ) : (
        <>
        {glassBackdropUrl && (
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[10px]">
            <img
              src={glassBackdropUrl}
              alt=""
              aria-hidden
              draggable={false}
              className={`h-full w-full scale-[1.35] object-cover blur-2xl saturate-[1.4] transition-opacity duration-200 ${
                mod.enabled ? 'opacity-55' : 'opacity-30 grayscale-[0.4]'
              }`}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#0f0f0f]/45 via-[#0f0f0f]/65 to-[#0f0f0f]/[0.88]" />
          </div>
        )}
        {(() => {
        const overlayBadges = (
          <>
            {mod.enabled && !selectMode && (
              <div className="absolute top-2 left-2 z-10 flex h-5 items-start" data-card-action="true">
                <PriorityEditor
                  modId={mod.id}
                  modName={mod.name}
                  priority={mod.priority}
                  variant="overlay"
                  onCommit={onCommitPriority}
                />
              </div>
            )}
            {!mod.enabled && !selectMode && (
              <div className="absolute top-2 left-2 z-10 flex h-5 items-start">
                <Tag tone="neutral" variant="overlay" icon={PowerOff} title="This mod is disabled and not loaded in-game">
                  Disabled
                </Tag>
              </div>
            )}
              <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
              {hasConflicts && (
                <Tag
                  tone="warning"
                  variant="overlay"
                  icon={AlertTriangle}
                  title={conflicts.map((c) => c.details).join(', ')}
                >
                  Conflict
                </Tag>
              )}
              {mod.isUnknown && (
                <Tag
                  variant="overlay"
                  icon={Wrench}
                  title="This local mod has no saved GameBanana or custom metadata"
                  className="border-cyan-300/70 text-cyan-200"
                >
                  Unknown
                </Tag>
              )}
              {updateAvailable && (
                <Tag
                  tone="accent"
                  variant="overlay"
                  icon={Download}
                  title="A newer version is available on GameBanana"
                  className="uppercase tracking-wide"
                >
                  Update
                </Tag>
              )}
              {mod.merged && (
                <Tag
                  variant="overlay"
                  icon={Layers}
                  title={`Merged from ${mod.merged.sources.length} mod${mod.merged.sources.length === 1 ? '' : 's'}. Open details to unmerge.`}
                  className="border-white/20 text-white/90"
                >
                  Merged · {mod.merged.sources.length}
                </Tag>
              )}
            </div>
          </>
        );

        return (
          <ModMediaPreview
            mod={mod}
            hideNsfwPreviews={hideNsfwPreviews}
            soundVolume={soundVolume}
            overlayBadges={overlayBadges}
            mediaSpacingClasses={mediaSpacingClasses}
            mediaFrameClasses={mediaFrameClasses}
            audioOverlayClasses={audioOverlayClasses}
            audioPlayerClassName={audioPlayerClassName}
            onOpenDetails={onOpenDetails}
            isGroupCard={isGroupCard}
          />
        );
        })()}

        <div className="mt-auto min-w-0 px-0.5">
          <h3
            className={`min-w-0 text-text-primary ${titleClasses}`}
            title={mod.name}
          >
            {mod.name}
          </h3>
          <div
            className={`${isCompact ? 'mt-1.5 h-7' : 'mt-1.5'} grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3`}
            title={`${mod.fileName} | ${formatBytes(mod.size)} | installed ${formatAbsoluteDate(mod.installedAt)}`}
          >
            <div className={`flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-text-secondary ${gridTagsClasses}`}>
              <LockerHeroChip
                mod={mod}
                manualTagChipClasses={manualTagChipClasses}
                inferredTagChipClasses={inferredTagChipClasses}
                iconClassName={tagIconClassName}
              />
              {showCategoryChip && mod.categoryName && (
                <CategoryChip
                  label={mod.categoryName}
                  className={metaChipClasses}
                  iconClassName={tagIconClassName}
                />
              )}
              {showNsfwChip && (
                <MetaTextChip label="18+" className={dangerInlineChipClasses} />
              )}
              {showGroupChip && (
                <MetaTextChip
                  label={`${variantStatusLabel} files`}
                  className={accentInlineChipClasses}
                  title={variantStatusTitle}
                />
              )}
              {!isCompact && (
                <span
                  className="flex-shrink-0 pl-1.5 text-[11px] tabular-nums text-text-secondary/55 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100"
                  title={`Installed ${formatAbsoluteDate(mod.installedAt)}`}
                >
                  {formatRelativeDate(mod.installedAt)}
                </span>
              )}
            </div>

            <div className={`flex flex-shrink-0 items-center justify-end gap-2 ${isCompact ? '' : 'pr-1'}`}>
              {actions}
            </div>
          </div>
        </div>
      </>
        )}
      </div>

    </div>
  );
}

interface EditLocalModModalProps {
  mod: Mod;
  onClose: () => void;
  onSave: (args: { name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;
}

function EditLocalModModal({ mod, onClose, onSave }: EditLocalModModalProps) {
  const [name, setName] = useState(mod.name);
  const [imagePath, setImagePath] = useState('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState(mod.thumbnailUrl ?? '');
  const [nsfw, setNsfw] = useState(!!mod.nsfw);
  const [imgDragActive, setImgDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const acceptImagePath = async (picked: string) => {
    setImagePath(picked);
    setError(null);
    try {
      const dataUrl = await readImageDataUrl(picked);
      setThumbnailDataUrl(dataUrl);
    } catch (err) {
      setThumbnailDataUrl(mod.thumbnailUrl ?? '');
      setError(`Couldn't read image: ${String(err)}`);
    }
  };

  const pickImage = async () => {
    const picked = await showOpenDialog({
      title: 'Select thumbnail image',
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    });
    if (picked) await acceptImagePath(picked);
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImgDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!IMAGE_EXTS.includes(ext)) {
      setError(`Expected an image (${IMAGE_EXTS.join(', ')}) - got "${file.name}".`);
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError('Could not resolve the dropped image path.');
      return;
    }
    await acceptImagePath(path);
  };

  const onZoneKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  const submit = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: trimmed,
        thumbnailDataUrl: thumbnailDataUrl || undefined,
        nsfw,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-bg-secondary p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent">
            <Pencil className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-text-primary">Edit mod</h3>
            <p className="mt-1 text-sm text-text-secondary">
              Change the name, image, or NSFW mark.
            </p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium text-text-primary" htmlFor="local-mod-name">
          Name
        </label>
        <input
          id="local-mod-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') onClose();
          }}
          autoFocus
          className="mt-2 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-secondary/60 focus:border-accent focus:ring-2 focus:ring-accent/25"
          placeholder="Mod name"
        />
        <p className="mt-2 truncate text-xs text-text-secondary" title={mod.fileName}>
          File: {mod.fileName}
        </p>

        <div className="mt-5">
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            Image
          </label>
          <div
            role="button"
            tabIndex={0}
            aria-label={thumbnailDataUrl ? 'Image selected. Press Enter to change.' : 'Drop an image here or press Enter to browse'}
            onClick={pickImage}
            onKeyDown={(e) => onZoneKeyDown(e, pickImage)}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setImgDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(false); }}
            onDrop={handleImageDrop}
            className={`flex items-center gap-3 p-3 rounded-lg border border-dashed cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
              imgDragActive
                ? 'border-accent bg-accent/10'
                : thumbnailDataUrl
                  ? 'border-accent/40 bg-bg-tertiary/60 hover:bg-bg-tertiary'
                  : 'border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-white/20'
            }`}
          >
            <div className="w-24 aspect-video bg-bg-tertiary rounded-md overflow-hidden flex items-center justify-center text-text-secondary flex-shrink-0">
              {thumbnailDataUrl ? (
                <img src={thumbnailDataUrl} alt="Thumbnail preview" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus className="w-5 h-5" aria-hidden />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {imagePath ? (
                <>
                  <div className="text-sm text-text-primary font-medium truncate">{imagePath.split(/[\\/]/).pop()}</div>
                  <div className="text-xs text-text-secondary font-mono truncate">{imagePath}</div>
                  <div className="text-xs text-accent mt-0.5">Click or drop another to replace</div>
                </>
              ) : thumbnailDataUrl ? (
                <>
                  <div className="text-sm text-text-primary font-medium">Current image</div>
                  <div className="text-xs text-text-secondary">Click or drop to replace</div>
                </>
              ) : (
                <>
                  <div className="text-sm text-text-primary font-medium">Drop an image here</div>
                  <div className="text-xs text-text-secondary">or click to browse - {IMAGE_EXTS.join(', ')}</div>
                </>
              )}
            </div>
          </div>
          {thumbnailDataUrl && (
            <button
              type="button"
              onClick={() => {
                setImagePath('');
                setThumbnailDataUrl('');
              }}
              className="mt-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
            >
              Remove image
            </button>
          )}
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={nsfw}
            onChange={(e) => setNsfw(e.target.checked)}
            className="w-4 h-4 accent-accent cursor-pointer"
          />
          NSFW
        </label>

        {error && (
          <div className="mt-4 rounded-md border border-state-danger/35 bg-state-danger/10 px-3 py-2 text-sm text-state-danger">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={saving} disabled={!trimmed}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ImportCustomModModalProps {
  onClose: () => void;
  onImport: (args: { vpkPath: string; name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;
  title?: string;
  submitLabel?: string;
  initialVpkPath?: string;
  initialName?: string;
  lockVpk?: boolean;
  vpkHelpText?: string;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

function deriveModNameFromPath(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? '';
  return base
    .replace(/_dir\.vpk$/i, '')
    .replace(/\.vpk$/i, '')
    .replace(/^pak\d{2}_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function ImportCustomModModal({
  onClose,
  onImport,
  title = 'Import Custom Mod',
  submitLabel = 'Import',
  initialVpkPath = '',
  initialName = '',
  lockVpk = false,
  vpkHelpText = 'The file will be copied into your addons folder and renamed with the next available pak## priority.',
}: ImportCustomModModalProps) {
  const [vpkPath, setVpkPath] = useState<string>(initialVpkPath);
  const [name, setName] = useState<string>(initialName || (initialVpkPath ? deriveModNameFromPath(initialVpkPath) : ''));
  const [imagePath, setImagePath] = useState<string>('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string>('');
  const [nsfw, setNsfw] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [vpkDragActive, setVpkDragActive] = useState(false);
  const [imgDragActive, setImgDragActive] = useState(false);

  const acceptVpkPath = (picked: string) => {
    setVpkPath(picked);
    setError(null);
    if (!name) setName(deriveModNameFromPath(picked));
  };

  const acceptImagePath = async (picked: string) => {
    setImagePath(picked);
    setError(null);
    try {
      const dataUrl = await readImageDataUrl(picked);
      setThumbnailDataUrl(dataUrl);
    } catch (err) {
      setThumbnailDataUrl('');
      setError(`Couldn't read image: ${String(err)}`);
    }
  };

  const pickVpk = async () => {
    if (lockVpk) return;
    const picked = await showOpenDialog({
      title: 'Select VPK file',
      filters: [{ name: 'VPK files', extensions: ['vpk'] }],
    });
    if (picked) acceptVpkPath(picked);
  };

  const pickImage = async () => {
    const picked = await showOpenDialog({
      title: 'Select thumbnail image',
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    });
    if (picked) await acceptImagePath(picked);
  };

  const handleVpkDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setVpkDragActive(false);
    if (lockVpk) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.vpk$/i.test(file.name)) {
      setError(`Expected a .vpk file — got "${file.name}".`);
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError('Could not resolve the dropped file path.');
      return;
    }
    acceptVpkPath(path);
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImgDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!IMAGE_EXTS.includes(ext)) {
      setError(`Expected an image (${IMAGE_EXTS.join(', ')}) — got "${file.name}".`);
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError('Could not resolve the dropped image path.');
      return;
    }
    await acceptImagePath(path);
  };

  const onZoneKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  const canSubmit = !!vpkPath && !!name.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onImport({
        vpkPath,
        name: name.trim(),
        thumbnailDataUrl: thumbnailDataUrl || undefined,
        nsfw,
      });
      onClose();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <FilePlus className="w-5 h-5" />
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              VPK file <span className="text-red-400">*</span>
            </label>
            <div
              role="button"
              tabIndex={0}
              aria-label={vpkPath ? `VPK selected: ${vpkPath}${lockVpk ? '' : '. Press Enter to change.'}` : 'Drop a VPK file here or press Enter to browse'}
              onClick={pickVpk}
              onKeyDown={(e) => onZoneKeyDown(e, pickVpk)}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!lockVpk) setVpkDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = lockVpk ? 'none' : 'copy'; if (!lockVpk) setVpkDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setVpkDragActive(false); }}
              onDrop={handleVpkDrop}
              className={`relative flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-lg border border-dashed text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
                vpkDragActive
                  ? 'border-accent bg-accent/10'
                  : vpkPath
                    ? `border-accent/40 bg-bg-tertiary/60 ${lockVpk ? 'cursor-default' : 'cursor-pointer hover:bg-bg-tertiary'}`
                    : 'border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-white/20'
              }`}
            >
              {vpkPath ? (
                <>
                  <FilePlus className="w-5 h-5 text-accent" aria-hidden />
                  <span className="text-sm text-text-primary font-medium truncate max-w-full">
                    {vpkPath.split(/[\\/]/).pop()}
                  </span>
                  <span className="text-xs text-text-secondary font-mono truncate max-w-full">{vpkPath}</span>
                  {!lockVpk && <span className="text-xs text-accent">Click or drop another to replace</span>}
                </>
              ) : (
                <>
                  <UploadCloud className="w-6 h-6 text-text-secondary" aria-hidden />
                  <span className="text-sm text-text-primary font-medium">
                    Drop a <code className="font-mono text-accent">.vpk</code> here
                  </span>
                  <span className="text-xs text-text-secondary">or click to browse</span>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {vpkHelpText}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Mod name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My awesome skin"
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Thumbnail image <span className="text-text-secondary font-normal">(optional)</span>
            </label>
            <div
              role="button"
              tabIndex={0}
              aria-label={imagePath ? `Thumbnail selected: ${imagePath}. Press Enter to change.` : 'Drop an image here or press Enter to browse'}
              onClick={pickImage}
              onKeyDown={(e) => onZoneKeyDown(e, pickImage)}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setImgDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(false); }}
              onDrop={handleImageDrop}
              className={`flex items-center gap-3 p-3 rounded-lg border border-dashed cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
                imgDragActive
                  ? 'border-accent bg-accent/10'
                  : thumbnailDataUrl
                    ? 'border-accent/40 bg-bg-tertiary/60 hover:bg-bg-tertiary'
                    : 'border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-white/20'
              }`}
            >
              <div className="w-24 aspect-video bg-bg-tertiary rounded-md overflow-hidden flex items-center justify-center text-text-secondary flex-shrink-0">
                {thumbnailDataUrl ? (
                  <img src={thumbnailDataUrl} alt="Thumbnail preview" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-5 h-5" aria-hidden />
                )}
              </div>
              <div className="flex-1 min-w-0">
                {imagePath ? (
                  <>
                    <div className="text-sm text-text-primary font-medium truncate">{imagePath.split(/[\\/]/).pop()}</div>
                    <div className="text-xs text-text-secondary font-mono truncate">{imagePath}</div>
                    <div className="text-xs text-accent mt-0.5">Click or drop another to replace</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-text-primary font-medium">Drop an image here</div>
                    <div className="text-xs text-text-secondary">or click to browse — {IMAGE_EXTS.join(', ')}</div>
                  </>
                )}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={nsfw}
              onChange={(e) => setNsfw(e.target.checked)}
              className="w-4 h-4 accent-accent cursor-pointer"
            />
            Mark as NSFW
          </label>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-border">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-bg-tertiary border border-border rounded-lg hover:bg-bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
