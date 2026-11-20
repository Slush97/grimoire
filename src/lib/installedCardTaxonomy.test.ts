import { describe, expect, it } from 'vitest';
import { buildCategoryPaths } from './categoryPaths';
import { defaultInstalledTagOrder, sortInstalledTags, getInstalledCardTaxonomy, getInstalledGroupTaxonomy, getInstalledDefaultTaxonomy, installedTagChangesForVariants, installedTaxonomyTags, installedBaseTagOptions, type InstalledTaxonomyContext } from './installedCardTaxonomy';

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
  it('retains detected heroes and local Base defaults after selections change or clear', () => {
    const local = { globalType: 'maps' as const, lockerHeroes: [], tagOverrides: { base: ['Maps'], heroes: [] },
      detectedTags: { heroes: ['Haze'], globalType: 'soul-container' as const } };
    const defaults = getInstalledDefaultTaxonomy(local, [local], context);
    expect(defaults.tags).toEqual([]);
    expect(defaults.heroNames).toEqual(['Haze']);
    expect(getInstalledDefaultTaxonomy({ ...local, tagOverrides: { base: [], heroes: [] } }, [local], context)).toEqual(defaults);
    expect(local.globalType).toBe('maps');
    expect(local.tagOverrides.base).toEqual(['Maps']);
  });

  it('changes grouped tags without copying unrelated Base tags or heroes between variants', () => {
    const one = { categoryName: 'Skins', lockerHeroes: ['Haze'], tagOverrides: { base: ['Skins', 'HUD'] } };
    const two = { categoryName: 'Skins', lockerHeroes: ['Wraith'], tagOverrides: { base: ['Skins', 'Effects'] } };
    const plan = installedTagChangesForVariants(one, [one, two], { base: ['Skins', 'Effects'], heroes: ['Wraith'] }, context);
    expect(plan[0]).toEqual({ mod: one, tags: { base: ['Skins'], heroes: [] } });
    expect(plan[1].tags?.base).toEqual(expect.arrayContaining(['Skins', 'Effects']));
    expect(plan[1].tags?.base).toHaveLength(2);
    expect(plan[1].tags?.heroes).toEqual(['Wraith']);
    expect(installedTagChangesForVariants(one, [one, two], { base: [], heroes: [] }, context).map(change => change.tags))
      .toEqual([{ base: [], heroes: [] }, { base: [], heroes: [] }]);
    expect(installedTagChangesForVariants(one, [one, two], null, context)).toEqual([{ mod: one, tags: null }, { mod: two, tags: null }]);
    expect(one.tagOverrides.base).toEqual(['Skins', 'HUD']);
    expect(two.tagOverrides.base).toEqual(['Skins', 'Effects']);
  });

  it('keeps original categories available after clearing or replacing Base tags, including section tags', () => {
    const mod = { gameBananaId: 7, sourceSection: 'Sound', categoryId: 2, lockerHeroes: ['Haze'] };
    expect(installedTaxonomyTags(getInstalledCardTaxonomy(mod, context), mod.sourceSection)).toEqual(['Abilities', 'Sounds']);
    const cleared = getInstalledCardTaxonomy({ ...mod, tagOverrides: { base: [], heroes: [] } }, context);
    expect(installedTaxonomyTags(cleared, mod.sourceSection)).toEqual([]);
    expect(cleared.heroNames).toEqual([]);
    const changed = getInstalledCardTaxonomy({ ...mod, tagOverrides: { base: ['HUD', 'Maps'] } }, context);
    expect(installedTaxonomyTags(changed, mod.sourceSection)).toEqual(['HUD', 'Maps']);
    expect(changed.heroNames).toEqual(['Haze']);
    const clearedMod = { ...mod, tagOverrides: { base: [], heroes: [] } };
    expect(getInstalledGroupTaxonomy(clearedMod, [clearedMod], context).tags).toEqual([]);
    expect(installedBaseTagOptions(context, ['Legacy label'])).toEqual(expect.arrayContaining(['Skins', 'Sounds', 'HUD', 'Abilities', 'Faithful/Vanilla+', 'Legacy label']));
    expect(installedBaseTagOptions(context)).not.toContain('Solomon');
    const iconTags = installedBaseTagOptions({ pathsByModel: { ModCategory: buildCategoryPaths([{ id: 6, name: 'Icons', itemCount: 1 }]) } });
    expect(iconTags).toContain('Icons');
    expect(iconTags).not.toContain('Icon Packs');
    const selected = { categoryId: 3, tagOverrides: { base: ['Faithful/Vanilla+', 'Skins'] } };
    expect(getInstalledGroupTaxonomy(selected, [selected], context).tags).toEqual(['Faithful/Vanilla+', 'Skins']);
  });

  it('defaults custom tags first, retains the category hierarchy, and allows manual priorities to override both', () => {
    const tags = [{ key: 'tag:skins' }, { key: 'custom:favorites', custom: true }, { key: 'tag:faithful/vanilla+' }];
    expect(defaultInstalledTagOrder(tags, context.pathsByModel)).toEqual(['custom:favorites', 'tag:faithful/vanilla+', 'tag:skins']);
    expect(sortInstalledTags(tags, ['tag:skins', 'custom:favorites']).map(tag => tag.key)).toEqual(['tag:skins', 'custom:favorites', 'tag:faithful/vanilla+']);
    expect(sortInstalledTags(tags, []).map(tag => tag.key)).toEqual(tags.map(tag => tag.key));
  });
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
    const local = getInstalledCardTaxonomy({ globalType: 'hud' });
    expect(local.categoryLabels).toEqual([]);
    expect(local.customLabels).toEqual(['HUD']);
    expect(installedTaxonomyTags(local)).toEqual(['HUD']);
    const categorized = getInstalledCardTaxonomy({ globalType: 'hud', categoryName: 'Custom visuals' });
    expect(categorized.categoryLabels).toEqual(['Custom visuals']);
    expect(categorized.customLabels).toBeUndefined();
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
    expect(taxonomy.tags).toEqual(['VOs', 'Abilities', 'Sounds']);
  });

  it('orders card categories deepest-first without changing root-to-leaf filter facets', () => {
    const mod = { gameBananaId: 1, categoryId: 3, categoryName: 'Old label' };
    const taxonomy = getInstalledGroupTaxonomy(mod, [mod], context);
    expect(taxonomy.tags).toEqual(['Faithful/Vanilla+', 'Skins']);
    expect(taxonomy.categoryLabels).toEqual(['Skins', 'Faithful/Vanilla+']);
    expect(installedTaxonomyTags(getInstalledCardTaxonomy(mod, context))).toEqual(['Skins', 'Faithful/Vanilla+']);
  });

  it('starts with the representative leaf and keeps all group branch children before their ancestors', () => {
    const branchContext = { pathsByModel: { ModCategory: buildCategoryPaths([{
      id: 10, name: 'Visuals', itemCount: 1, children: [{
        id: 11, name: 'Accessibility', itemCount: 1, children: [{ id: 12, name: 'Crosshair', itemCount: 1 }],
      }, {
        id: 13, name: 'Animations', itemCount: 1, children: [{ id: 14, name: 'Reload', itemCount: 1 }],
      }],
    }]) } };
    const representative = { gameBananaId: 1, categoryId: 12 };
    const other = { gameBananaId: 1, categoryId: 14 };
    const taxonomy = getInstalledGroupTaxonomy(representative, [other, representative, other], branchContext);
    expect(taxonomy.tags).toEqual(['Crosshair', 'Reload', 'Accessibility', 'Animations', 'Visuals']);
    expect(new Set(taxonomy.tags)).toEqual(new Set([
      ...installedTaxonomyTags(getInstalledCardTaxonomy(representative, branchContext)),
      ...installedTaxonomyTags(getInstalledCardTaxonomy(other, branchContext)),
    ]));
  });

  it('keeps section markers and local custom classifications behind every real category', () => {
    const soundContext = { pathsByModel: { SoundCategory: buildCategoryPaths([{
      id: 10, name: 'Voices', itemCount: 1, children: [{ id: 11, name: 'VOs', itemCount: 1 }],
    }]) } };
    const representative = { globalType: 'hud' as const };
    const sound = { sourceSection: 'Sound', categoryId: 11 };
    const taxonomy = getInstalledGroupTaxonomy(representative, [representative, sound], soundContext);
    expect(taxonomy.categoryLabels).toEqual(['Voices', 'VOs']);
    expect(taxonomy.customLabels).toEqual(['HUD']);
    expect(taxonomy.tags).toEqual(['VOs', 'Voices', 'Sounds', 'HUD']);
    const duplicate = getInstalledGroupTaxonomy(representative, [representative, { categoryName: 'HUD' }]);
    expect(duplicate.tags).toEqual(['HUD']);
  });
});

it('omits Cursor Base labels from categories, saved choices and available options', () => {
  const context = { pathsByModel: { ModCategory: buildCategoryPaths([{ id: 1, name: 'Cursors', itemCount: 1 }]) } };
  expect(installedBaseTagOptions(context, ['Cursor', 'Cursors', 'HUD'])).not.toEqual(expect.arrayContaining(['Cursor']));
  expect(installedBaseTagOptions(context, ['Cursor', 'Cursors', 'HUD'])).not.toContain('Cursors');
  const mod = { sourceSection: 'Mod', categoryName: 'Cursors', tagOverrides: { base: ['Cursor', 'HUD'] } };
  expect(getInstalledGroupTaxonomy(mod, [mod], context).tags).toEqual(['HUD']);
});
