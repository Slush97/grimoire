import { useEffect, useRef, useState } from 'react';
import {
  Package,
  Loader2,
  Settings,
  Trash2,
  AlertTriangle,
  FolderOpen,
  GripVertical,
  FilePlus,
  X,
  ImagePlus,
  Search,
  Volume2,
  Download,
  UploadCloud,
  List,
  LayoutGrid,
  Grid3x3,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getConflicts, openModsFolder, readImageDataUrl, showOpenDialog, getModDetails, downloadMod } from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { Mod } from '../types/mod';
import type { GameBananaModDetails } from '../types/gamebanana';
import ModThumbnail from '../components/ModThumbnail';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import ModDetailsModal from '../components/ModDetailsModal';
import VariantPickerModal from '../components/VariantPickerModal';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition } from '../lib/lockerUtils';
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates';
import { Button, Tag } from '../components/common/ui';
import { PageHeader, ViewModeToggle, EmptyState, ConfirmModal, SectionHeader, type ViewMode } from '../components/common/PageComponents';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

type DropPosition = 'before' | 'after';

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
    entries.push({ kind: 'single', mod: m, key: `single:${m.id}` });
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

function entryFilesByEnabledState(entry: ModEntry, enabled: boolean): Mod[] {
  if (entry.kind === 'single') {
    return entry.mod.enabled === enabled ? [entry.mod] : [];
  }
  return entry.variants.filter((variant) => variant.enabled === enabled);
}

function buildCompactPriorityOrder(entries: ModEntry[]): Mod[] {
  const compactState = (enabled: boolean) =>
    entries
      .map((entry) => {
        const files = entryFilesByEnabledState(entry, enabled);
        const priority = files.length > 0
          ? Math.min(...files.map((file) => file.priority))
          : Number.POSITIVE_INFINITY;
        return { files, priority };
      })
      .filter(({ files }) => files.length > 0)
      .sort((a, b) => a.priority - b.priority)
      .flatMap(({ files }) => files);

  return [...compactState(true), ...compactState(false)];
}

