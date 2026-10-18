import { create } from 'zustand';
import { getModFileList } from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { computeUpdateFlags, type UpdateFlags } from '../lib/updateCheck';
import { updateCheckCache } from '../lib/updateCheckCache';
import { visibleInstalledMods } from '../lib/visibleMods';
import { useAppStore } from './appStore';

export const useModUpdateCheckStore = create<UpdateFlags>(() => ({
  updatesAvailable: new Set(),
  staleMergeSources: new Map(),
}));

/** One app-wide checker; page subscriptions only read its results. */
export function listenForModUpdateChecks(): () => void {
  let stopped = false;
  let checking = false;
  let revision = 0;

  const refresh = () => {
    revision += 1;
    if (!checking) void check().catch(error => console.error('[ModUpdateCheck] Check failed:', error));
  };

  async function check() {
    checking = true;
    try {
      while (!stopped) {
        const currentRevision = revision;
        const state = useAppStore.getState();
        const mods = getActiveDeadlockPath(state.settings) ? visibleInstalledMods(state.mods) : [];
        const autoMatch = state.settings?.autoMatchRemainingFiles ?? true;

        // Variants and merge ingredients share one file-list request. Absorbed
        // sources are represented by their merge, never updated independently.
        const targets = new Map<number, string>();
        for (const mod of mods) {
          if (mod.ignoreUpdates) continue;
          if (mod.gameBananaId && typeof mod.gameBananaFileId === 'number' &&
            mod.gameBananaFileId > 0 && !targets.has(mod.gameBananaId)) {
            targets.set(mod.gameBananaId, mod.sourceSection ?? 'Mod');
          }
        }
        for (const mod of mods) {
          if (mod.ignoreUpdates) continue;
          for (const source of mod.merged?.sources ?? []) {
            if (typeof source.gameBananaId === 'number' && !targets.has(source.gameBananaId)) {
              targets.set(source.gameBananaId, source.section ?? 'Mod');
            }
          }
        }

        // Serialize passes and cap network concurrency even when changes arrive
        // mid-check, so a large library cannot flood the renderer with payloads.
        const queue = [...targets];
        let cursor = 0;
        const worker = async () => {
          while (!stopped && revision === currentRevision) {
            const target = queue[cursor++];
            if (!target) return;
            const [modId, section] = target;
            try {
              await updateCheckCache.load(modId, async () => (await getModFileList(modId, section)).files);
            } catch {
              // Keep last known rows; refocusing or a library change retries.
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));

        if (stopped) return;
        if (revision !== currentRevision) continue;
        useModUpdateCheckStore.setState(computeUpdateFlags(mods, updateCheckCache.rows, autoMatch));
        if (revision === currentRevision) return;
      }
    } finally {
      checking = false;
    }
  }

  const unsubscribeMods = useAppStore.subscribe((state, previous) => {
    if (state.mods !== previous.mods) {
      // A restored load-order slot can reuse the predecessor's local ID. Drop
      // its old flag before the scan releases the download's finishing state.
      const currentById = new Map(state.mods.map(mod => [mod.id, mod]));
      const previousById = new Map(previous.mods.map(mod => [mod.id, mod]));
      const { updatesAvailable } = useModUpdateCheckStore.getState();
      const retained = [...updatesAvailable].filter(id => {
        const before = previousById.get(id);
        const after = currentById.get(id);
        return before && after && !after.ignoreUpdates && before.gameBananaId === after.gameBananaId &&
          before.gameBananaFileId === after.gameBananaFileId && (before.sourceSection ?? 'Mod') === (after.sourceSection ?? 'Mod');
      });
      if (retained.length !== updatesAvailable.size) {
        useModUpdateCheckStore.setState({ updatesAvailable: new Set(retained) });
      }
    }
    if (state.mods !== previous.mods ||
      getActiveDeadlockPath(state.settings) !== getActiveDeadlockPath(previous.settings) ||
      state.settings?.devMode !== previous.settings?.devMode ||
      state.settings?.autoMatchRemainingFiles !== previous.settings?.autoMatchRemainingFiles) refresh();
  });
  const unsubscribeCache = updateCheckCache.subscribe(refresh);
  refresh();
  return () => {
    stopped = true;
    unsubscribeMods();
    unsubscribeCache();
  };
}
