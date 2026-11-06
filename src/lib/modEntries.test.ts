import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { buildEntrySwapTargets, buildModEntries, entryHeroNames, entryTags, entrySize, type ModEntry } from './modEntries';
import { buildCategoryPaths } from './categoryPaths';
import type { InstalledTaxonomyContext } from './installedCardTaxonomy';

const single = (over: Partial<Mod>) => ({
  kind: 'single' as const,
  key: 'a',
  mod: { id: 'a', name: 'Viscous Redesign', fileName: 'a.vpk', gameBananaId: 1, sourceSection: 'Mod', ...over } as Mod,
});

const context: InstalledTaxonomyContext = {
  heroNames: ['Solomon'], heroByCategoryId: new Map([[2, 'Solomon'], [3, 'Solomon']]),
  pathsByModel: { ModCategory: buildCategoryPaths([{
    id: 1, name: 'Skins', itemCount: 1, children: [{
      id: 2, name: 'Solomon', itemCount: 1, children: [{ id: 3, name: 'Faithful/Vanilla+', itemCount: 1 }],
    }],
  }]) },
};

const group = (variants: Mod[]): ModEntry => ({
  kind: 'group', key: 'group:test', groupKey: 'gb:1', variants,
  primary: variants[0], active: null, enabledVariants: [], totalSize: 1,
});

describe('hero swap targets', () => {
  const mod = (id: string, enabled: boolean, heroes: string[], extra: Partial<Mod> = {}): Mod => ({
    id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: '', size: 1,
    enabled, installedAt: '', priority: 1, sha256: id, lockerHeroes: heroes, ...extra,
  });
  const matches = (mods: Mod[], id: string) => {
    const entries = buildModEntries(mods);
    const entry = entries.find(entry => entry.kind === 'single' ? entry.mod.id === id : entry.variants.some(mod => mod.id === id))!;
    return buildEntrySwapTargets(entries).get(entry.key)?.map(target => target.name) ?? [];
  };

  it('offers enabled hero matches, excluding disabled and unrelated mods', () => {
    expect(matches([mod('new', false, ['Haze']), mod('old', true, ['Haze']),
      mod('unrelated', true, ['Abrams']), mod('disabled', false, ['Haze'])], 'new')).toEqual(['old']);
  });
  it('omits enabled cards and cards without a hero tag', () => {
    const mods = [mod('enabled', true, ['Haze']), mod('untagged', false, [])];
    expect(buildEntrySwapTargets(buildModEntries(mods)).size).toBe(0);
  });
  it('combines all heroes and includes each candidate only once', () => {
    expect(matches([mod('new', false, ['Haze', 'Abrams']), mod('both', true, ['Haze', 'Abrams']),
      mod('Abrams only', true, ['Abrams'])], 'new')).toEqual(['both', 'Abrams only']);
  });
  it('does not match a hero carried only by a disabled file in an enabled group', () => {
    expect(matches([mod('new', false, ['Haze']), mod('enabled variant', true, ['Abrams'], { localGroupId: 'old' }),
      mod('disabled variant', false, ['Haze'], { localGroupId: 'old' })], 'new')).toEqual([]);
  });
  it('carries the target heroes once, excluding its disabled variants', () => {
    const entries = buildModEntries([mod('new', false, ['Haze']),
      mod('enabled variant', true, ['Haze', 'Wraith'], { localGroupId: 'old' }),
      mod('second enabled variant', true, ['Wraith'], { localGroupId: 'old' }),
      mod('disabled variant', false, ['Abrams'], { localGroupId: 'old' })]);
    const replacement = entries.find(entry => entry.kind === 'single')!;
    expect(buildEntrySwapTargets(entries).get(replacement.key)).toEqual([
      { key: 'group:local:old', name: 'enabled variant', heroNames: ['Haze', 'Wraith'] },
    ]);
  });
  it('uses all hero tags of a disabled variant group and canonical aliases', () => {
    const entries = buildModEntries([mod('new Haze', false, ['Haze'], { localGroupId: 'new' }),
      mod('new Abrams', false, ['Abrams'], { localGroupId: 'new' }), mod('old', true, ['Abrams'])]);
    const replacement = entries.find(entry => entry.kind === 'group')!;
    expect(buildEntrySwapTargets(entries).get(replacement.key)?.map(target => target.name)).toEqual(['old']);
    expect(matches([mod('new', false, ['Rat King']), mod('old', true, ['RatKing'])], 'new')).toEqual(['old']);
  });
});