export default function Installed() {
  const navigate = useNavigate();
  const {
    settings,
    mods,
    modsLoading,
    modsError,
    loadSettings,
    loadMods,
    toggleMod,
    deleteMod,
    reorderMods,
    setVariantLabel,
    importCustomMod,
    soundVolume,
  } = useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem('installedViewMode');
    return stored === 'grid' || stored === 'compact' || stored === 'list' ? stored : 'grid';
  });
  useEffect(() => {
    localStorage.setItem('installedViewMode', viewMode);
  }, [viewMode]);
  const [search, setSearch] = useState('');
  const [conflictMap, setConflictMap] = useState<Map<string, ModConflict[]>>(new Map());
  // Delete confirmation. `ids` is a list so the same prompt can drive both
  // single-mod and "all files in this group" deletions.
  const [modToDelete, setModToDelete] = useState<{ ids: string[]; name: string; isGroup: boolean } | null>(null);
  // GB id of the group whose picker is open, or null. The actual entry is
  // derived from live `mods` each render so per-file deletes inside the
  // picker reflect immediately without juggling a separate snapshot.
  const [pickerGroupId, setPickerGroupId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Drag-and-drop reorder state. `draggingSection` scopes drops so dragging
  // an enabled card can't drop onto a disabled card and vice-versa.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<'enabled' | 'disabled' | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);

  // Details overlay state
  const [detailsMod, setDetailsMod] = useState<GameBananaModDetails | null>(null);
  const [detailsSection, setDetailsSection] = useState<string>('Mod');
  const [detailsCategoryId, setDetailsCategoryId] = useState<number>(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsUpdateAvailable, setDetailsUpdateAvailable] = useState(false);
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
    setDetailsSourceModId(null);
    setDetailsActiveFileIds(new Set());
    setDetailsDates(null);
  };

  const handleDetailsDownload = async (fileId: number, fileName: string) => {
    if (!detailsMod) return;
    try {
      // Same-file picks (true reinstall/update) replace the source install;
      // different-file picks add a new entry and the download backend will
      // auto-disable any prior enabled sibling files of the same GameBanana mod.
      const sourceMod = detailsSourceModId ? mods.find((m) => m.id === detailsSourceModId) : null;
      if (sourceMod && sourceMod.gameBananaFileId === fileId) {
        await deleteMod(sourceMod.id);
      }
      await downloadMod(detailsMod.id, fileId, fileName, detailsSection, detailsCategoryId);
      closeModDetails();
      loadMods();
    } catch (err) {
      setDetailsError(String(err));
    }
  };

  /**
   * Bulk-update every mod currently flagged in updatesAvailable. Snapshots
   * pre-update enabled state per mod and re-applies it after the new install
   * lands — downloads always go to the disabled folder by default, so without
   * this restore step the user would have to manually re-enable each one.
   * Failures are caught per-item so one bad mod doesn't halt the rest.
   */
  const handleUpdateAll = async () => {
    setUpdateAllConfirmOpen(false);
    setUpdateAllError(null);
    const snapshots = mods
      .filter((m) => updatesAvailable.has(m.id) && m.gameBananaId && typeof m.gameBananaFileId === 'number')
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
    setUpdateAllProgress({ done: 0, total: snapshots.length });
    const failures: string[] = [];
    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i];
      try {
        await deleteMod(s.oldId);
        await downloadMod(s.gameBananaId, s.gameBananaFileId, s.fileName, s.section, s.categoryId);
      } catch (err) {
        failures.push(`${s.fileName}: ${String(err)}`);
      }
      setUpdateAllProgress({ done: i + 1, total: snapshots.length });
    }
    // Refresh once so the new installs are in the store with their new ids,
    // then re-enable anything that was enabled before. Match-by GB ids; the
    // local mod id changes on reinstall.
    await loadMods();
    const refreshed = useAppStore.getState().mods;
    for (const s of snapshots) {
      if (!s.wasEnabled) continue;
      const newMod = refreshed.find(
        (m) => m.gameBananaId === s.gameBananaId && m.gameBananaFileId === s.gameBananaFileId,
      );
      if (newMod && !newMod.enabled) {
        try {
          await toggleMod(newMod.id);
        } catch (err) {
          failures.push(`re-enable ${s.fileName}: ${String(err)}`);
        }
      }
    }
    setUpdateAllProgress(null);
    if (failures.length > 0) {
      setUpdateAllError(`${failures.length} mod${failures.length === 1 ? '' : 's'} failed to update. See console for details.`);
      console.warn('[Update all] failures:', failures);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!modToDelete) return;
    // Sequential to keep priority renames coherent — parallel deletes have
    // raced renameVpks before.
    for (const id of modToDelete.ids) {
      await deleteMod(id);
    }
    setModToDelete(null);
  };

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
    position: DropPosition
  ) => {
    if (source.id === neighbor.id) return;
    if (source.enabled !== neighbor.enabled) return;

    const enabledMods = mods.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
    const disabledMods = mods.filter((m) => !m.enabled).sort((a, b) => a.priority - b.priority);
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

  // Auto-scroll the main content container while drag-reordering. Native HTML
  // drag-and-drop doesn't fire pointer events, so we hook `dragover` at the
  // window and start a rAF loop whenever the cursor is near the top/bottom
  // edge of the scroll container.
  useEffect(() => {
    if (!draggingId) return;
    const main = document.querySelector('main');
    if (!main) return;
    const EDGE = 80;
    const MAX_STEP = 18;
    let pointerY = -1;

    const tick = () => {
      const rect = main.getBoundingClientRect();
      const fromTop = pointerY - rect.top;
      const fromBottom = rect.bottom - pointerY;
      let dy = 0;
      if (fromTop >= 0 && fromTop < EDGE) dy = -Math.round(((EDGE - fromTop) / EDGE) * MAX_STEP);
      else if (fromBottom >= 0 && fromBottom < EDGE) dy = Math.round(((EDGE - fromBottom) / EDGE) * MAX_STEP);
      if (dy !== 0) main.scrollBy({ top: dy });
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };

    const onDragOver = (e: DragEvent) => {
      pointerY = e.clientY;
      if (autoScrollRafRef.current === null) {
        autoScrollRafRef.current = requestAnimationFrame(tick);
      }
    };
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [draggingId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
  }, [activeDeadlockPath, loadMods]);

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
      } catch {
        setConflictMap(new Map());
      }
    };
    if (mods.length > 0) {
      loadConflictData();
    }
  }, [mods]);

  // Flag mods whose GameBanana dateModified is newer than when the user
  // installed their copy. Uses the local mod cache (synced in the background)
  // so this is cheap and works offline; staler cache just means fewer flags.
  useEffect(() => {
    let cancelled = false;
    const checkUpdates = async () => {
      const targets = mods.filter((m) => !!m.gameBananaId && !!m.installedAt);
      if (targets.length === 0) {
        setUpdatesAvailable(new Set());
        return;
      }
      const available = new Set<string>();
      for (const mod of targets) {
        if (cancelled) return;
        try {
          const cached = await window.electronAPI.getCachedMod(mod.gameBananaId!);
          if (!cached) continue;
          const installedTs = Math.floor(new Date(mod.installedAt).getTime() / 1000);
          if (Number.isFinite(installedTs) && cached.dateModified > installedTs) {
            available.add(mod.id);
          }
        } catch {
          // Cache miss or backend error — just skip this mod.
        }
      }
      if (!cancelled) setUpdatesAvailable(available);
    };
    checkUpdates();
    return () => {
      cancelled = true;
    };
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
    return <InstalledSkeleton viewMode={viewMode} />;
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
  // custom imports (no GB id) keep their old card behavior.
  const allEntries = buildModEntries(mods);
  const enabledEntries = allEntries
    .filter(isEntryEnabled)
    .sort((a, b) => entrySortPriority(a) - entrySortPriority(b));
  const disabledEntries = allEntries
    .filter((e) => !isEntryEnabled(e))
    .sort((a, b) => entrySortPriority(a) - entrySortPriority(b));
  const compactOrder = buildCompactPriorityOrder(allEntries);
  const conflictCount = conflictMap.size > 0 ? new Set([...conflictMap.keys()]).size : 0;

  // Filter by search query (case-insensitive substring on name). Drag-and-drop
  // reorder is still correct because it targets the full enabled list order,
  // not the filtered view.
  const searchNeedle = search.trim().toLowerCase();
  const matchesSearchEntry = (entry: ModEntry) =>
    !searchNeedle || entryName(entry).toLowerCase().includes(searchNeedle);
  const visibleEnabled = enabledEntries.filter(matchesSearchEntry);
  const visibleDisabled = disabledEntries.filter(matchesSearchEntry);
  const totalMatches = visibleEnabled.length + visibleDisabled.length;

  const resetDragState = () => {
    setDraggingId(null);
    setDraggingSection(null);
    setDropTargetId(null);
    setDropPosition(null);
  };

  /** Locate the entry that holds a given mod id within a section's entries. */
  const findEntryForModId = (entries: ModEntry[], id: string): ModEntry | undefined => {
    return entries.find((e) =>
      e.kind === 'single' ? e.mod.id === id : e.variants.some((v) => v.id === id)
    );
  };

  /**
   * Entry-aware drag reorder. Singles move one mod; groups move all their
   * files as a block, keeping internal priority order. After the reshuffle
   * we flatten back to a filename list and hand it to reorderMods, which
   * renames pak##_ prefixes to lock in new priorities.
   */
  const applyReorder = (
    sourceId: string,
    targetId: string,
    position: DropPosition,
    section: 'enabled' | 'disabled'
  ) => {
    if (sourceId === targetId) return;
    const entries = section === 'enabled' ? enabledEntries : disabledEntries;
    const sourceEntry = findEntryForModId(entries, sourceId);
    const targetEntry = findEntryForModId(entries, targetId);
    if (!sourceEntry || !targetEntry || sourceEntry.key === targetEntry.key) return;

    const working = entries.slice();
    const sourceIdx = working.indexOf(sourceEntry);
    working.splice(sourceIdx, 1);
    const targetIdx = working.indexOf(targetEntry);
    if (targetIdx === -1) return;
    const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
    working.splice(insertAt, 0, sourceEntry);

    const next = flattenEntries(working);
    const prev = flattenEntries(entries);
    const unchanged = next.every((m, i) => m.id === prev[i]?.id);
    if (unchanged) return;

    reorderMods(next.map((m) => m.fileName));
  };

  const fixOrder = () => {
    if (compactOrder.length === 0) return;
    reorderMods(compactOrder.map((m) => m.fileName));
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
  const renderEntryCard = (entry: ModEntry, section: 'enabled' | 'disabled') => {
    if (entry.kind === 'single') {
      const mod = entry.mod;
      return (
        <ModCard
          key={entry.key}
          mod={mod}
          viewMode={viewMode}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
          conflicts={conflictMap.get(mod.id) || []}
          soundVolume={soundVolume}
          updateAvailable={updatesAvailable.has(mod.id)}
          onOpenDetails={mod.gameBananaId ? () => openModDetails(mod) : undefined}
          onToggle={() => toggleMod(mod.id)}
          onDelete={() => setModToDelete({ ids: [mod.id], name: mod.name, isGroup: false })}
          draggable={!searchNeedle}
          isDragging={draggingId === mod.id}
          isDropTarget={dropTargetId === mod.id}
          dropPosition={dropTargetId === mod.id ? dropPosition : null}
          onDragStart={() => {
            setDraggingId(mod.id);
            setDraggingSection(section);
          }}
          onDragOver={(pos) => {
            if (!draggingId || draggingId === mod.id) return;
            if (draggingSection !== section) return;
            setDropTargetId(mod.id);
            setDropPosition(pos);
          }}
          onDragLeaveCard={() => {
            if (dropTargetId === mod.id) {
              setDropTargetId(null);
              setDropPosition(null);
            }
          }}
          onDrop={() => {
            if (draggingId && dropTargetId && dropPosition && draggingSection === section) {
              applyReorder(draggingId, dropTargetId, dropPosition, section);
            }
            resetDragState();
          }}
          onDragEnd={resetDragState}
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
    // Drag uses the primary's mod id as the representative for the whole
    // group. applyReorder maps this id back to the entry and moves the
    // whole file block.
    const dragRepId = entry.primary.id;
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
        hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
        conflicts={aggregateConflicts}
        soundVolume={soundVolume}
        updateAvailable={anyUpdateAvailable}
        onOpenDetails={() => setPickerGroupId(entry.gameBananaId)}
        onToggle={() => handleGroupToggle(entry)}
        onDelete={() =>
          setModToDelete({
            ids: entry.variants.map((v) => v.id),
            name: entry.primary.name,
            isGroup: true,
          })
        }
        draggable={!searchNeedle}
        isDragging={draggingId === dragRepId}
        isDropTarget={dropTargetId === dragRepId}
        dropPosition={dropTargetId === dragRepId ? dropPosition : null}
        onDragStart={() => {
          setDraggingId(dragRepId);
          setDraggingSection(section);
        }}
        onDragOver={(pos) => {
          if (!draggingId || draggingId === dragRepId) return;
          if (draggingSection !== section) return;
          setDropTargetId(dragRepId);
          setDropPosition(pos);
        }}
        onDragLeaveCard={() => {
          if (dropTargetId === dragRepId) {
            setDropTargetId(null);
            setDropPosition(null);
          }
        }}
        onDrop={() => {
          if (draggingId && dropTargetId && dropPosition && draggingSection === section) {
            applyReorder(draggingId, dropTargetId, dropPosition, section);
          }
          resetDragState();
        }}
        onDragEnd={resetDragState}
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

  return (
    <div className="p-6">
      <PageHeader
        title="Installed Mods"
        action={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search installed..."
                className="bg-bg-secondary border border-border rounded-lg pl-8 pr-8 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-accent w-56"
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
            {conflictCount > 0 && (
              <Button
                variant="warning"
                size="sm"
                onClick={() => navigate('/conflicts')}
                icon={AlertTriangle}
              >
                {conflictMap.size / 2} conflicts
              </Button>
            )}
            {(updatesAvailable.size > 0 || updateAllProgress) && (
              <Button
                variant="primary"
                onClick={() => setUpdateAllConfirmOpen(true)}
                icon={Download}
                isLoading={!!updateAllProgress}
                title="Re-download every mod with a newer version on GameBanana and restore each one's enabled state"
              >
                {updateAllProgress
                  ? `Updating ${updateAllProgress.done}/${updateAllProgress.total}…`
                  : `Update all (${updatesAvailable.size})`}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setImportOpen(true)}
              icon={FilePlus}
              title="Import a VPK from disk with a custom name and thumbnail"
            >
              Add Custom Mod
            </Button>
            <Button
              variant="secondary"
              onClick={() => openModsFolder().catch(() => {})}
              icon={FolderOpen}
              title="Open mods folder"
            >
              Open Folder
            </Button>
            <ViewModeToggle
              value={viewMode}
              options={[
                { value: 'grid', label: 'Cards view', icon: LayoutGrid },
                { value: 'compact', label: 'Compact view', icon: Grid3x3 },
                { value: 'list', label: 'List view', icon: List },
              ]}
              onChange={setViewMode}
            />
          </div>
        }
        className="mb-6"
      />

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
          <div className="flex items-center justify-between mb-3">
            <SectionHeader count={visibleEnabled.length} className="!mb-0">Enabled</SectionHeader>
            {!searchNeedle && (
              <Button
                variant="secondary"
                size="sm"
                onClick={fixOrder}
                title="Renumber all installed mods 1, 2, 3, … to tidy priority slots"
              >
                Fix Order
              </Button>
            )}
          </div>
          <div
            className={
              viewMode === 'compact'
                ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2'
                : viewMode === 'grid'
                  ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                  : 'space-y-2'
            }
          >
            {visibleEnabled.map((entry) => renderEntryCard(entry, 'enabled'))}
          </div>
        </div>
      )}

      {visibleDisabled.length > 0 && (
        <div>
          <SectionHeader count={visibleDisabled.length}>Disabled</SectionHeader>
          <div
            className={
              viewMode === 'compact'
                ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2'
                : viewMode === 'grid'
                  ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                  : 'space-y-2'
            }
          >
            {visibleDisabled.map((entry) => renderEntryCard(entry, 'disabled'))}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={updateAllConfirmOpen}
        title={`Update all (${updatesAvailable.size})?`}
        message={
          <>
            Re-download every mod flagged with an available update. Each one's enabled state
            will be restored after the install finishes. Downloads run one at a time and may
            take a while.
          </>
        }
        confirmLabel={`Update ${updatesAvailable.size}`}
        variant="primary"
        onConfirm={handleUpdateAll}
        onCancel={() => setUpdateAllConfirmOpen(false)}
      />

      {updateAllError && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3 shadow-lg flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm">{updateAllError}</div>
          <button
            type="button"
            onClick={() => setUpdateAllError(null)}
            className="text-red-300 hover:text-red-100 p-1 -m-1 cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={!!modToDelete}
        title={modToDelete?.isGroup ? `Delete ${modToDelete.ids.length} files?` : 'Delete Mod?'}
        message={
          modToDelete?.isGroup ? (
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
        confirmLabel={modToDelete?.isGroup ? `Delete ${modToDelete.ids.length}` : 'Delete'}
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
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
          dateAdded={detailsDates?.dateAdded}
          dateModified={detailsDates?.dateModified}
          updateAvailable={detailsUpdateAvailable}
          onClose={closeModDetails}
          onDownload={handleDetailsDownload}
        />
      )}
    </div>
  );
}

function InstalledSkeleton({ viewMode }: { viewMode: ViewMode }) {
  const isGridLike = viewMode !== 'list';
  const rows = viewMode === 'compact' ? 12 : viewMode === 'grid' ? 8 : 6;
  return (
    <div className="p-6 animate-fade-in" aria-busy="true" aria-live="polite">
      <div className="flex items-end justify-between gap-4 pb-4 border-b border-border mb-6">
        <div className="space-y-2">
          <div className="skeleton-shimmer bg-bg-tertiary rounded-md h-9 w-52" />
          <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-36" />
        </div>
        <div className="skeleton-shimmer bg-bg-tertiary rounded-lg h-9 w-56" />
      </div>
      <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-20 mb-3" />
      <div
        className={
          viewMode === 'compact'
            ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2'
            : viewMode === 'grid'
              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
              : 'space-y-2'
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
  };
  viewMode: ViewMode;
  hideNsfwPreviews: boolean;
  conflicts: ModConflict[];
  soundVolume: number;
  updateAvailable?: boolean;
  onOpenDetails?: () => void;
  onToggle: () => void;
  onDelete: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropPosition?: DropPosition | null;
  onDragStart?: () => void;
  onDragOver?: (position: DropPosition) => void;
  onDragLeaveCard?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
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
  draggable,
  isDragging,
  isDropTarget,
  dropPosition,
  onDragStart,
  onDragOver,
  onDragLeaveCard,
  onDrop,
  onDragEnd,
  group,
}: ModCardProps) {
  const hasConflicts = conflicts.length > 0;
  const handleDownRef = useRef<boolean>(false);
  const isGroupCard = !!group;
  const variantStatusLabel = group ? `${group.enabledCount}/${group.variantCount}` : null;
  const enabledTitle = group?.enabledLabels.join(', ') ?? '';
  const variantStatusTitle = group
    ? `${enabledTitle || 'No files enabled'} - click card to choose files`
    : '';
  const listHeroName = viewMode === 'list' && mod.sourceSection === 'Sound'
    ? inferHeroFromTitle(mod.name)
    : null;
  const listHeroRenderUrl = listHeroName ? getHeroRenderPath(listHeroName) : null;
  const listHeroFacePos = listHeroName ? getHeroFacePosition(listHeroName) : 50;
  const hasListTags =
    viewMode === 'list' &&
    (hasConflicts || mod.sourceSection === 'Sound' || mod.nsfw || updateAvailable || mod.enabled);

  const indicatorClasses = (() => {
    if (!isDropTarget || !dropPosition) return '';
    const base = 'absolute bg-accent pointer-events-none rounded-full';
    if (viewMode === 'list') {
      return dropPosition === 'before'
        ? `${base} left-2 right-2 -top-[3px] h-[3px]`
        : `${base} left-2 right-2 -bottom-[3px] h-[3px]`;
    }
    return dropPosition === 'before'
      ? `${base} top-2 bottom-2 -left-[3px] w-[3px]`
      : `${base} top-2 bottom-2 -right-[3px] w-[3px]`;
  })();

  return (
    <div
      className={`relative rounded-lg border transition-colors ${
        hasConflicts
          ? 'bg-state-warning/5 border-state-warning/50'
          : mod.enabled
            ? 'bg-accent/5 border-accent/40'
            : 'bg-bg-secondary/60 border-border/70 text-text-primary/80 hover:bg-bg-secondary hover:text-text-primary'
      } ${viewMode === 'compact' ? 'p-2 flex flex-col gap-2' : viewMode === 'grid' ? 'p-3 flex flex-col gap-3' : 'flex items-start sm:items-center gap-3 p-3'} ${
        isDragging ? 'opacity-40' : ''
      }`}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable || !onDragStart) {
          e.preventDefault();
          return;
        }
        // Require drag to originate from the grip handle so clicks on toggle/delete don't start a drag
        if (!handleDownRef.current) {
          e.preventDefault();
          return;
        }
        handleDownRef.current = false;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox needs setData to start a drag
        try {
          e.dataTransfer.setData('text/plain', mod.id);
        } catch {
          // ignore
        }
        onDragStart();
      }}
      onDragOver={(e) => {
        if (!draggable || !onDragOver) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        if (viewMode === 'list') {
          const mid = rect.top + rect.height / 2;
          onDragOver(e.clientY < mid ? 'before' : 'after');
        } else {
          const mid = rect.left + rect.width / 2;
          onDragOver(e.clientX < mid ? 'before' : 'after');
        }
      }}
      onDragLeave={(e) => {
        // Only count leaves where we're exiting the card itself
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        onDragLeaveCard?.();
      }}
      onDrop={(e) => {
        if (!draggable || !onDrop) return;
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      {indicatorClasses && <div className={indicatorClasses} />}

      {viewMode !== 'list' && (() => {
        const isSoundCard = mod.sourceSection === 'Sound' && !!mod.audioUrl;
        const overlayBadges = (
          <>
            {mod.enabled && (
              <div className="absolute top-2 left-2 z-10">
                <Tag
                  tone="accent"
                  variant="overlay"
                  title="Lower number loads first. When two mods overwrite the same file, the later-loaded mod wins."
                  className="tabular-nums"
                >
                  Load #{mod.priority}
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
              {updateAvailable && (
                <Tag
                  tone="info"
                  variant="overlay"
                  icon={Download}
                  title="A newer version is available on GameBanana"
                >
                  Update
                </Tag>
              )}
            </div>
          </>
        );

        if (isSoundCard) {
          // Match Browse's Sound section: infer the hero from the mod title
          // and reuse the locker render so the card carries the same hero
          // art the user saw when they downloaded it.
          const inferredHero = inferHeroFromTitle(mod.name);
          const heroRenderUrl = inferredHero ? getHeroRenderPath(inferredHero) : null;
          const heroFacePos = inferredHero ? getHeroFacePosition(inferredHero) : 50;
          return (
            <div className="group relative w-full aspect-video rounded-md overflow-hidden bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary border border-border">
              {overlayBadges}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetails?.();
                }}
                disabled={!onOpenDetails}
                className="absolute inset-0 w-full h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
                title={onOpenDetails ? (isGroupCard ? 'Choose files' : 'View mod details') : undefined}
                aria-label={onOpenDetails ? (isGroupCard ? `Choose files for ${mod.name}` : `View details for ${mod.name}`) : undefined}
              >
                {heroRenderUrl ? (
                  <>
                    <img
                      src={heroRenderUrl}
                      alt={inferredHero ?? mod.name}
                      className="w-full h-full object-cover transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
                      style={{ objectPosition: `${heroFacePos}% 25%` }}
                    />
                    {/* Gradient so the overlaid player stays legible */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-1 text-text-secondary group-hover:text-accent transition-colors">
                    <div className="flex items-end gap-0.5 h-6 opacity-60">
                      {[4, 7, 12, 16, 20, 14, 8, 12, 18, 10, 6, 14, 9].map((h, i) => (
                        <span
                          key={i}
                          className="w-1 rounded-full bg-accent/70"
                          style={{ height: `${h}px` }}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider">Sound preview</span>
                  </div>
                )}
              </button>
              <div
                className="absolute inset-x-2 bottom-2 z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <AudioPreviewPlayer
                  src={mod.audioUrl!}
                  compact
                  volume={soundVolume}
                  className="w-full backdrop-blur-md bg-bg-primary/70 border border-white/10 rounded-md"
                />
              </div>
            </div>
          );
        }

        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetails?.();
            }}
            disabled={!onOpenDetails}
            className="group relative w-full aspect-video bg-bg-tertiary rounded-md overflow-hidden block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
            title={onOpenDetails ? (isGroupCard ? 'Choose files' : 'View mod details') : undefined}
            aria-label={onOpenDetails ? (isGroupCard ? `Choose files for ${mod.name}` : `View details for ${mod.name}`) : undefined}
          >
            <ModThumbnail
              src={mod.thumbnailUrl}
              alt={mod.name}
              nsfw={mod.nsfw}
              hideNsfw={hideNsfwPreviews}
              className="w-full h-full transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
            />
            {onOpenDetails && (
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/20" />
            )}
            {overlayBadges}
          </button>
        );
      })()}

      <div className={viewMode !== 'list' ? 'flex items-center gap-3' : 'contents'}>
        {draggable && (
          <div
            onMouseDown={() => {
              handleDownRef.current = true;
            }}
            onMouseUp={() => {
              handleDownRef.current = false;
            }}
            className="p-1 text-text-secondary hover:text-text-primary cursor-grab active:cursor-grabbing select-none"
            title="Drag to reorder"
            aria-label="Drag to reorder"
          >
            <GripVertical className="w-5 h-5" />
          </div>
        )}

        {viewMode === 'list' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetails?.();
            }}
            disabled={!onOpenDetails}
            className="group relative w-24 h-16 sm:w-32 sm:h-20 flex-shrink-0 rounded-md overflow-hidden bg-bg-tertiary border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
            title={onOpenDetails ? (isGroupCard ? 'Choose files' : 'View mod details') : undefined}
            aria-label={onOpenDetails ? (isGroupCard ? `Choose files for ${mod.name}` : `View details for ${mod.name}`) : undefined}
          >
            {listHeroRenderUrl ? (
              <img
                src={listHeroRenderUrl}
                alt={listHeroName ?? mod.name}
                className="w-full h-full object-cover transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
                style={{ objectPosition: `${listHeroFacePos}% 25%` }}
              />
            ) : (
              <ModThumbnail
                src={mod.thumbnailUrl}
                alt={mod.name}
                nsfw={mod.nsfw}
                hideNsfw={hideNsfwPreviews}
                className="w-full h-full transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
              />
            )}
            {onOpenDetails && (
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/20" />
            )}
          </button>
        )}

        <div className="flex-1 min-w-0">
          {viewMode === 'list' ? (
            <h3 className="font-medium truncate min-w-0" title={mod.name}>{mod.name}</h3>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-medium truncate flex-1 min-w-0" title={mod.name}>{mod.name}</h3>
              {mod.sourceSection === 'Sound' && (
                <Tag tone="accent" icon={Volume2} className="flex-shrink-0">
                  Sound
                </Tag>
              )}
              {mod.nsfw && (
                <Tag tone="danger" className="flex-shrink-0">18+</Tag>
              )}
            </div>
          )}
          <div className="flex flex-nowrap items-center gap-2 text-xs text-text-secondary mt-1 min-w-0 overflow-hidden">
            {mod.categoryName && (
              <span className="flex-shrink-0 px-1.5 py-0.5 bg-bg-tertiary rounded text-xs">{mod.categoryName}</span>
            )}
            <span className="flex-shrink-0">{formatBytes(mod.size)}</span>
            <span
              className="flex-shrink-0 tabular-nums"
              title={`Installed ${formatAbsoluteDate(mod.installedAt)}`}
            >
              {formatRelativeDate(mod.installedAt)}
            </span>
            {group ? (
              <span
                className="flex-shrink-0 px-1.5 py-0.5 bg-accent/15 text-accent rounded text-xs font-medium tabular-nums"
                title={variantStatusTitle}
              >
                {variantStatusLabel}
              </span>
            ) : (
              <span
                className="font-mono truncate opacity-60 hover:opacity-100 cursor-help min-w-0"
                title={mod.fileName}
              >
                {mod.fileName}
              </span>
            )}
          </div>
          {hasListTags && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 min-w-0">
              {hasConflicts && (
                <Tag tone="warning" icon={AlertTriangle} className="flex-shrink-0">
                  Conflict
                </Tag>
              )}
              {mod.sourceSection === 'Sound' && (
                <Tag tone="accent" icon={Volume2} className="flex-shrink-0">
                  Sound
                </Tag>
              )}
              {mod.nsfw && (
                <Tag tone="danger" className="flex-shrink-0">18+</Tag>
              )}
              {updateAvailable && (
                <Tag
                  tone="info"
                  icon={Download}
                  title="A newer version is available on GameBanana"
                  className="flex-shrink-0"
                >
                  Update
                </Tag>
              )}
              {mod.enabled && (
                <Tag
                  tone="accent"
                  title="Lower number loads first. When two mods overwrite the same file, the later-loaded mod wins."
                  className="flex-shrink-0 tabular-nums"
                >
                  Load #{mod.priority}
                </Tag>
              )}
            </div>
          )}
        </div>

        {/* List-mode: audio preview sits between meta and delete, using the
            empty right-side space. Grid mode puts it below the card body. */}
        {viewMode === 'list' && mod.sourceSection === 'Sound' && mod.audioUrl && (
          <div
            className="hidden md:flex w-72 flex-shrink-0 items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <AudioPreviewPlayer
              src={mod.audioUrl}
              compact
              volume={soundVolume}
              className="w-full border border-border"
            />
          </div>
        )}

        <div
          className={`flex flex-shrink-0 ${
            viewMode === 'list'
              ? 'flex-row items-center gap-2 self-center'
              : 'flex-col items-center gap-1.5'
          }`}
        >
          <button
            onClick={onDelete}
            className="p-1 text-text-secondary hover:text-red-500 transition-colors cursor-pointer"
            title="Delete mod"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onToggle}
            aria-pressed={mod.enabled}
            aria-label={mod.enabled ? 'Disable mod' : 'Enable mod'}
            title={mod.enabled ? 'Disable mod' : 'Enable mod'}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
              mod.enabled ? 'bg-accent' : 'bg-bg-tertiary border border-border'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                mod.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
              aria-hidden
            />
          </button>
        </div>
      </div>

    </div>
  );
}

interface ImportCustomModModalProps {
  onClose: () => void;
  onImport: (args: { vpkPath: string; name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;
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

function ImportCustomModModal({ onClose, onImport }: ImportCustomModModalProps) {
  const [vpkPath, setVpkPath] = useState<string>('');
  const [name, setName] = useState<string>('');
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
            Import Custom Mod
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
              aria-label={vpkPath ? `VPK selected: ${vpkPath}. Press Enter to change.` : 'Drop a VPK file here or press Enter to browse'}
              onClick={pickVpk}
              onKeyDown={(e) => onZoneKeyDown(e, pickVpk)}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setVpkDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setVpkDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setVpkDragActive(false); }}
              onDrop={handleVpkDrop}
              className={`relative flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-lg border border-dashed text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
                vpkDragActive
                  ? 'border-accent bg-accent/10'
                  : vpkPath
                    ? 'border-accent/40 bg-bg-tertiary/60 hover:bg-bg-tertiary'
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
                  <span className="text-xs text-accent">Click or drop another to replace</span>
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
              The file will be copied into your addons folder and renamed with the next available pak## priority.
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
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
