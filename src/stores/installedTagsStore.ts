import { create } from 'zustand';
import type { Mod } from '../types/mod';
import { modPreferenceKey } from '../lib/disabledModPrefs';
import { createList, deleteList, readStoredModLists, renameList, toggleListMembership, writeStoredModLists, type ModList } from '../lib/modLists';
import { createStableKeyMigrationPlan, migrateMemberships } from '../lib/stableKeyMigration';

export type InstalledCustomTag = ModList;
type TagMod = Pick<Mod, 'id' | 'gameBananaId' | 'sha256' | 'localGroupId' | 'sourceSection'>;
export const EMPTY_CUSTOM_TAGS: readonly InstalledCustomTag[] = [];
const storageKey = (scope: string) => `installedCustomTags:${scope}`;

export function customTagMemberKey(mod: TagMod): string {
  const key = modPreferenceKey(mod);
  return key.startsWith('gamebanana:') ? `${mod.sourceSection ?? 'Mod'}:${key}` : key;
}

export function customTagsForMods(tags: readonly InstalledCustomTag[], mods: readonly TagMod[]): InstalledCustomTag[] {
  const keys = new Set(mods.map(customTagMemberKey));
  return tags.filter(tag => tag.keys.some(key => keys.has(key)));
}

interface InstalledTagsState {
  byScope: Readonly<Record<string, readonly InstalledCustomTag[]>>;
  load: (scope: string) => void;
  create: (scope: string, name: string) => boolean;
  rename: (scope: string, id: string, name: string) => boolean;
  remove: (scope: string, id: string) => void;
  toggle: (scope: string, id: string, mod: TagMod) => void;
  regroup: (scope: string, before: readonly Mod[], after: readonly Mod[]) => void;
}

/** Reuse the existing list catalogue operations for tags, with independent storage. */
export const useInstalledTagsStore = create<InstalledTagsState>((set, get) => {
  const read = (scope: string) => get().byScope[scope] ?? readStoredModLists(storageKey(scope));
  const save = (scope: string, tags: readonly InstalledCustomTag[]) => {
    writeStoredModLists(tags, storageKey(scope));
    set(state => ({ byScope: { ...state.byScope, [scope]: tags } }));
  };
  return {
    byScope: {},
    load: scope => {
      if (!get().byScope[scope]) set(state => ({ byScope: { ...state.byScope, [scope]: readStoredModLists(storageKey(scope)) } }));
    },
    create: (scope, name) => {
      const tags = read(scope);
      const result = createList(tags, name);
      if (!result.id || tags.some(tag => tag.id === result.id)) return false;
      save(scope, result.lists);
      return true;
    },
    rename: (scope, id, name) => {
      const result = renameList(read(scope), id, name);
      if (result.applied) save(scope, result.lists);
      return result.applied;
    },
    remove: (scope, id) => save(scope, deleteList(read(scope), id)),
    toggle: (scope, id, mod) => save(scope, toggleListMembership(read(scope), id, customTagMemberKey(mod))),
    regroup: (scope, before, after) => {
      const tags = read(scope);
      if (!tags.length) return;
      const next = migrateMemberships(tags, createStableKeyMigrationPlan({ before, after, keyOf: customTagMemberKey }));
      if (JSON.stringify(next) !== JSON.stringify(tags)) save(scope, next);
    },
  };
});
