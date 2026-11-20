import { create } from 'zustand';
import type { Mod } from '../types/mod';
import { modPreferenceKey } from '../lib/disabledModPrefs';
import { createList, deleteList, readStoredModLists, renameList, toggleListMembership, writeStoredModLists, type ModList } from '../lib/modLists';
import { createStableKeyMigrationPlan, migrateMemberships } from '../lib/stableKeyMigration';

export type InstalledCustomTag = ModList;
type TagMod = Pick<Mod, 'id' | 'gameBananaId' | 'sha256' | 'localGroupId' | 'sourceSection'>;
export const EMPTY_CUSTOM_TAGS: readonly InstalledCustomTag[] = [];
export const EMPTY_TAG_ORDER: readonly string[] = [];
const storageKey = (scope: string) => `installedCustomTags:${scope}`;
const orderStorageKey = (scope: string) => `installedTagOrder:${scope}`;

function readTagOrder(scope: string): readonly string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(orderStorageKey(scope)) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === 'string' && key.length > 0))] : EMPTY_TAG_ORDER;
  } catch { return EMPTY_TAG_ORDER; }
}

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
  orderByScope: Readonly<Record<string, readonly string[]>>;
  load: (scope: string) => void;
  setOrder: (scope: string, keys: readonly string[]) => void;
  reorder: (scope: string, keys: readonly string[]) => void;
  create: (scope: string, name: string) => boolean;
  rename: (scope: string, id: string, name: string) => boolean;
  remove: (scope: string, id: string) => void;
  toggle: (scope: string, id: string, mod: TagMod) => void;
  clearForMods: (scope: string, mods: readonly TagMod[]) => void;
  setForMods: (scope: string, id: string, mods: readonly TagMod[], assigned: boolean) => void;
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
    orderByScope: {},
    load: scope => {
      if (get().byScope[scope] && get().orderByScope[scope]) return;
      const tags = get().byScope[scope] ?? readStoredModLists(storageKey(scope));
      const order = get().orderByScope[scope] ?? readTagOrder(scope);
      set(state => ({ byScope: { ...state.byScope, [scope]: tags }, orderByScope: { ...state.orderByScope, [scope]: order } }));
    },
    setOrder: (scope, keys) => {
      const next = [...new Set(keys)];
      try { localStorage.setItem(orderStorageKey(scope), JSON.stringify(next)); } catch { /* Keep the preference usable in memory. */ }
      set(state => ({ orderByScope: { ...state.orderByScope, [scope]: next } }));
    },
    reorder: (scope, keys) => {
      const next = [...new Set(keys)];
      const visible = new Set(next);
      let index = 0;
      const previous = get().orderByScope[scope] ?? readTagOrder(scope);
      const order = previous.map(key => visible.has(key) ? next[index++] : key);
      get().setOrder(scope, [...order, ...next.slice(index)]);
    },
    create: (scope, name) => {
      const tags = read(scope);
      const result = createList(tags, name);
      if (!result.id || tags.some(tag => tag.id === result.id)) return false;
      save(scope, result.lists);
      get().setOrder(scope, [`custom:${result.id}`, ...(get().orderByScope[scope] ?? readTagOrder(scope))]);
      return true;
    },
    rename: (scope, id, name) => {
      const result = renameList(read(scope), id, name);
      if (result.applied) save(scope, result.lists);
      return result.applied;
    },
    remove: (scope, id) => {
      save(scope, deleteList(read(scope), id));
      const order = get().orderByScope[scope] ?? readTagOrder(scope);
      if (order.includes(`custom:${id}`)) get().setOrder(scope, order.filter(key => key !== `custom:${id}`));
    },
    toggle: (scope, id, mod) => save(scope, toggleListMembership(read(scope), id, customTagMemberKey(mod))),
    setForMods: (scope, id, mods, assigned) => {
      const keys = new Set(mods.map(customTagMemberKey));
      save(scope, read(scope).map(tag => tag.id === id ? { ...tag, keys: assigned
        ? [...new Set([...tag.keys, ...keys])] : tag.keys.filter(key => !keys.has(key)) } : tag));
    },
    clearForMods: (scope, mods) => {
      const keys = new Set(mods.map(customTagMemberKey));
      save(scope, read(scope).map(tag => ({ ...tag, keys: tag.keys.filter(key => !keys.has(key)) })));
    },
    regroup: (scope, before, after) => {
      const tags = read(scope);
      if (!tags.length) return;
      const next = migrateMemberships(tags, createStableKeyMigrationPlan({ before, after, keyOf: customTagMemberKey }));
      if (JSON.stringify(next) !== JSON.stringify(tags)) save(scope, next);
    },
  };
});
