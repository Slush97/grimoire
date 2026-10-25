import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { entryHeroNames, entryTags, type ModEntry } from './modEntries';
import type { InstalledTaxonomyContext } from './installedCardTaxonomy';

const single = (over: Partial<Mod>) => ({
  kind: 'single' as const,
  key: 'a',
  mod: { id: 'a', name: 'Viscous Redesign', fileName: 'a.vpk', sourceSection: 'Mod', ...over } as Mod,
});

describe('entryHeroNames', () => {
  it('finds the hero of a skin filed in a hero subcategory', () => {
    const entry = single({ categoryId: 50570, categoryName: 'Faithful/Vanilla+' });
    expect(entryHeroNames(entry)).toEqual([]);
    expect(entryHeroNames(entry, { heroByCategoryId: new Map([[50570, 'Viscous']]) })).toEqual(['Viscous']);
  });

  it('keeps a manual hero tag ahead of the category tree', () => {
    const entry = single({ categoryId: 50570, categoryName: 'Faithful/Vanilla+', lockerHero: 'Haze' });
    expect(entryHeroNames(entry, { heroByCategoryId: new Map([[50570, 'Viscous']]) })).toEqual(['Haze']);
  });

  it('recognizes new hero categories without adding duplicate text facets', () => {
    const entry = single({ categoryName: 'Solomon', categoryId: 2 });
    const context: InstalledTaxonomyContext = { heroNames: ['Solomon'], heroByCategoryId: new Map([[2, 'Solomon']]) };
    expect(entryHeroNames(entry, context)).toEqual(['Solomon']);
    expect(entryTags(entry, context)).toEqual([]);
  });
});

describe('entryTags', () => {
  it.each([
    ['hud', ' hUd ', 'HUD'],
    ['hideout', ' Hideout ', 'Hideout'],
    ['soul-container', ' Soul Container ', 'Soul Containers'],
    ['spirit-urn', ' Spirit Urn ', 'Spirit Urns'],
  ] as const)('merges %s classifications and equivalent category labels', (globalType, categoryName, label) => {
    const classified = single({ globalType, categoryName });
    const categorized = single({ categoryName });
    expect(entryTags(classified)).toEqual(entryTags(categorized));
    expect(entryTags(classified)).toEqual([{ key: `tag:${label.toLowerCase()}`, label }]);
  });

  it('normalizes whitespace and case in identities without losing the visible label', () => {
    const first = entryTags(single({ categoryName: ' Custom   Visuals ' }))[0];
    const second = entryTags(single({ categoryName: 'custom visuals' }))[0];
    expect(first).toEqual({ key: 'tag:custom visuals', label: 'Custom Visuals' });
    expect(first.key).toBe(second.key);
  });

  it('unions grouped variants so one entry contributes only once to each facet count', () => {
    const variants = [single({ globalType: 'hideout' }).mod, single({ categoryName: 'HIDEOUT' }).mod];
    const grouped: ModEntry = {
      kind: 'group', key: 'group:test', groupKey: 'local:test', variants,
      primary: variants[0], active: null, enabledVariants: [], totalSize: 1,
    };
    const counts = new Map<string, number>();
    for (const entry of [grouped, single({ categoryName: 'Hideout' })]) {
      for (const tag of entryTags(entry)) counts.set(tag.key, (counts.get(tag.key) ?? 0) + 1);
    }
    expect([...counts]).toEqual([['tag:hideout', 2]]);
    expect(entryTags(grouped)).toEqual([{ key: 'tag:hideout', label: 'Hideout' }]);
  });

  it('keeps useful section tags and distinct category classifications', () => {
    expect(entryTags(single({ sourceSection: 'Sound', globalType: 'announcer', categoryName: 'Other/Misc' }))).toEqual([
      { key: 'tag:announcer / sfx', label: 'Announcer / SFX' }, { key: 'tag:other/misc', label: 'Other/Misc' },
      { key: 'tag:sounds', label: 'Sounds' },
    ]);
    expect(entryTags(single({ sourceSection: 'Wip', categoryName: 'HUD' }))).toEqual([
      { key: 'tag:hud', label: 'HUD' }, { key: 'tag:wip', label: 'Wip' },
    ]);
    expect(entryTags(single({ categoryName: undefined }))).toEqual([]);
  });

  it('adds no fallback tags for unclassified files or mixed variant groups', () => {
    const variants = [
      single({ globalType: 'soul-container', categoryName: 'Soul Container' }).mod,
      single({ lockerHero: 'Viscous', categoryName: 'Viscous' }).mod,
      single({ sourceSection: undefined, categoryName: undefined }).mod,
    ];
    const grouped: ModEntry = {
      kind: 'group', key: 'group:test', groupKey: 'local:test', variants,
      primary: variants[0], active: null, enabledVariants: [], totalSize: 1,
    };
    expect(entryTags(grouped)).toEqual([{ key: 'tag:soul containers', label: 'Soul Containers' }]);
    expect(entryTags(single({ sourceSection: undefined, categoryName: undefined }))).toEqual([]);
  });

  it('keeps a meaningful HUD category while deduplicating derived global sound categories', () => {
    expect(entryTags(single({ globalType: 'hud', categoryName: 'Quality of Life/Fixes' }))).toEqual([
      { key: 'tag:hud', label: 'HUD' }, { key: 'tag:quality of life/fixes', label: 'Quality of Life/Fixes' },
    ]);
    expect(entryTags(single({ sourceSection: 'Sound', categoryName: 'Announcer' }))).toEqual([
      { key: 'tag:announcer / sfx', label: 'Announcer / SFX' }, { key: 'tag:sounds', label: 'Sounds' },
    ]);
  });
});
