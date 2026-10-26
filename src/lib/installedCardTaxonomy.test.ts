import { describe, expect, it } from 'vitest';
import { buildCategoryPaths } from './categoryPaths';
import { getInstalledCardTaxonomy, getInstalledGroupTaxonomy, installedTaxonomyTags, type InstalledTaxonomyContext } from './installedCardTaxonomy';

const context: InstalledTaxonomyContext = {
  heroNames: ['Solomon', 'Haze', 'Wraith'],
  heroByCategoryId: new Map([[2, 'Solomon'], [3, 'Solomon']]),
  pathsByModel: {
    ModCategory: buildCategoryPaths([{
      id: 1, name: 'Skins', itemCount: 1, children: [{
        id: 2, name: 'Solomon', itemCount: 1, children: [{ id: 3, name: 'Faithul/Vanilla+', itemCount: 1 }],
      }],
    }]),
    SoundCategory: buildCategoryPaths([{ id: 2, name: 'Abilities', itemCount: 1 }]),
  },
};

describe('getInstalledCardTaxonomy', () => {
  it('keeps every non-hero ancestor and the corrected leaf with one hero icon', () => {
    expect(getInstalledCardTaxonomy({ gameBananaId: 1, categoryId: 3, categoryName: 'Old leaf name' }, context)).toEqual({
      heroNames: ['Solomon'], categoryLabels: ['Skins', 'Faithful/Vanilla+'], categoryLabel: 'Faithful/Vanilla+', globalType: undefined,
    });
  });

  it('represents a hero leaf only as an icon and keeps its non-hero ancestor', () => {
    const taxonomy = getInstalledCardTaxonomy({ categoryId: 2, categoryName: 'Old category' }, context);
    expect(taxonomy.heroNames).toEqual(['Solomon']);
    expect(taxonomy.categoryLabels).toEqual(['Skins']);
    expect(taxonomy.categoryLabel).toBe('Skins');
  });

  it('keeps manual heroes ahead of automatic identities without changing category tags', () => {
    const taxonomy = getInstalledCardTaxonomy({
      gameBananaId: 1, categoryId: 3, lockerHero: 'Haze', lockerHeroSource: 'manual', lockerHeroes: ['Haze'],
    }, context);
    expect(taxonomy.heroNames).toEqual(['Haze']);
    expect(taxonomy.categoryLabels).toEqual(['Skins', 'Faithful/Vanilla+']);
  });

  it('honors effective hero arrays, including an empty result, ahead of raw legacy tags', () => {
    const local = { lockerHero: 'Haze', lockerHeroSource: 'vpk' as const };
    expect(getInstalledCardTaxonomy({ ...local, lockerHeroes: [] }).heroNames).toEqual([]);
    expect(getInstalledCardTaxonomy({ ...local, lockerHeroes: ['Wraith'] }).heroNames).toEqual(['Wraith']);
    expect(getInstalledCardTaxonomy({ ...local, lockerHeroSource: 'manual', lockerHeroes: [] }).heroNames).toEqual([]);
    expect(getInstalledCardTaxonomy(local).heroNames).toEqual(['Haze']);
  });

  it('honors effective HUD hero sets alongside General routing while suppressing raw legacy fallback', () => {
    const conflicting = { globalType: 'hud' as const, lockerHero: 'Haze' };
    expect(getInstalledCardTaxonomy({ ...conflicting, lockerHeroSource: 'vpk' }).heroNames).toEqual([]);
    expect(getInstalledCardTaxonomy({ ...conflicting, gameBananaId: 1, lockerHeroSource: 'manual' }).heroNames).toEqual([]);
    expect(getInstalledCardTaxonomy({ ...conflicting, lockerHeroes: [] }).heroNames).toEqual([]);
    const resolved = getInstalledCardTaxonomy({ ...conflicting, lockerHeroes: ['Haze', 'Wraith'] });
    expect(resolved.heroNames).toEqual(['Haze', 'Wraith']);
    expect(resolved.globalType).toBe('hud');
  });

  it.each(['Sound', 'Wip'])('uses every resolved %s hero instead of the submission title or old inference', sourceSection => {
    const mod = { gameBananaId: 1, sourceSection, categoryName: 'VOs', lockerHero: 'Warden', lockerHeroSource: 'download-title' as const };
    expect(getInstalledCardTaxonomy(mod).heroNames).toEqual([]);
    expect(getInstalledCardTaxonomy({ ...mod, lockerHeroes: ['Haze', 'Wraith', 'Haze'] }).heroNames).toEqual(['Haze', 'Wraith']);
  });

  it('keeps category IDs scoped to their section', () => {
    expect(getInstalledCardTaxonomy({ sourceSection: 'Sound', categoryId: 2 }, context)).toEqual({
      heroNames: [], categoryLabels: ['Abilities'], categoryLabel: 'Abilities', globalType: undefined,
    });
  });

  it('never adds a linked General classification to the category labels', () => {
    const taxonomy = getInstalledCardTaxonomy({ gameBananaId: 1, globalType: 'hud', categoryName: 'Quality of Life/Fixes' });
    expect(taxonomy.categoryLabels).toEqual(['Quality of Life/Fixes']);
    expect(taxonomy.globalType).toBe('hud');
    expect(getInstalledCardTaxonomy({ gameBananaId: 1, globalType: 'hud' }).categoryLabels).toEqual([]);
  });

  it('preserves local explicit General labels only when no category is available', () => {
    expect(getInstalledCardTaxonomy({ globalType: 'hud' }).categoryLabels).toEqual(['HUD']);
    expect(getInstalledCardTaxonomy({ globalType: 'hud', categoryName: 'Custom visuals' }).categoryLabels).toEqual(['Custom visuals']);
  });

  it('keeps singular and plural categories distinct', () => {
    expect(getInstalledCardTaxonomy({ categoryName: 'Soul Container' }).categoryLabel).toBe('Soul Container');
    expect(getInstalledCardTaxonomy({ categoryName: 'Soul Containers' }).categoryLabel).toBe('Soul Containers');
    expect(getInstalledCardTaxonomy({ categoryName: 'Spirit Urn' }).categoryLabel).toBe('Spirit Urn');
  });

  it('keeps offline labels and breadcrumb heroes without splitting a category slash', () => {
    expect(getInstalledCardTaxonomy({ categoryName: 'Skins > Ivy' }).heroNames).toEqual(['Ivy']);
    expect(getInstalledCardTaxonomy({ categoryName: 'Skins / Solomon' }, context).categoryLabels).toEqual(['Skins']);
    expect(getInstalledCardTaxonomy({ categoryName: 'Faithful/Vanilla+' }).categoryLabels).toEqual(['Faithful/Vanilla+']);
    expect(getInstalledCardTaxonomy({ categoryId: 99, categoryName: ' Custom   visuals ' }, context).categoryLabel).toBe('Custom visuals');
  });

  it('canonicalizes explicit hero aliases', () => {
    expect(getInstalledCardTaxonomy({ lockerHero: 'The Doorman' }).heroNames).toEqual(['Doorman']);
    expect(getInstalledCardTaxonomy({ categoryName: 'RatKing' }).heroNames).toEqual(['Rat King']);
  });

  it('retains source markers without creating an Other fallback', () => {
    expect(installedTaxonomyTags(getInstalledCardTaxonomy({}), 'Sound')).toEqual(['Sounds']);
    expect(installedTaxonomyTags(getInstalledCardTaxonomy({}), 'Wip')).toEqual(['Wip']);
    expect(installedTaxonomyTags(getInstalledCardTaxonomy({}))).toEqual([]);
  });
});

