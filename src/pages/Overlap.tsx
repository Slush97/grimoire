import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, CircleHelp, EyeOff, RefreshCw, Search, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  getConflicts,
  disableMod,
  getMods,
  getIgnoredConflicts,
  ignoreConflict,
  unignoreConflict,
  getIgnoredConflictFiles,
  ignoreConflictFile,
  unignoreConflictFile,
  getIgnoredConflictFilesGlobal,
  ignoreConflictFileGlobal,
  unignoreConflictFileGlobal,
  getIgnoredConflictMods,
  ignoreConflictMod,
  unignoreConflictMod,
  conflictPairKey,
  reorderMods,
} from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { Mod } from '../types/mod';
import { useAppStore } from '../stores/appStore';
import { showToast } from '../stores/toastStore';
import { modLoadOrder } from '../lib/lockerUtils';
import { searchConflicts } from '../lib/conflictSearch';
import { Button, IconButton } from '../components/common/ui';
import { Input } from '../components/common/forms';
import { Skeleton } from '../components/common/Skeleton';
import { PageHeader, EmptyState, ConfirmModal, PageLayout } from '../components/common/PageComponents';
import OverlapCard, { type OverlapMod } from '../components/overlap/OverlapCard';
import IgnoredOverlaps, { type IgnoredTab } from '../components/overlap/IgnoredOverlaps';
import OverlapExplainer from '../components/overlap/OverlapExplainer';

function normalizeIdentityPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Mirrors modConflictIdentity in electron/main/services/conflicts.ts so ignore
// keys, which are identity pairs, resolve back to installed mods.
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

function ignoreKeyOf(conflict: ModConflict): string {
  return conflict.ignoreKey ?? conflictPairKey(conflict.modA, conflict.modB);
}

function notifyChanged() {
  // The Sidebar badge only re-counts on mod-list changes; ignore/unignore
  // don't touch mods, so tell it directly.
  window.dispatchEvent(new CustomEvent('grimoire:conflicts-changed'));
}

type Confirm = { kind: 'ignoreAll' } | { kind: 'restoreAll'; tab: IgnoredTab };

function OverlapAbout() {
  return (
    <Trans
      i18nKey="overlap.about"
      components={{
        settingsLink: (
          <Link
            to="/settings/preferences"
            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
          />
        ),
      }}
    />
  );
}

