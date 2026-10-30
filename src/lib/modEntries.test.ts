import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { buildModEntries, entryHeroNames, entrySize } from './modEntries';

const single = (over: Partial<Mod>) => ({
  kind: 'single' as const,
  key: 'a',
  mod: { id: 'a', name: 'Viscous Redesign', fileName: 'a.vpk', sourceSection: 'Mod', ...over } as Mod,
});

describe('entryHeroNames', () => {
  it('finds the hero of a skin filed in a hero subcategory', () => {
    const entry = single({ categoryId: 50570, categoryName: 'Faithful/Vanilla+' });
    expect(entryHeroNames(entry)).toEqual([]);
    expect(entryHeroNames(entry, new Map([[50570, 'Viscous']]))).toEqual(['Viscous']);
  });

  it('keeps a manual hero tag ahead of the category tree', () => {
    const entry = single({ categoryId: 50570, categoryName: 'Faithful/Vanilla+', lockerHero: 'Haze' });
    expect(entryHeroNames(entry, new Map([[50570, 'Viscous']]))).toEqual(['Haze']);
  });
});

describe('entrySize', () => {
  const mod = (id: string, size: number, gameBananaId?: number) =>
    ({ id, name: id, fileName: `${id}.vpk`, size, priority: 0, enabled: false, installedAt: '', gameBananaId }) as Mod;

  it('counts every variant of a group, not just the one on the card', () => {
    const entries = buildModEntries([mod('a', 100, 7), mod('b', 250, 7), mod('c', 300)]);
    const sizes = new Map(entries.map((entry) => [entry.kind === 'single' ? entry.mod.id : 'group', entrySize(entry)]));
    expect(sizes).toEqual(new Map([['c', 300], ['group', 350]]));
  });
});