describe('getInstalledGroupTaxonomy', () => {
  it('only previews a portrait when the card and representative resolve the same single hero', () => {
    const haze = { sourceSection: 'Sound', categoryName: 'VOs', lockerHeroes: ['Haze'] };
    const wraith = { sourceSection: 'Sound', categoryName: 'VOs', lockerHeroes: ['Wraith'] };
    const known = getInstalledGroupTaxonomy(wraith, [haze, wraith]);
    expect(known.heroNames).toEqual(['Haze', 'Wraith']);
    expect(known.previewHeroName).toBeUndefined();
    expect(getInstalledGroupTaxonomy(wraith, [wraith, { ...wraith }]).previewHeroName).toBe('Wraith');
    const multihero = { ...wraith, lockerHeroes: ['Haze', 'Wraith'] };
    expect(getInstalledGroupTaxonomy(multihero, [multihero]).previewHeroName).toBeUndefined();
    const unknown = { ...wraith, lockerHeroes: [] };
    const unresolved = getInstalledGroupTaxonomy(unknown, [haze, unknown]);
    expect(unresolved.heroNames).toEqual(['Haze']);
    expect(unresolved.previewHeroName).toBeUndefined();
  });

  it('combines hero/category sets while retaining the representative deepest category', () => {
    const representative = { sourceSection: 'Sound', categoryName: 'VOs', lockerHeroes: ['Haze', 'Wraith'] };
    const taxonomy = getInstalledGroupTaxonomy(representative, [
      representative, { sourceSection: 'Sound', categoryName: 'Abilities', lockerHeroes: ['Wraith'] }, representative,
    ]);
    expect(taxonomy.heroNames).toEqual(['Haze', 'Wraith']);
    expect(taxonomy.categoryLabel).toBe('VOs');
    expect(taxonomy.categoryLabels).toEqual(['VOs', 'Abilities']);
    expect(taxonomy.tags).toEqual(['VOs', 'Sounds', 'Abilities']);
  });
});