function OverlapSkeleton() {
  return (
    <PageLayout>
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-8 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-sm border border-border bg-bg-secondary px-5 pb-12 pt-5">
            <div className="relative aspect-[3/1]">
              <Skeleton className="absolute left-0 top-1/2 aspect-video w-[58%] -translate-y-1/2" />
              <Skeleton className="absolute right-0 top-1/2 aspect-video w-[58%] -translate-y-1/2 opacity-50" />
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}

export default function Overlap() {
  const { t } = useTranslation();
  const loadMods = useAppStore((s) => s.loadMods);
  const [conflicts, setConflicts] = useState<ModConflict[]>([]);
  // Keyed by both mod id and conflict identity, since ignore lists store identities.
  const [modsMap, setModsMap] = useState<Map<string, OverlapMod>>(new Map());
  // Enabled mod ids in true load order (index 0 loads first and wins).
  const [orderedEnabledIds, setOrderedEnabledIds] = useState<string[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [ignoredFiles, setIgnoredFiles] = useState<Record<string, string[]>>({});
  const [ignoredFilesGlobal, setIgnoredFilesGlobal] = useState<string[]>([]);
  const [ignoredMods, setIgnoredMods] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Pair key, path or identity of the row whose action is in flight.
  const [pending, setPending] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<OverlapMod | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const clearSearch = () => {
    setSearch('');
    setDebouncedSearch('');
  };
  const searchNeedle = debouncedSearch.trim().toLowerCase();
  const searchResults = useMemo(() => {
    const results = searchConflicts(conflicts, modsMap, searchNeedle);
    // Same-slot pairs have no defined winner, so they go first.
    return results.sort(
      (a, b) => Number(b.conflict.conflictType === 'priority') - Number(a.conflict.conflictType === 'priority'),
    );
  }, [conflicts, modsMap, searchNeedle]);
  const loadIndex = useMemo(() => new Map(orderedEnabledIds.map((id, i) => [id, i])), [orderedEnabledIds]);

  const load = async () => {
    try {
      const [conflictResult, modsResult, ignoredResult, ignoredFilesResult, ignoredFilesGlobalResult, ignoredModsResult] =
        await Promise.all([
          getConflicts(),
          getMods(),
          getIgnoredConflicts(),
          getIgnoredConflictFiles(),
          getIgnoredConflictFilesGlobal(),
          getIgnoredConflictMods(),
        ]);

      const gameBananaCounts = new Map<number, number>();
      for (const mod of modsResult) {
        if (typeof mod.gameBananaId !== 'number' || mod.gameBananaId <= 0) continue;
        gameBananaCounts.set(mod.gameBananaId, (gameBananaCounts.get(mod.gameBananaId) ?? 0) + 1);
      }
      const map = new Map<string, OverlapMod>();
      for (const mod of modsResult) {
        const hasSiblingVariants = (gameBananaCounts.get(mod.gameBananaId ?? 0) ?? 0) > 1;
        const info: OverlapMod = {
          id: mod.id,
          name: mod.name,
          fileName: mod.fileName,
          identity: getModConflictIdentity(mod),
          thumbnailUrl: mod.thumbnailUrl,
          variant: hasSiblingVariants
            ? mod.variantLabel?.trim() || mod.fileDescription?.trim() || mod.sourceFileName?.trim() || null
            : null,
          global: mod.priorityMod,
        };
        map.set(mod.id, info);
        map.set(info.identity, info);
      }
      setLoadError(null);
      setModsMap(map);
      setOrderedEnabledIds(
        modsResult
          .filter((m) => m.enabled)
          .sort((a, b) => modLoadOrder(a) - modLoadOrder(b))
          .map((m) => m.id),
      );
      setConflicts(conflictResult);
      setIgnored(ignoredResult);
      setIgnoredFiles(ignoredFilesResult);
      setIgnoredFilesGlobal(ignoredFilesGlobalResult);
      setIgnoredMods(ignoredModsResult);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Runs one row action, then re-detects so the list matches the backend.
  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key);
    try {
      await action();
      setConflicts(await getConflicts());
      notifyChanged();
    } catch (err) {
      showToast(String(err), { tone: 'error' });
    } finally {
      setPending(null);
    }
  };

  // Several sequential calls (they all rewrite the same settings object), then
  // one full reload. Failures are counted into a single toast.
  const runBatch = async (calls: (() => Promise<unknown>)[]) => {
    let failed = 0;
    for (const call of calls) {
      try {
        await call();
      } catch (err) {
        failed += 1;
        console.warn('[Overlap] batch call failed:', err);
      }
    }
    await load();
    notifyChanged();
    if (failed > 0) showToast(t('overlap.errors.batchFailed', { count: failed }), { tone: 'error' });
  };

  const handleSetWinner = (conflict: ModConflict, winner: OverlapMod, loser: OverlapMod): Promise<void> =>
    run(ignoreKeyOf(conflict), async () => {
      const order = orderedEnabledIds.filter((id) => id !== winner.id);
      const loserIdx = order.indexOf(loser.id);
      if (loserIdx === -1 || !orderedEnabledIds.includes(winner.id)) {
        throw new Error(t('overlap.errors.bothEnabled'));
      }
      order.splice(loserIdx, 0, winner.id);
      await reorderMods(order);
      await loadMods();
      await load();
    });

  const confirmDisable = async () => {
    if (!disableTarget) return;
    setDisabling(true);
    try {
      await disableMod(disableTarget.id);
      await loadMods();
      await load();
      setDisableTarget(null);
    } catch (err) {
      showToast(String(err), { tone: 'error' });
    } finally {
      setDisabling(false);
    }
  };

  // Ignore entries whose mods are gone can never match again, so they're
  // hidden from the list and offered for cleanup instead.
  const pairInstalled = (key: string) => key.split('::').every((part) => modsMap.has(part));
  const livePairs = ignored.filter(pairInstalled);
  const liveFiles = Object.fromEntries(Object.entries(ignoredFiles).filter(([key]) => pairInstalled(key)));
  const liveMods = ignoredMods.filter((identity) => modsMap.has(identity));
  const stalePairs = ignored.filter((key) => !pairInstalled(key));
  const staleFilePairs = Object.keys(ignoredFiles).filter((key) => !pairInstalled(key));
  const staleMods = ignoredMods.filter((identity) => !modsMap.has(identity));
  const staleCount = stalePairs.length + staleFilePairs.length + staleMods.length;

  const unignorePair = (key: string) => {
    const [a, b] = key.split('::');
    return unignoreConflict(a, b);
  };

  const forgetStale = () =>
    runBatch([
      ...stalePairs.map((key) => () => unignorePair(key)),
      ...staleFilePairs.map((key) => () => unignoreConflictFile(key, null)),
      ...staleMods.map((identity) => () => unignoreConflictMod(identity)),
    ]);

  const handleConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === 'ignoreAll') {
        await runBatch(conflicts.map((c) => () => ignoreConflict(c.modA, c.modB)));
      } else if (confirm.tab === 'pairs') {
        await runBatch(livePairs.map((key) => () => unignorePair(key)));
      } else if (confirm.tab === 'files') {
        await runBatch([
          ...Object.keys(liveFiles).map((key) => () => unignoreConflictFile(key, null)),
          ...ignoredFilesGlobal.map((path) => () => unignoreConflictFileGlobal(path)),
        ]);
      } else {
        await runBatch(liveMods.map((identity) => () => unignoreConflictMod(identity)));
      }
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  };

  if (loading) return <OverlapSkeleton />;

  if (loadError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t('overlap.errorTitle')}
        description={loadError}
        variant="error"
        action={<Button onClick={refresh}>{t('common.actions.retry')}</Button>}
      />
    );
  }

  const hasIgnored =
    ignored.length > 0 || Object.keys(ignoredFiles).length > 0 || ignoredFilesGlobal.length > 0 || ignoredMods.length > 0;

  if (conflicts.length === 0 && !hasIgnored) {
    return (
      <>
        <EmptyState
          icon={CheckCircle}
          title={t('overlap.empty.title')}
          description={<OverlapAbout />}
          action={
            <div className="flex items-center gap-2">
              <Button variant="secondary" icon={CircleHelp} onClick={() => setExplainerOpen(true)}>
                {t('overlap.actions.help')}
              </Button>
              <Button variant="secondary" icon={RefreshCw} onClick={refresh} isLoading={refreshing}>
                {t('common.actions.refresh')}
              </Button>
            </div>
          }
        />
        <OverlapExplainer open={explainerOpen} onClose={() => setExplainerOpen(false)} />
      </>
    );
  }

  const confirmCount =
    confirm?.kind === 'ignoreAll'
      ? conflicts.length
      : confirm?.tab === 'pairs'
        ? livePairs.length
        : confirm?.tab === 'files'
          ? Object.values(liveFiles).reduce((sum, files) => sum + files.length, 0) + ignoredFilesGlobal.length
          : liveMods.length;

  return (
    <PageLayout className="space-y-6">
      <PageHeader
        title={t('overlap.title')}
        intro={<OverlapAbout />}
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" icon={CircleHelp} onClick={() => setExplainerOpen(true)}>
              {t('overlap.actions.help')}
            </Button>
            {conflicts.length > 1 && (
              <Button
                variant="ghost"
                icon={EyeOff}
                onClick={() => setConfirm({ kind: 'ignoreAll' })}
                title={t('overlap.actions.ignoreAllTitle')}
              >
                {t('overlap.actions.ignoreAll')}
              </Button>
            )}
            <IconButton icon={RefreshCw} label={t('common.actions.refresh')} onClick={refresh} disabled={refreshing} />
          </div>
        }
      />

      {conflicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Input
              type="search"
              icon={Search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') clearSearch();
              }}
              placeholder={t('overlap.search.placeholder')}
              aria-label={t('overlap.search.label')}
              className="pr-10"
            />
            {search && (
              <IconButton
                icon={X}
                size="sm"
                label={t('overlap.search.clear')}
                onClick={clearSearch}
                className="absolute right-1 top-1/2 -translate-y-1/2 border-transparent"
              />
            )}
          </div>
          {searchNeedle && (
            <p className="text-xs text-text-secondary" role="status">
              {t('overlap.search.resultCount', { count: searchResults.length, total: conflicts.length })}
            </p>
          )}
        </div>
      )}

      {searchNeedle && searchResults.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('overlap.search.noResults')}
          description={t('overlap.search.noResultsHint')}
          className="py-12"
        />
      ) : (
        conflicts.length > 0 && (
          <ul className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {searchResults.map(({ conflict, files, fileMatch }) => {
              const modA = modsMap.get(conflict.modA) ?? {
                id: conflict.modA, name: conflict.modAName, fileName: '', identity: conflict.modAIdentity, variant: null,
              };
              const modB = modsMap.get(conflict.modB) ?? {
                id: conflict.modB, name: conflict.modBName, fileName: '', identity: conflict.modBIdentity, variant: null,
              };
              // Detection lists a pair in load order, and a reorder renames the
              // pakNN files (so the ids). Sides and the React key follow the
              // stable identity instead, so a swap restacks in place.
              const [a, b] = modA.identity <= modB.identity ? [modA, modB] : [modB, modA];
              const key = ignoreKeyOf(conflict);
              return (
                <OverlapCard
                  key={key}
                  conflict={conflict}
                  a={a}
                  b={b}
                  winnerId={(loadIndex.get(a.id) ?? Infinity) <= (loadIndex.get(b.id) ?? Infinity) ? a.id : b.id}
                  files={files}
                  autoOpen={fileMatch}
                  busy={pending === key}
                  onSetWinner={(winner, loser) => handleSetWinner(conflict, winner, loser)}
                  onIgnore={() =>
                    run(key, async () => {
                      setIgnored(await ignoreConflict(conflict.modA, conflict.modB));
                    })
                  }
                  onIgnoreMod={(mod) =>
                    run(key, async () => {
                      setIgnoredMods(await ignoreConflictMod(mod.identity));
                    })
                  }
                  onDisable={setDisableTarget}
                  onIgnoreFile={(path) =>
                    run(key, async () => {
                      setIgnoredFiles(await ignoreConflictFile(key, path));
                    })
                  }
                  onIgnoreFileEverywhere={(path) =>
                    run(key, async () => {
                      setIgnoredFilesGlobal(await ignoreConflictFileGlobal(path));
                    })
                  }
                />
              );
            })}
          </ul>
        )
      )}

      <IgnoredOverlaps
        pairs={livePairs}
        filesByPair={liveFiles}
        globalFiles={ignoredFilesGlobal}
        mods={liveMods}
        staleCount={staleCount}
        lookup={(key) => modsMap.get(key)}
        pending={pending}
        defaultOpen={conflicts.length === 0}
        onRestorePair={(key) =>
          run(key, async () => {
            setIgnored(await unignorePair(key));
          })
        }
        onRestoreFile={(key, path) =>
          run(key, async () => {
            setIgnoredFiles(await unignoreConflictFile(key, path));
          })
        }
        onRestoreGlobalFile={(path) =>
          run(path, async () => {
            setIgnoredFilesGlobal(await unignoreConflictFileGlobal(path));
          })
        }
        onRestoreMod={(identity) =>
          run(identity, async () => {
            setIgnoredMods(await unignoreConflictMod(identity));
          })
        }
        onRestoreAll={(tab) => setConfirm({ kind: 'restoreAll', tab })}
        onForgetStale={forgetStale}
      />

      <OverlapExplainer open={explainerOpen} onClose={() => setExplainerOpen(false)} />

      <ConfirmModal
        isOpen={disableTarget !== null}
        onCancel={() => setDisableTarget(null)}
        onConfirm={confirmDisable}
        busy={disabling}
        variant="danger"
        title={t('overlap.confirm.disableTitle', { name: disableTarget?.name })}
        message={t('overlap.confirm.disableMessage')}
        confirmLabel={t('overlap.confirm.disable')}
      />

      <ConfirmModal
        isOpen={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm}
        busy={confirmBusy}
        title={
          confirm?.kind === 'ignoreAll'
            ? t('overlap.confirm.ignoreAllTitle', { count: confirmCount })
            : t('overlap.confirm.restoreAllTitle', { count: confirmCount })
        }
        message={
          confirm?.kind === 'ignoreAll' ? t('overlap.confirm.ignoreAllMessage') : t('overlap.confirm.restoreAllMessage')
        }
        confirmLabel={confirm?.kind === 'ignoreAll' ? t('overlap.actions.ignoreAll') : t('overlap.ignored.restoreAll')}
      />
    </PageLayout>
  );
}
