import { create } from 'zustand';
import { getGamebananaCategories } from '../lib/api';
import { buildHeroByCategoryId } from '../lib/lockerUtils';

interface HeroCategoryStore {
  /** buildHeroByCategoryId output. Empty until loaded. */
  heroByCategoryId: ReadonlyMap<number, string>;
  load: () => Promise<void>;
}

export const useHeroCategoryStore = create<HeroCategoryStore>((set, get) => ({
  heroByCategoryId: new Map(),
  // Loads once per session: a fresh map re-renders every Installed card.
  load: async () => {
    if (get().heroByCategoryId.size > 0) return;
    try {
      const heroByCategoryId = buildHeroByCategoryId(await getGamebananaCategories('ModCategory'));
      if (heroByCategoryId.size > 0) set({ heroByCategoryId });
    } catch {
      // Offline with no cached tree: heroes still resolve from category names.
    }
  },
}));
