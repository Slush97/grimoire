import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { type ModEntry } from './modEntries';
import { sortInstalledEntries } from './installedSort';

const installedAt = '2026-10-01T00:00:00.000Z';
const mod = (id: string, patch: Partial<Mod> = {}): Mod => ({
  id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: `/game/${id}.vpk`,
  enabled: true, priority: 1, size: 10, installedAt, ...patch,
});
const single = (id: string, patch: Partial<Mod> = {}): ModEntry => ({ kind: 'single', key: id, mod: mod(id, patch) });
const group = (id: string, variants: Mod[]): ModEntry => ({
  kind: 'group', key: id, groupKey: `local:${id}`, primary: variants[0], variants,
  active: variants[0], enabledVariants: variants, totalSize: variants.reduce((sum, file) => sum + file.size, 0),
});
const keys = (entries: ModEntry[]) => entries.map(entry => entry.key);

describe('Installed display sorting', () => {
  it('preserves the supplied load order without mutating its input', () => {
    const entries = [single('second', { priority: 2 }), single('first', { priority: 1 })];
    const result = sortInstalledEntries(entries, 'priority', () => []);
    expect(keys(result)).toEqual(['second', 'first']);
    expect(result).not.toBe(entries);
    expect(result[0]).toBe(entries[0]);
  });

  it('sorts names without making capitalization determine the order', () => {
    const entries = [single('zebra'), single('Banana'), single('apple')];
    expect(keys(sortInstalledEntries(entries, 'name', () => []))).toEqual(['apple', 'Banana', 'zebra']);
    expect(keys(entries)).toEqual(['zebra', 'Banana', 'apple']);
  });

  it('uses the alphabetically first resolved hero and puts files without heroes last', () => {
    const entries = [single('unassigned', { priority: 1 }), single('multiple'), single('apollo'), single('abrams')];
    const heroes: Record<string, string[]> = {
      unassigned: [], multiple: ['Wraith', 'Bebop', 'Haze'], apollo: ['Apollo'], abrams: ['Abrams'],
    };
    expect(keys(sortInstalledEntries(entries, 'hero', entry => heroes[entry.key])))
      .toEqual(['abrams', 'apollo', 'multiple', 'unassigned']);
    expect(heroes.multiple).toEqual(['Wraith', 'Bebop', 'Haze']);
  });

  it('uses actual load order for matching heroes and unassigned entries, including Global and overflow roots', () => {
    const entries = [
      single('ordinary', { priority: 3 }), single('overflow', { priority: 1, metaKey: 'addons1/overflow.vpk' }),
      single('global', { priority: 5, metaKey: 'grimoire/global.vpk' }), single('early', { priority: 1 }),
    ];
    const expected = ['global', 'early', 'ordinary', 'overflow'];
    expect(keys(sortInstalledEntries(entries, 'hero', () => ['Haze']))).toEqual(expected);
    expect(keys(sortInstalledEntries(entries, 'hero', () => []))).toEqual(expected);
  });

  it('breaks matching Recently Added timestamps by load order', () => {
    const entries = [
      single('older', { installedAt: '2026-10-10T00:00:00.000Z' }),
      single('same-time-later-slot', { priority: 8, installedAt: '2026-10-20T00:00:00.000Z' }),
      single('same-time-first-slot', { priority: 2, installedAt: '2026-10-20T00:00:00.000Z' }),
    ];
    const expected = ['same-time-first-slot', 'same-time-later-slot', 'older'];
    expect(keys(sortInstalledEntries(entries, 'recent', () => []))).toEqual(expected);
  });

  it('sorts Recently Added by the newest install in a group', () => {
    const entries = [
      single('standalone'),
      group('variants', [mod('primary'), mod('newer-file', { installedAt: '2026-10-26T00:00:00.000Z' })]),
    ];
    expect(keys(sortInstalledEntries(entries, 'recent', () => []))).toEqual(['variants', 'standalone']);
  });
});
