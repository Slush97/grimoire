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
}
export const INSTALLED_LIST_PREFS_KEY = 'installedListView';

export function readInstalledListPreferences(): InstalledListPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INSTALLED_LIST_PREFS_KEY) ?? 'null');
    if (value && typeof value === 'object' && 'view' in value && 'collapsed' in value) {
      return {
        view: value.view === 'lists' ? 'lists' : 'all',
        collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((id): id is string => typeof id === 'string') : [],
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

export function buildInstalledListGroups(entries: readonly ModEntry[], lists: readonly ModList[]): InstalledListGroup[] {
  const groups: InstalledListGroup[] = lists.map((list) => {
    const keys = new Set(list.keys);
    return { id: list.id, name: list.name, ...(list.icon ? { icon: list.icon } : {}), entries: entries.filter((entry) => keys.has(entryDisabledPreferenceKey(entry))) };
  });
  const listed = new Set(lists.flatMap((list) => list.keys));
  const unlisted = entries.filter((entry) => !listed.has(entryDisabledPreferenceKey(entry)));
  return unlisted.length > 0 ? [...groups, { id: UNLISTED_GROUP_ID, name: '', entries: unlisted }] : groups;
}

export function visibleListOccurrences(groups: readonly InstalledListGroup[], collapsed: ReadonlySet<string>): { key: string; entry: ModEntry }[] {
  return groups.flatMap((list) => collapsed.has(list.id) ? [] :
    list.entries.map((entry) => ({ key: installedListEntryKey(list.id, entry), entry })));
}

export function listSelectionEntries(groups: readonly InstalledListGroup[], collapsed: ReadonlySet<string>): SelectionEntry[] {
  return visibleListOccurrences(groups, collapsed).map(({ key, entry }) => ({ key, ids: entrySelectionIds(entry) }));
}
