import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, X, EyeOff, Eye } from 'lucide-react';
import {
  getConflicts,
  disableMod,
  getMods,
  getIgnoredConflicts,
  ignoreConflict,
  unignoreConflict,
  conflictPairKey,
} from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { Mod } from '../types/mod';
import { useAppStore } from '../stores/appStore';
import { Button } from '../components/common/ui';
import { PageHeader, EmptyState, ConfirmModal } from '../components/common/PageComponents';
interface ModWithThumbnail {
  id: string;
  name: string;
  fileName: string;
  thumbnailUrl?: string;
}

function ConflictsSkeleton() {
  return (
    <div className="p-6 animate-fade-in" aria-busy="true" aria-live="polite">
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
  // Set of ignored pair keys ("idA::idB" sorted). Used both to filter
  // detected conflicts (defense-in-depth — backend already filters) and to
  // render the "Ignored" panel.
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<ModWithThumbnail | null>(null);
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
      for (const mod of modsResult as Mod[]) {
        map.set(mod.id, {
          id: mod.id,
          name: mod.name,
          fileName: mod.fileName,
          thumbnailUrl: mod.thumbnailUrl,
        });
      }
      setModsMap(map);
      setConflicts(conflictResult);
      setIgnored(new Set(ignoredResult));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleIgnore = async (modA: string, modB: string) => {
    const key = conflictPairKey(modA, modB);
    setPendingPair(key);
    try {
      const next = await ignoreConflict(modA, modB);
      setIgnored(new Set(next));
      // Backend filters ignored pairs from get-conflicts, so dropping locally
      // keeps the UI consistent without a second round-trip.
      setConflicts((prev) =>
        prev.filter((c) => conflictPairKey(c.modA, c.modB) !== key)
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setPendingPair(null);
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
    } catch (err) {
      setError(String(err));
    } finally {
      setPendingPair(null);
    }
  };

  useEffect(() => {
    loadConflicts();
  }, []);

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
    return modsMap.get(modId) || { id: modId, name: fallbackName, fileName: '' };
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
    <div className="p-6">
      <PageHeader
        title={`Conflicts (${conflicts.length})`}
        description={
          conflicts.length === 0
            ? 'No active conflicts — review or restore your ignored pairs below.'
            : 'Resolve conflicts between installed mods'
        }
        action={
          <Button variant="secondary" onClick={loadConflicts} icon={RefreshCw}>Refresh</Button>
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

      {/* Grid of conflict cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {conflicts.map((conflict, i) => {
          const modA = getModInfo(conflict.modA, conflict.modAName);
          const modB = getModInfo(conflict.modB, conflict.modBName);

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
                  onClick={() => handleIgnore(conflict.modA, conflict.modB)}
                  disabled={pendingPair === conflictPairKey(conflict.modA, conflict.modB)}
                  title="Stop flagging this pair as a conflict"
                  className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Ignore
                </button>
              </div>

              {/* Two mod cards */}
              <div className="p-4 flex gap-4">
                {/* Mod A Card */}
                <div className="flex-1 group">
                  <div className="relative aspect-video bg-bg-tertiary rounded-lg overflow-hidden mb-2">
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
                  <p className="text-sm font-medium text-text-primary text-center truncate">
                    {modA.name}
                  </p>
                  {modA.fileName && (
                    <p className="text-xs text-text-tertiary text-center truncate" title={modA.fileName}>
                      {modA.fileName}
                    </p>
                  )}
                </div>

                {/* VS divider */}
                <div className="flex items-center">
                  <span className="text-text-tertiary text-sm font-bold">VS</span>
                </div>

                {/* Mod B Card */}
                <div className="flex-1 group">
                  <div className="relative aspect-video bg-bg-tertiary rounded-lg overflow-hidden mb-2">
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
                  <p className="text-sm font-medium text-text-primary text-center truncate">
                    {modB.name}
                  </p>
                  {modB.fileName && (
                    <p className="text-xs text-text-tertiary text-center truncate" title={modB.fileName}>
                      {modB.fileName}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ignored conflicts panel — sits at the bottom of the page so the
          live conflict list stays the primary focus. Each row shows the two
          mod names plus an Unignore action that re-runs detection so the
          pair shows back up if it's still actually conflicting. */}
      {ignored.size > 0 && (
        <div className="mt-10">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary mb-3 flex items-center gap-2">
            <EyeOff className="w-4 h-4" />
            Ignored ({ignored.size})
          </h3>
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
              return (
                <div key={key} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 flex items-center gap-2 text-sm">
                    <span className="truncate text-text-primary" title={aName}>{aName}</span>
                    <span className="text-text-tertiary text-xs flex-shrink-0">vs</span>
                    <span className="truncate text-text-primary" title={bName}>{bName}</span>
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
              {disableTarget.fileName && (
                <p className="text-xs font-mono text-text-tertiary truncate" title={disableTarget.fileName}>{disableTarget.fileName}</p>
              )}
            </>
          ) : ''
        }
        confirmLabel={disabling ? 'Disabling…' : 'Disable'}
        variant="danger"
      />
    </div>
  );
}
