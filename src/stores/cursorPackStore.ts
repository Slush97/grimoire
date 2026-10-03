import { create } from 'zustand';
import type { CursorPacksState } from '../types/electron';

// Cursor packs live outside the VPK mod list (loose BMPs the game loads via
// SDL), so they get their own small store. Shared by the Locker's Cursor tab,
// the Global gallery count and Browse's installed markers.

interface CursorPackStore extends CursorPacksState {
  loaded: boolean;
  /** A write to the game's cursor folder is in flight. */
  busy: boolean;
  load: () => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
}

export const useCursorPackStore = create<CursorPackStore>((set, get) => {
  const mutate = async (run: () => Promise<CursorPacksState>) => {
    if (get().busy) return;
    set({ busy: true });
    try {
      set({ ...(await run()), loaded: true });
    } finally {
      set({ busy: false });
    }
  };

  return {
    packs: [],
    activeId: null,
    loaded: false,
    busy: false,
    load: async () => set({ ...(await window.electronAPI.getCursorPacks()), loaded: true }),
    setActive: (id) => mutate(() => window.electronAPI.setActiveCursorPack(id)),
    remove: (id) => mutate(() => window.electronAPI.deleteCursorPack(id)),
    importPaths: (paths) => mutate(() => window.electronAPI.importCursorPack(paths)),
  };
});
