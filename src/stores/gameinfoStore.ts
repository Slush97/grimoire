import { create } from 'zustand';
import {
  fixGameinfo,
  getGameinfoStatus,
  getPerformanceConfigStatus,
  reapplyWipedPerformanceConfig,
} from '../lib/api';
import type { GameinfoStatus } from '../types/electron';

// Health of gameinfo.gi as the app-wide banner shows it. A shared store rather
// than Layout state so anything that repairs or rewrites the file (the banner,
// Settings, the performance card) can ask for a re-check and the banner never
// reports a problem that is already fixed.

interface GameinfoState {
  /** null until the first check, or while no Deadlock path is configured. */
  gameinfo: GameinfoStatus | null;
  /** A game update removed the performance config and it can be put back. */
  perfWiped: boolean;
  fixing: boolean;
  refresh: () => Promise<void>;
  /** Refresh only once the startup check has run (i.e. a Deadlock path is
   *  configured), so re-checks never flag a missing setup as a broken file. */
  recheck: () => Promise<void>;
  /** Repair search paths first, then restore the performance config. Resolves
   *  to whether the performance config was restored. */
  fix: () => Promise<{ perfRestored: boolean; perfError: string | null }>;
}

const readError = (err: unknown): GameinfoStatus => ({
  configured: false,
  reason: 'error',
  message: String(err),
  missing: false,
  candidates: [],
});

export const useGameinfoStore = create<GameinfoState>((set, get) => ({
  gameinfo: null,
  perfWiped: false,
  fixing: false,

  refresh: async () => {
    const [gameinfo, perf] = await Promise.all([
      getGameinfoStatus().catch(readError),
      getPerformanceConfigStatus().catch(() => null),
    ]);
    // A game update resets the whole file, taking Grimoire's search paths out
    // with the performance block. A file that still loads mods lost only the
    // block, so the user or another tool removed it on purpose.
    set({
      gameinfo,
      perfWiped: perf?.state === 'wiped' && !perf.canRestoreBackup && !gameinfo.configured,
    });
  },

  recheck: async () => {
    if (get().gameinfo) await get().refresh();
  },

  fix: async () => {
    set({ fixing: true });
    try {
      if (get().gameinfo?.configured === false) {
        const gameinfo = await fixGameinfo().catch(readError);
        set({ gameinfo });
        if (!gameinfo.configured) return { perfRestored: false, perfError: null };
      }
      if (!get().perfWiped) return { perfRestored: false, perfError: null };
      const perf = await reapplyWipedPerformanceConfig();
      set({ perfWiped: perf.state === 'wiped' });
      return perf.state === 'applied'
        ? { perfRestored: true, perfError: null }
        : { perfRestored: false, perfError: perf.message };
    } finally {
      set({ fixing: false });
    }
  },
}));
