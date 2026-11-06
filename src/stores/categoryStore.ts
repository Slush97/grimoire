import { create } from 'zustand';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import { getGamebananaCategories } from '../lib/api';
import { buildCategoryPaths, type CategoryPaths } from '../lib/categoryPaths';
import { buildHeroByCategoryId, buildHeroList } from '../lib/lockerUtils';

interface CategoryStore {
  treesByModel: Readonly<Record<string, GameBananaCategoryNode[] | undefined>>;
  pathsByModel: Readonly<Record<string, CategoryPaths | undefined>>;
  heroByCategoryId: ReadonlyMap<number, string>;
  heroNames: readonly string[];
  load: (categoryModel?: string, options?: { afterCurrent?: boolean }) => Promise<GameBananaCategoryNode[]>;
}

export const useCategoryStore = create<CategoryStore>((set, get) => {
  const pendingByModel = new Map<string, Promise<GameBananaCategoryNode[]>>();
  return {
    treesByModel: {},
    pathsByModel: {},
    heroByCategoryId: new Map(),
    heroNames: [],
    // Route and details mounts reread main's existing cache, so a completed
    // background refresh becomes visible. Keep unchanged indexes stable to
    // avoid rerendering every subscribed card. Main owns network freshness.
    load: (categoryModel = 'ModCategory', options) => {
      const pending = pendingByModel.get(categoryModel);
      if (pending && options?.afterCurrent) {
        // A main-process change may arrive while an older IPC read is pending.
        // Its settlement must be followed by a fresh, normally coalesced read.
        const reload = () => get().load(categoryModel);
        return pending.then(reload, reload);
      }
      if (pending) return pending;

      const request = getGamebananaCategories(categoryModel).then((tree) => {
        const cached = get().treesByModel[categoryModel];
        if (cached && JSON.stringify(cached) === JSON.stringify(tree)) return cached;
        set((state) => ({
          treesByModel: { ...state.treesByModel, [categoryModel]: tree },
          pathsByModel: { ...state.pathsByModel, [categoryModel]: buildCategoryPaths(tree) },
          ...(categoryModel === 'ModCategory' ? {
            heroByCategoryId: buildHeroByCategoryId(tree),
            heroNames: [...new Set(buildHeroList(tree).map((hero) => hero.name))].sort((a, b) => a.localeCompare(b)),
          } : {}),
        }));
        return tree;
      }).catch((error: unknown) => {
        const cached = get().treesByModel[categoryModel];
        if (cached) return cached;
        throw error;
      }).finally(() => {
        pendingByModel.delete(categoryModel);
      });
      pendingByModel.set(categoryModel, request);
      return request;
    },
  };
});
