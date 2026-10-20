import type { ModEntry } from './modEntries';
import { entryDisabledPreferenceKey } from './modEntries';
import type { ModList } from './modLists';
import { entrySelectionIds, type SelectionEntry } from '../components/installed/selection';

export type InstalledFolderView = 'flat' | 'folders';
export type InstalledFolderSection = 'enabled' | 'disabled';
export interface InstalledFolder {
  id: string | null;
  name: string;
  entries: ModEntry[];
}

export const INSTALLED_FOLDER_PREFS_KEY = 'installedFolderView';

export interface InstalledFolderPreferences {
  view: InstalledFolderView;
  collapsed: string[];
}

export function readInstalledFolderPreferences(): InstalledFolderPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INSTALLED_FOLDER_PREFS_KEY) ?? 'null');
    if (value && typeof value === 'object' && 'view' in value && 'collapsed' in value) {
      return {
        view: value.view === 'folders' ? 'folders' : 'flat',
        collapsed: Array.isArray(value.collapsed)
          ? value.collapsed.filter((key): key is string => typeof key === 'string') : [],
      };
    }
  } catch { /* Unavailable storage leaves the default view usable. */ }
  return { view: 'flat', collapsed: [] };
}

export function writeInstalledFolderPreferences(preferences: InstalledFolderPreferences): void {
  try {
    localStorage.setItem(INSTALLED_FOLDER_PREFS_KEY, JSON.stringify(preferences));
  } catch { /* The view remains usable for this session. */ }
}

export function installedFolderKey(section: InstalledFolderSection, id: string | null): string {
  return JSON.stringify([section, id]);
}

export function installedFolderEntryKey(section: InstalledFolderSection, folder: InstalledFolder, entry: ModEntry): string {
  return JSON.stringify([section, folder.id, entry.key]);
}

export function buildInstalledFolders(entries: readonly ModEntry[], lists: readonly ModList[]): InstalledFolder[] {
  const filed = new Set(lists.flatMap((list) => list.keys));
  const folders = lists.map((list) => {
    const keys = new Set(list.keys);
    return { id: list.id, name: list.name, entries: entries.filter((entry) => keys.has(entryDisabledPreferenceKey(entry))) };
  });
  const unfiled = entries.filter((entry) => !filed.has(entryDisabledPreferenceKey(entry)));
  return [...folders, ...(unfiled.length ? [{ id: null, name: '', entries: unfiled }] : [])];
}

export function folderSelectionEntries(
  folders: readonly InstalledFolder[],
  section: InstalledFolderSection,
  collapsed: ReadonlySet<string>,
): SelectionEntry[] {
  return visibleFolderOccurrences(folders, section, collapsed)
    .map(({ key, entry }) => ({ key, ids: entrySelectionIds(entry) }));
}

export function visibleFolderOccurrences(
  folders: readonly InstalledFolder[],
  section: InstalledFolderSection,
  collapsed: ReadonlySet<string>,
): { key: string; entry: ModEntry }[] {
  return folders.flatMap((folder) => collapsed.has(installedFolderKey(section, folder.id)) ? [] :
    folder.entries.map((entry) => ({ key: installedFolderEntryKey(section, folder, entry), entry })));
}
