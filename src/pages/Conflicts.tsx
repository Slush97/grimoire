import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, X, EyeOff, Eye, List, LayoutGrid, Trash2 } from 'lucide-react';
import {
  getConflicts,
  disableMod,
  getMods,
  getIgnoredConflicts,
  ignoreConflict,
  unignoreConflict,
  conflictPairKey,
  reorderMods,
} from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { Mod } from '../types/mod';
import { useAppStore } from '../stores/appStore';
import { Button } from '../components/common/ui';
import { PageHeader, EmptyState, ConfirmModal, ViewModeToggle, type ViewMode } from '../components/common/PageComponents';
import ConflictReorderActions from '../components/conflicts/ConflictReorderActions';

const CONFLICTS_VIEW_MODE_KEY = 'grimoire:conflicts-view-mode';

/** Global load-order rank of a mod: lower = loads first. The pakNN (mod.priority)
 *  repeats per overflow folder, so fold in the folder index from metaKey
 *  (addons{N}/...) for a single monotonic order. Mirrors modLoadOrder in
 *  Installed.tsx so the conflict reorder matches the load-order list. */
function modLoadOrder(mod: Mod): number {
  const match = mod.metaKey.match(/^addons(\d+)\//);
  const folderIndex = match ? parseInt(match[1], 10) : 0;
  return folderIndex * 100 + mod.priority;
}
interface ModWithThumbnail {
  id: string;
  name: string;
  fileName: string;
  identity: string;
  size?: number;
  installedAt?: string;
  thumbnailUrl?: string;
  gameBananaId?: number;
  gameBananaFileId?: number;
  hasSiblingVariants?: boolean;
  variantLabel?: string;
  fileDescription?: string;
  sourceFileName?: string;
}

function getVariantLabel(mod: ModWithThumbnail): string | null {
  if (!mod.hasSiblingVariants) return null;
  return (
    mod.variantLabel?.trim() ||
    mod.fileDescription?.trim() ||
    mod.sourceFileName?.trim() ||
    null
  );
}

function normalizeIdentityPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getModConflictIdentity(mod: Mod): string {
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    if (typeof mod.gameBananaFileId === 'number' && mod.gameBananaFileId > 0) {
      return `gb:${mod.gameBananaId}:file:${mod.gameBananaFileId}`;
    }
    if (mod.sourceFileName) {
      return `gb:${mod.gameBananaId}:source:${normalizeIdentityPart(mod.sourceFileName)}`;
    }
    return `gb:${mod.gameBananaId}:mod`;
  }

  const installedStamp = Number.isFinite(Date.parse(mod.installedAt))
    ? String(Date.parse(mod.installedAt))
    : normalizeIdentityPart(mod.installedAt);
  return `local:${mod.size}:${installedStamp}`;
}

function getConflictIgnoreKey(conflict: ModConflict): string {
  return conflict.ignoreKey ?? conflictPairKey(conflict.modA, conflict.modB);
}

