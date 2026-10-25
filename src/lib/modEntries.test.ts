import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { entryHeroNames } from './modEntries';

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
