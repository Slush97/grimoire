import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import { selectEntryRange } from '../components/installed/selection';
import { buildModEntries } from './modEntries';
import {
  buildInstalledListGroups,
  listSelectionEntries,
  INSTALLED_LIST_PREFS_KEY,
  readInstalledListPreferences,
  writeInstalledListPreferences,
} from './installedListGroups';

function mod(id: string, overrides: Partial<Mod> = {}): Mod {
  return {
    id, name: id, fileName: `${id}.vpk`, path: `${id}.vpk`, metaKey: `${id}.vpk`,
    enabled: true, priority: 1, size: 100, installedAt: '2026-10-20', sha256: id,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('installed lists', () => {
  it('supports overlapping lists without inventing an unfiled list or changing entry order', () => {
    const entries = buildModEntries([mod('b'), mod('a'), mod('c')]);
    const folders = buildInstalledListGroups(entries, [
      { id: 'skins', name: 'Skins', keys: ['sha256:a', 'sha256:b'] },
      { id: 'wip', name: 'WIP', keys: ['sha256:a'] },
      { id: 'missing', name: 'Missing', keys: ['sha256:removed'] },
    ]);
    expect(folders.map((folder) => [folder.id, folder.entries.map((entry) => entry.key)]))
      .toEqual([
        ['skins', [entries[0].key, entries[1].key]],
        ['wip', [entries[1].key]],
        ['missing', []],
      ]);
    expect(entries.map((entry) => entry.kind === 'single' && entry.mod.id)).toEqual(['b', 'a', 'c']);
  });

  it('shows enabled and disabled entries once per list, with variants kept together', () => {
    const entries = buildModEntries([
      mod('default', { localGroupId: 'skin', priority: 2 }),
      mod('alternative', { localGroupId: 'skin', enabled: false }),
      mod('disabled', { enabled: false }),
    ]);
    const lists = [{ id: 'skins', name: 'Skins', keys: ['localgroup:skin', 'sha256:disabled'] }];
    const groups = buildInstalledListGroups(entries, lists);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
    expect(listSelectionEntries(groups, new Set()).flatMap((entry) => entry.ids))
      .toEqual(['disabled', 'alternative', 'default']);
  });

  it('uses the clicked occurrence as the range anchor and excludes collapsed folders', () => {
    const entries = buildModEntries([mod('a'), mod('b'), mod('c')]);
    const folders = buildInstalledListGroups(entries, [
      { id: 'first', name: 'First', keys: ['sha256:a', 'sha256:b'] },
      { id: 'second', name: 'Second', keys: ['sha256:a', 'sha256:c'] },
    ]);
    const selection = listSelectionEntries(folders, new Set());
    expect(new Set(selection.map((entry) => entry.key)).size).toBe(4);
    expect(selectEntryRange(new Set(['a']), selection, selection[2].key, selection[3], true))
      .toEqual(new Set(['a', 'c']));
    const collapsed = new Set(['first']);
    expect(listSelectionEntries(folders, collapsed).flatMap((entry) => entry.ids))
      .toEqual(['a', 'c']);
    expect(new Set(selection.flatMap((entry) => entry.ids))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('list preferences', () => {
  it('round-trips the view and collapsed list IDs', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    expect(readInstalledListPreferences()).toEqual({ view: 'all', collapsed: [] });
    const preferences = { view: 'lists', collapsed: ['skins'] } as const;
    writeInstalledListPreferences({ ...preferences, collapsed: [...preferences.collapsed] });
    expect(readInstalledListPreferences()).toEqual(preferences);
    storage.set(INSTALLED_LIST_PREFS_KEY, JSON.stringify({ view: 'bad', collapsed: [1, 'valid'] }));
    expect(readInstalledListPreferences()).toEqual({ view: 'all', collapsed: ['valid'] });
  });

  it('tolerates malformed and unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{bad' });
    expect(readInstalledListPreferences()).toEqual({ view: 'all', collapsed: [] });
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Unavailable'); },
      setItem: () => { throw new Error('Unavailable'); },
    });
    expect(readInstalledListPreferences()).toEqual({ view: 'all', collapsed: [] });
    expect(() => writeInstalledListPreferences({ view: 'lists', collapsed: [] })).not.toThrow();
  });
});