function ConflictsSkeleton() {
  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in" aria-busy="true" aria-live="polite">
      <div className="flex items-end justify-between gap-4 pb-4 border-b border-border mb-6">
        <div className="space-y-2">
          <div className="skeleton-shimmer bg-bg-tertiary rounded-md h-9 w-56" />
          <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-64" />
        </div>
        <div className="skeleton-shimmer bg-bg-tertiary rounded-lg h-9 w-28" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
            <div className="bg-bg-tertiary/50 px-4 py-2 border-b border-border">
              <div className="skeleton-shimmer bg-bg-tertiary rounded h-3 w-48" />
            </div>
            <div className="p-4 flex gap-4">
              {[0, 1].map((j) => (
                <div key={j} className="flex-1 space-y-2">
                  <div className="skeleton-shimmer aspect-video bg-bg-tertiary rounded-lg" />
                  <div className="skeleton-shimmer bg-bg-tertiary rounded h-3.5 w-3/4 mx-auto" />
                  <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-1/2 mx-auto" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Conflicts() {
  const [conflicts, setConflicts] = useState<ModConflict[]>([]);
  const [modsMap, setModsMap] = useState<Map<string, ModWithThumbnail>>(new Map());
  // Enabled mod ids in true load order (index 0 loads first). Drives the
  // per-conflict reorder control's "who currently wins" and the splice math.
  const [orderedEnabledIds, setOrderedEnabledIds] = useState<string[]>([]);
  // Set of ignored pair keys ("identityA::identityB" sorted). Used both to
  // filter detected conflicts (defense-in-depth — backend already filters)
  // and to render the "Ignored" panel.
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<ModWithThumbnail | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(CONFLICTS_VIEW_MODE_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  // Bulk-ignore confirmation. `ignoringAll` blocks the modal action while
  // the sequential ignoreConflict calls run so the user can't cancel
  // mid-iteration and leave the page in a partial state.
  const [ignoreAllConfirmOpen, setIgnoreAllConfirmOpen] = useState(false);
  const [ignoringAll, setIgnoringAll] = useState(false);
  const [clearIgnoredConfirmOpen, setClearIgnoredConfirmOpen] = useState(false);
  const [clearingIgnored, setClearingIgnored] = useState(false);
  const [disabling, setDisabling] = useState(false);
  // Tracks which pair the user is currently toggling so we can disable just
  // that row's buttons during the round-trip without freezing the whole page.
  const [pendingPair, setPendingPair] = useState<string | null>(null);
  const { loadMods } = useAppStore();

  const loadConflicts = async () => {
    setLoading(true);
    setError(null);
    try {
      const [conflictResult, modsResult, ignoredResult] = await Promise.all([
        getConflicts(),
        getMods(),
        getIgnoredConflicts(),
      ]);

      const map = new Map<string, ModWithThumbnail>();
      const gameBananaCounts = new Map<number, number>();
      for (const mod of modsResult as Mod[]) {
        if (typeof mod.gameBananaId !== 'number' || mod.gameBananaId <= 0) continue;
        gameBananaCounts.set(mod.gameBananaId, (gameBananaCounts.get(mod.gameBananaId) ?? 0) + 1);
      }

      for (const mod of modsResult as Mod[]) {
        const hasSiblingVariants =
          typeof mod.gameBananaId === 'number' &&
          mod.gameBananaId > 0 &&
          (gameBananaCounts.get(mod.gameBananaId) ?? 0) > 1;
        const info: ModWithThumbnail = {
          id: mod.id,
          name: mod.name,
          fileName: mod.fileName,
          identity: getModConflictIdentity(mod),
          size: mod.size,
          installedAt: mod.installedAt,
          thumbnailUrl: mod.thumbnailUrl,
          gameBananaId: mod.gameBananaId,
          gameBananaFileId: mod.gameBananaFileId,
          hasSiblingVariants,
          variantLabel: mod.variantLabel,
          fileDescription: mod.fileDescription,
          sourceFileName: mod.sourceFileName,
        };
        map.set(mod.id, info);
        map.set(info.identity, info);
      }
      setModsMap(map);
      setOrderedEnabledIds(
        (modsResult as Mod[])
          .filter((m) => m.enabled)
          .sort((a, b) => modLoadOrder(a) - modLoadOrder(b))
          .map((m) => m.id)
      );
      setConflicts(conflictResult);
      setIgnored(new Set(ignoredResult));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleIgnore = async (conflict: ModConflict) => {
    const key = getConflictIgnoreKey(conflict);
    setPendingPair(key);
    try {
      const next = await ignoreConflict(conflict.modA, conflict.modB);
      setIgnored(new Set(next));
      // Backend filters ignored pairs from get-conflicts, so dropping locally
      // keeps the UI consistent without a second round-trip.
      const remaining = conflicts.filter(
        (c) => getConflictIgnoreKey(c) !== key
      );
      setConflicts(remaining);
      // Sidebar's badge count is derived from getConflicts() and only refreshes
      // on mods-list changes. Ignore/unignore don't touch mods, so notify the
      // Sidebar explicitly — otherwise the badge stays stale until restart.
      window.dispatchEvent(new CustomEvent('grimoire:conflicts-changed'));
    } catch (err) {
      setError(String(err));
    } finally {
      setPendingPair(null);
    }
  };

  /**
   * Reorder so `winnerId` loads immediately before `loserId` (earlier load wins
   * overlapping files). Reuses reorderMods with the full enabled-mod ordering,
   * the same path the Installed load-order editor uses. For a priority conflict
   * the dense renumber also splits the shared slot, clearing the pair; a file
   * overlap stays flagged but now resolves deterministically to the winner.
   */
  const handleSetWinner = async (conflict: ModConflict, winnerId: string, loserId: string) => {
    const key = getConflictIgnoreKey(conflict);
    setPendingPair(key);
    try {
      const order = orderedEnabledIds.slice();
      const winnerIdx = order.indexOf(winnerId);
      if (winnerIdx === -1 || !order.includes(loserId)) {
        throw new Error('Both mods must be enabled to set their load order.');
      }
      order.splice(winnerIdx, 1);
      const loserIdx = order.indexOf(loserId);
      order.splice(loserIdx, 0, winnerId);
      await reorderMods(order);
      await loadMods();
      await loadConflicts();
      window.dispatchEvent(new CustomEvent('grimoire:conflicts-changed'));
    } catch (err) {
      setError(String(err));
    } finally {
      setPendingPair(null);
    }
  };

  /**
   * Bulk-ignore every currently active conflict pair. Sequential because the
   * backend persists ignored pairs into app settings — parallel calls would
   * race on the same settings object. Each call returns the full ignored
   * list, so we take the last successful result and seed `ignored` once
   * instead of N times. On any failure we re-fetch from the source of
   * truth to avoid drifting; one toast captures the failure count rather
   * than spamming the error banner per pair.
   */
  const handleIgnoreAll = async () => {
    if (conflicts.length === 0) return;
    setIgnoringAll(true);
    const pairs = conflicts.slice();
    let lastIgnored: string[] | null = null;
    const failures: string[] = [];
    try {
      for (const c of pairs) {
        try {
          lastIgnored = await ignoreConflict(c.modA, c.modB);
        } catch (err) {
          failures.push(`${c.modA} ↔ ${c.modB}: ${String(err)}`);
        }
      }
      if (lastIgnored) setIgnored(new Set(lastIgnored));
      if (failures.length === 0) {
        setConflicts([]);
      } else {
        // Partial failure — backend is the source of truth, refetch.
        await loadConflicts();
        setError(`Failed to ignore ${failures.length} pair${failures.length === 1 ? '' : 's'}. See console for details.`);
        console.warn('[Conflicts] ignore-all failures:', failures);
      }
      // Single event after the whole batch — the Sidebar badge re-fetches
      // once instead of N times during the loop.
      window.dispatchEvent(new CustomEvent('grimoire:conflicts-changed'));
    } finally {
      setIgnoringAll(false);
      setIgnoreAllConfirmOpen(false);
    }
  };

  const handleUnignore = async (key: string) => {
    const [modA, modB] = key.split('::');
    if (!modA || !modB) return;
    setPendingPair(key);
    try {
      const next = await unignoreConflict(modA, modB);
      setIgnored(new Set(next));
      // Re-detect so the unignored pair shows back up if still conflicting.
      const fresh = await getConflicts();
      setConflicts(fresh);
      window.dispatchEvent(new CustomEvent('grimoire:conflicts-changed'));
    } catch (err) {
      setError(String(err));
    } finally {
      setPendingPair(null);
    }
  };

  const handleClearIgnored = async () => {
    if (ignored.size === 0) return;
    setClearingIgnored(true);
    const keys = Array.from(ignored);
    const failures: string[] = [];
    try {
      for (const key of keys) {
        const [modA, modB] = key.split('::');
        if (!modA || !modB) continue;
        try {
          await unignoreConflict(modA, modB);
        } catch (err) {
          failures.push(`${key}: ${String(err)}`);
        }
      }
      await loadConflicts();
      if (failures.length > 0) {
        console.warn('[Conflicts] clear ignored failures:', failures);
        setError(`Failed to clear ${failures.length} ignored pair${failures.length === 1 ? '' : 's'}. See console for details.`);
      }
      window.dispatchEvent(new CustomEvent('grimoire:conflicts-changed'));
    } finally {
      setClearingIgnored(false);
      setClearIgnoredConfirmOpen(false);
    }
  };

  useEffect(() => {
    loadConflicts();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CONFLICTS_VIEW_MODE_KEY, viewMode === 'list' ? 'list' : 'grid');
    } catch {
      // localStorage may be unavailable.
    }
  }, [viewMode]);

  const confirmDisable = async () => {
    if (!disableTarget) return;
    setDisabling(true);
    try {
      await disableMod(disableTarget.id);
      await loadMods();
      await loadConflicts();
      setDisableTarget(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setDisabling(false);
    }
  };

  const getModInfo = (modId: string, fallbackName: string): ModWithThumbnail => {
    return modsMap.get(modId) || { id: modId, name: fallbackName, fileName: '', identity: modId };
  };

  if (loading) {
    return <ConflictsSkeleton />;
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <EmptyState
          icon={AlertTriangle}
          title="Error Loading Conflicts"
          description={error ?? undefined}
          variant="error"
          action={
            <Button onClick={loadConflicts}>Retry</Button>
          }
        />
      </div>
    );
  }

  if (conflicts.length === 0 && ignored.size === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <EmptyState
          icon={CheckCircle}
          title="No Conflicts Detected"
          description="Your installed mods don't have any conflicts. Great!"
          action={
            <Button variant="secondary" onClick={loadConflicts} icon={RefreshCw}>Refresh</Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title={`Conflicts (${conflicts.length})`}
        description={
          conflicts.length === 0
            ? 'No active conflicts — review or restore your ignored pairs below.'
            : 'Resolve conflicts between installed mods'
        }
        action={
          <div className="flex items-center gap-2">
            {conflicts.length > 0 && (
              <ViewModeToggle
                value={viewMode}
                onChange={(mode) => setViewMode(mode === 'list' ? 'list' : 'grid')}
                options={[
                  { value: 'grid', label: 'Grid view', icon: LayoutGrid },
                  { value: 'list', label: 'List view', icon: List },
                ]}
              />
            )}
            {conflicts.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => setIgnoreAllConfirmOpen(true)}
                icon={EyeOff}
                title="Move every active conflict pair to the Ignored section. Reversible per-pair via Unignore."
              >
                Ignore all
              </Button>
            )}
            <Button variant="secondary" onClick={loadConflicts} icon={RefreshCw}>Refresh</Button>
          </div>
        }
        className="mb-6"
      />

      {/* Empty active-conflict slot when every conflict has been dismissed.
          We don't redirect to the global empty state because the user still
          has the ignored list to manage — making everything disappear would
          hide the only path back. */}
      {conflicts.length === 0 && (
        <div className="mb-6 p-4 rounded-xl border border-border bg-bg-secondary text-sm text-text-secondary flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />
          No active conflicts. {ignored.size > 0 && `${ignored.size} pair(s) currently ignored — see below.`}
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="space-y-3">
          {conflicts.map((conflict, i) => {
            const modA = getModInfo(conflict.modA, conflict.modAName);
            const modB = getModInfo(conflict.modB, conflict.modBName);
            const variantA = getVariantLabel(modA);
            const variantB = getVariantLabel(modB);

            const renderListSide = (mod: ModWithThumbnail, variant: string | null) => (
              <div className="min-w-0 flex items-center gap-3">
                <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded-md bg-bg-tertiary">
                  {mod.thumbnailUrl ? (
                    <img src={mod.thumbnailUrl} alt={mod.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] text-text-tertiary">
                      No Preview
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary" title={mod.name}>
                    {mod.name}
                  </p>
                  {variant && (
                    <p className="truncate text-xs text-accent" title={variant}>
                      {variant}
                    </p>
                  )}
                  {mod.fileName && (
                    <p className="truncate text-xs text-text-tertiary" title={mod.fileName}>
                      {mod.fileName}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDisableTarget(mod)}
                  aria-label={`Disable ${mod.name}`}
                  title={`Disable ${mod.name}`}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );

            return (
              <div
                key={`${conflict.modA}-${conflict.modB}-${i}`}
                className="overflow-hidden rounded-xl border border-yellow-500/30 bg-bg-secondary"
              >
                <div className="flex items-center gap-2 border-b border-yellow-500/20 bg-yellow-500/10 px-4 py-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-yellow-400" title={conflict.details}>
                    {conflict.details}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleIgnore(conflict)}
                    disabled={pendingPair === getConflictIgnoreKey(conflict)}
                    title="Stop flagging this pair as a conflict"
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    Ignore
                  </button>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-center gap-3 p-4">
                  {renderListSide(modA, variantA)}
                  <span className="text-center text-sm font-bold text-text-tertiary">VS</span>
                  {renderListSide(modB, variantB)}
                </div>
                <ConflictReorderActions
                  conflict={conflict}
                  modA={{ id: modA.id, name: modA.name }}
                  modB={{ id: modB.id, name: modB.name }}
                  orderedEnabledIds={orderedEnabledIds}
                  busy={pendingPair === getConflictIgnoreKey(conflict)}
                  onSetWinner={(winnerId, loserId) => handleSetWinner(conflict, winnerId, loserId)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {conflicts.map((conflict, i) => {
            const modA = getModInfo(conflict.modA, conflict.modAName);
            const modB = getModInfo(conflict.modB, conflict.modBName);
            const variantA = getVariantLabel(modA);
            const variantB = getVariantLabel(modB);

            return (
              <div
                key={`${conflict.modA}-${conflict.modB}-${i}`}
                className="bg-bg-secondary border border-yellow-500/30 rounded-xl overflow-hidden"
              >
                {/* Header */}
                <div className="bg-yellow-500/10 px-4 py-2 flex items-center gap-2 border-b border-yellow-500/20">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                  <span className="text-sm text-yellow-400 min-w-0 flex-1 truncate" title={conflict.details}>
                    {conflict.details}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleIgnore(conflict)}
                    disabled={pendingPair === getConflictIgnoreKey(conflict)}
                    title="Stop flagging this pair as a conflict"
                    className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    Ignore
                  </button>
                </div>

                {/* Two mod cards */}
                <div className="p-4 grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] gap-3 items-start">
                  {/* Mod A Card */}
                  <div className="min-w-0 group">
                    <div className="relative w-full aspect-video bg-bg-tertiary rounded-lg overflow-hidden mb-2">
                      {modA.thumbnailUrl ? (
                        <img
                          src={modA.thumbnailUrl}
                          alt={modA.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-text-tertiary">
                          No Preview
                        </div>
                      )}
                      <button
                        onClick={() => setDisableTarget(modA)}
                        aria-label={`Disable ${modA.name}`}
                        className="absolute inset-x-0 bottom-0 bg-red-600 hover:bg-red-500 flex items-center justify-center py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                      >
                        <span className="text-white text-sm font-medium flex items-center gap-1">
                          <X className="w-4 h-4" /> Disable
                        </span>
                      </button>
                    </div>
                    <p className="text-sm font-medium text-text-primary text-center break-words" title={modA.name}>
                      {modA.name}
                    </p>
                    {variantA && (
                      <p className="text-xs text-accent text-center break-words" title={variantA}>
                        {variantA}
                      </p>
                    )}
                    {modA.fileName && (
                      <p className="text-xs text-text-tertiary text-center break-all" title={modA.fileName}>
                        {modA.fileName}
                      </p>
                    )}
                  </div>

                  {/* VS divider */}
                  <div className="h-full flex items-center justify-center">
                    <span className="text-text-tertiary text-sm font-bold">VS</span>
                  </div>

                  {/* Mod B Card */}
                  <div className="min-w-0 group">
                    <div className="relative w-full aspect-video bg-bg-tertiary rounded-lg overflow-hidden mb-2">
                      {modB.thumbnailUrl ? (
                        <img
                          src={modB.thumbnailUrl}
                          alt={modB.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-text-tertiary">
                          No Preview
                        </div>
                      )}
                      <button
                        onClick={() => setDisableTarget(modB)}
                        aria-label={`Disable ${modB.name}`}
                        className="absolute inset-x-0 bottom-0 bg-red-600 hover:bg-red-500 flex items-center justify-center py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                      >
                        <span className="text-white text-sm font-medium flex items-center gap-1">
                          <X className="w-4 h-4" /> Disable
                        </span>
                      </button>
                    </div>
                    <p className="text-sm font-medium text-text-primary text-center break-words" title={modB.name}>
                      {modB.name}
                    </p>
                    {variantB && (
                      <p className="text-xs text-accent text-center break-words" title={variantB}>
                        {variantB}
                      </p>
                    )}
                    {modB.fileName && (
                      <p className="text-xs text-text-tertiary text-center break-all" title={modB.fileName}>
                        {modB.fileName}
                      </p>
                    )}
                  </div>
                </div>

                <ConflictReorderActions
                  conflict={conflict}
                  modA={{ id: modA.id, name: modA.name }}
                  modB={{ id: modB.id, name: modB.name }}
                  orderedEnabledIds={orderedEnabledIds}
                  busy={pendingPair === getConflictIgnoreKey(conflict)}
                  onSetWinner={(winnerId, loserId) => handleSetWinner(conflict, winnerId, loserId)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Ignored conflicts panel — sits at the bottom of the page so the
          live conflict list stays the primary focus. Each row shows the two
          mod names plus an Unignore action that re-runs detection so the
          pair shows back up if it's still actually conflicting. */}
      {ignored.size > 0 && (
        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary flex items-center gap-2">
              <EyeOff className="w-4 h-4" />
              Ignored ({ignored.size})
            </h3>
            <Button
              variant="secondary"
              size="sm"
              icon={Trash2}
              onClick={() => setClearIgnoredConfirmOpen(true)}
              title="Restore conflict detection for every ignored pair"
            >
              Clear ignored
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-bg-secondary divide-y divide-border">
            {Array.from(ignored).map((key) => {
              const [idA, idB] = key.split('::');
              const a = modsMap.get(idA);
              const b = modsMap.get(idB);
              // If either mod was uninstalled while ignored we still show the
              // entry (using a placeholder) so the user can clean it up. The
              // backend's filter is a no-op for missing ids — they just
              // never re-appear as active conflicts.
              const aName = a?.name ?? '(removed mod)';
              const bName = b?.name ?? '(removed mod)';
              const aVariant = a ? getVariantLabel(a) : null;
              const bVariant = b ? getVariantLabel(b) : null;
              return (
                <div key={key} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 flex items-center gap-2 text-sm">
                    <span className="truncate text-text-primary" title={aVariant ? `${aName} - ${aVariant}` : aName}>
                      {aName}{aVariant ? ` (${aVariant})` : ''}
                    </span>
                    <span className="text-text-tertiary text-xs flex-shrink-0">vs</span>
                    <span className="truncate text-text-primary" title={bVariant ? `${bName} - ${bVariant}` : bName}>
                      {bName}{bVariant ? ` (${bVariant})` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnignore(key)}
                    disabled={pendingPair === key}
                    className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Restore conflict detection for this pair"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Unignore
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={disableTarget !== null}
        onCancel={() => !disabling && setDisableTarget(null)}
        onConfirm={confirmDisable}
        title="Disable this mod?"
        message={
          disableTarget ? (
            <>
              <p className="mb-2">
                <span className="text-text-primary font-medium">{disableTarget.name}</span> will be disabled and moved out of the addons folder. You can re-enable it from the Installed page.
              </p>
              {getVariantLabel(disableTarget) && (
                <p className="text-xs text-accent truncate" title={getVariantLabel(disableTarget) ?? undefined}>
                  {getVariantLabel(disableTarget)}
                </p>
              )}
              {disableTarget.fileName && (
                <p className="text-xs font-mono text-text-tertiary truncate" title={disableTarget.fileName}>{disableTarget.fileName}</p>
              )}
            </>
          ) : ''
        }
        confirmLabel={disabling ? 'Disabling…' : 'Disable'}
        variant="danger"
      />

      <ConfirmModal
        isOpen={ignoreAllConfirmOpen}
        onCancel={() => !ignoringAll && setIgnoreAllConfirmOpen(false)}
        onConfirm={handleIgnoreAll}
        title={`Ignore all ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}?`}
        message={
          <>
            <p className="mb-2">
              Every currently active conflict pair will move to the <span className="text-text-primary font-medium">Ignored</span> section below.
            </p>
            <p className="text-xs text-text-tertiary">
              Reversible — you can restore any pair individually with <em>Unignore</em>.
            </p>
          </>
        }
        confirmLabel={ignoringAll ? 'Ignoring…' : `Ignore ${conflicts.length}`}
      />

      <ConfirmModal
        isOpen={clearIgnoredConfirmOpen}
        onCancel={() => !clearingIgnored && setClearIgnoredConfirmOpen(false)}
        onConfirm={handleClearIgnored}
        title={`Clear ${ignored.size} ignored conflict${ignored.size === 1 ? '' : 's'}?`}
        message={
          <>
            <p className="mb-2">
              Every ignored pair will be restored to normal conflict detection.
            </p>
            <p className="text-xs text-text-tertiary">
              Pairs that still conflict will reappear in the active list after refresh.
            </p>
          </>
        }
        confirmLabel={clearingIgnored ? 'Clearing…' : 'Clear ignored'}
      />
    </div>
  );
}