describe('entryHeroNames', () => {
  it('resolves nested hero categories', () => {
    expect(entryHeroNames(single({ categoryId: 3, categoryName: 'Faithful/Vanilla+' }), context)).toEqual(['Solomon']);
  });

  it('preserves manual hero overrides', () => {
    expect(entryHeroNames(single({ categoryId: 3, lockerHero: 'Haze', lockerHeroSource: 'manual' }), context)).toEqual(['Haze']);
  });

  it('combines all detected heroes once across variants', () => {
    expect(entryHeroNames(group([
      single({ sourceSection: 'Wip', lockerHeroes: ['Haze', 'Wraith'] }).mod,
      single({ sourceSection: 'Wip', lockerHeroes: ['Wraith'] }).mod,
    ]))).toEqual(['Haze', 'Wraith']);
  });
});

describe('entryTags', () => {
  it('includes non-hero ancestors and leaves without classification-derived tags', () => {
    expect(entryTags(single({ categoryId: 3, globalType: 'effects' }), context)).toEqual([
      { key: 'tag:skins', label: 'Skins' }, { key: 'tag:faithful/vanilla+', label: 'Faithful/Vanilla+' },
    ]);
  });

  it('normalizes whitespace and case in identities without plural merging', () => {
    expect(entryTags(single({ categoryName: ' Custom   Visuals ' }))[0]).toEqual({ key: 'tag:custom visuals', label: 'Custom Visuals' });
    expect(entryTags(single({ categoryName: 'custom visuals' }))[0].key).toBe('tag:custom visuals');
    expect(entryTags(single({ categoryName: 'Soul Container' }))[0].key).not.toBe(entryTags(single({ categoryName: 'Soul Containers' }))[0].key);
  });

  it('counts each grouped entry only once for a shared ancestor or category', () => {
    const grouped = group([single({ categoryId: 3 }).mod, single({ categoryId: 3 }).mod]);
    const counts = new Map<string, number>();
    for (const entry of [grouped, single({ categoryId: 3 })]) {
      for (const tag of entryTags(entry, context)) counts.set(tag.key, (counts.get(tag.key) ?? 0) + 1);
    }
    expect([...counts]).toEqual([['tag:skins', 2], ['tag:faithful/vanilla+', 2]]);
  });

  it('keeps Sound/Wip markers and their actual categories', () => {
    expect(entryTags(single({ sourceSection: 'Sound', globalType: 'announcer', categoryName: 'Other/Misc' }))).toEqual([
      { key: 'tag:other/misc', label: 'Other/Misc' }, { key: 'tag:sounds', label: 'Sounds' },
    ]);
    expect(entryTags(single({ sourceSection: 'Wip', categoryName: 'Skins' }))).toEqual([
      { key: 'tag:skins', label: 'Skins' }, { key: 'tag:wip', label: 'Wip' },
    ]);
  });

  it('retains local explicit classifications without inventing an unclassified bucket', () => {
    expect(entryTags(single({ gameBananaId: undefined, globalType: 'soul-container' }))).toEqual([
      { key: 'tag:soul containers', label: 'Soul Containers' },
    ]);
    expect(entryTags(single({ categoryName: undefined }))).toEqual([]);
    expect(entryTags(group([single({ categoryName: undefined }).mod, single({ categoryName: 'Solomon' }).mod]), context)).toEqual([]);
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
