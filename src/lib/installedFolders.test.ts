import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import { selectEntryRange } from '../components/installed/selection';
import { buildModEntries, isEntryEnabled } from './modEntries';
import {
  buildInstalledFolders,
  folderSelectionEntries,
  installedFolderKey,
  INSTALLED_FOLDER_PREFS_KEY,
  readInstalledFolderPreferences,
  writeInstalledFolderPreferences,
} from './installedFolders';

function mod(id: string, overrides: Partial<Mod> = {}): Mod {
  return {
    id, name: id, fileName: `${id}.vpk`, path: `${id}.vpk`, metaKey: `${id}.vpk`,
    enabled: true, priority: 1, size: 100, installedAt: '2026-10-20', sha256: id,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('installed folders', () => {
  it('supports overlapping membership, empty folders and unfiled mods without changing entry order', () => {
    const entries = buildModEntries([mod('b'), mod('a'), mod('c')]);
    const folders = buildInstalledFolders(entries, [
      { id: 'skins', name: 'Skins', keys: ['sha256:a', 'sha256:b'] },
      { id: 'wip', name: 'WIP', keys: ['sha256:a'] },
      { id: 'missing', name: 'Missing', keys: ['sha256:removed'] },
    ]);
    expect(folders.map((folder) => [folder.id, folder.entries.map((entry) => entry.key)]))
      .toEqual([
        ['skins', [entries[0].key, entries[1].key]],
        ['wip', [entries[1].key]],
        ['missing', []],
        [null, [entries[2].key]],
      ]);
    expect(entries.map((entry) => entry.kind === 'single' && entry.mod.id)).toEqual(['b', 'a', 'c']);
  });

  it('keeps enabled and disabled variants together under a stable folder membership', () => {
    const entries = buildModEntries([
      mod('default', { localGroupId: 'skin', priority: 2 }),
      mod('alternative', { localGroupId: 'skin', enabled: false }),
    ]);
    const lists = [{ id: 'skins', name: 'Skins', keys: ['localgroup:skin'] }];
    const enabled = buildInstalledFolders(entries.filter(isEntryEnabled), lists);
    const disabled = buildInstalledFolders(entries.filter((entry) => !isEntryEnabled(entry)), lists);
    expect(enabled[0].entries).toHaveLength(1);
    expect(disabled[0].entries).toHaveLength(0);
    expect(folderSelectionEntries(enabled, 'enabled', new Set())[0].ids)
      .toEqual(['alternative', 'default']);
  });

  it('uses the clicked occurrence as the range anchor and excludes collapsed folders', () => {
    const entries = buildModEntries([mod('a'), mod('b'), mod('c')]);
    const folders = buildInstalledFolders(entries, [
      { id: 'first', name: 'First', keys: ['sha256:a', 'sha256:b'] },
      { id: 'second', name: 'Second', keys: ['sha256:a', 'sha256:c'] },
    ]);
    const selection = folderSelectionEntries(folders, 'enabled', new Set());
    expect(new Set(selection.map((entry) => entry.key)).size).toBe(4);
    expect(selectEntryRange(new Set(['a']), selection, selection[2].key, selection[3], true))
      .toEqual(new Set(['a', 'c']));
    const collapsed = new Set([installedFolderKey('enabled', 'first')]);
    expect(folderSelectionEntries(folders, 'enabled', collapsed).flatMap((entry) => entry.ids))
      .toEqual(['a', 'c']);
    expect(new Set(selection.flatMap((entry) => entry.ids))).toEqual(new Set(['a', 'b', 'c']));
    expect(folderSelectionEntries(folders, 'disabled', collapsed)).toHaveLength(4);
  });
});

describe('folder preferences', () => {
  it('round-trips the view and independently collapsed enabled and disabled folders', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    expect(readInstalledFolderPreferences()).toEqual({ view: 'flat', collapsed: [] });
    const preferences = { view: 'folders', collapsed: [installedFolderKey('enabled', 'skins')] } as const;
    writeInstalledFolderPreferences({ ...preferences, collapsed: [...preferences.collapsed] });
    expect(readInstalledFolderPreferences()).toEqual(preferences);
    storage.set(INSTALLED_FOLDER_PREFS_KEY, JSON.stringify({ view: 'bad', collapsed: [1, 'valid'] }));
    expect(readInstalledFolderPreferences()).toEqual({ view: 'flat', collapsed: ['valid'] });
  });

  it('tolerates malformed and unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{bad' });
    expect(readInstalledFolderPreferences()).toEqual({ view: 'flat', collapsed: [] });
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Unavailable'); },
      setItem: () => { throw new Error('Unavailable'); },
    });
    expect(readInstalledFolderPreferences()).toEqual({ view: 'flat', collapsed: [] });
    expect(() => writeInstalledFolderPreferences({ view: 'folders', collapsed: [] })).not.toThrow();
  });
});
