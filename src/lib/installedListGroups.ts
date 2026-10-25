import { entryDisabledPreferenceKey, type ModEntry } from './modEntries';
import type { ModList } from './modLists';
import { entrySelectionIds, type SelectionEntry } from '../components/installed/selection';

export type InstalledListView = 'all' | 'lists';
export interface InstalledListGroup extends Pick<ModList, 'id' | 'name' | 'icon'> {
  entries: ModEntry[];
}
export interface InstalledListPreferences {
  view: InstalledListView;
  collapsed: string[];
  unlistedOrder?: string[];
}
export const INSTALLED_LIST_PREFS_KEY = 'installedListView';

export function readInstalledListPreferences(): InstalledListPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INSTALLED_LIST_PREFS_KEY) ?? 'null');
    if (value && typeof value === 'object' && 'view' in value && 'collapsed' in value) {
      return {
        view: value.view === 'lists' ? 'lists' : 'all',
        collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((id): id is string => typeof id === 'string') : [],
        ...('unlistedOrder' in value && Array.isArray(value.unlistedOrder) ? { unlistedOrder: [...new Set(value.unlistedOrder.filter((key): key is string => typeof key === 'string' && !!key))] } : {}),
      };
    }
  } catch { /* Use the default view when storage is unavailable. */ }
  return { view: 'all', collapsed: [] };
}

export function writeInstalledListPreferences(preferences: InstalledListPreferences): void {
  try {
    localStorage.setItem(INSTALLED_LIST_PREFS_KEY, JSON.stringify(preferences));
  } catch { /* Keep this session usable when storage is unavailable. */ }
}

export function installedListEntryKey(listId: string, entry: ModEntry): string {
  return JSON.stringify([listId, entry.key]);
}

/** Trailing group for entries in no list, named by the UI. Generated list ids
 *  are slugs, so the colon keeps it clear of them. */
export const UNLISTED_GROUP_ID = ':unlisted';

export function buildInstalledListGroups(entries: readonly ModEntry[], lists: readonly ModList[], unlistedOrder: readonly string[] = []): InstalledListGroup[] {
  const byKey = new Map<string, ModEntry[]>();
  for (const entry of entries) {
    const key = entryDisabledPreferenceKey(entry);
    const matches = byKey.get(key);
    if (matches) matches.push(entry);
    else byKey.set(key, [entry]);
  }
  const groups: InstalledListGroup[] = lists.map((list) => {
    return { id: list.id, name: list.name, ...(list.icon ? { icon: list.icon } : {}), entries: list.keys.flatMap(key => byKey.get(key) ?? []) };
  });
  const listed = new Set(lists.flatMap((list) => list.keys));
  const orderedUnlisted = new Set(unlistedOrder);
  const unlisted = [
    ...unlistedOrder.filter(key => !listed.has(key)).flatMap(key => byKey.get(key) ?? []),
    ...entries.filter(entry => { const key = entryDisabledPreferenceKey(entry); return !listed.has(key) && !orderedUnlisted.has(key); }),
  ];
  return unlisted.length > 0 ? [...groups, { id: UNLISTED_GROUP_ID, name: '', entries: unlisted }] : groups;
}

export function visibleListOccurrences(groups: readonly InstalledListGroup[], collapsed: ReadonlySet<string>): { key: string; entry: ModEntry }[] {
  return groups.flatMap((list) => collapsed.has(list.id) ? [] :
    list.entries.map((entry) => ({ key: installedListEntryKey(list.id, entry), entry })));
}

export function listSelectionEntries(groups: readonly InstalledListGroup[], collapsed: ReadonlySet<string>): SelectionEntry[] {
  return visibleListOccurrences(groups, collapsed).map(({ key, entry }) => ({ key, ids: entrySelectionIds(entry) }));
}
