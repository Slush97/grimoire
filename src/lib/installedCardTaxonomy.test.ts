import { describe, expect, it } from 'vitest';
import { buildCategoryPaths } from './categoryPaths';
import { getInstalledCardTaxonomy, type InstalledTaxonomyContext } from './installedCardTaxonomy';

const context: InstalledTaxonomyContext = {
  heroNames: ['Solomon'],
  heroByCategoryId: new Map([[2, 'Solomon'], [3, 'Solomon']]),
  pathsByModel: {
    ModCategory: buildCategoryPaths([{
      id: 1, name: 'Skins', itemCount: 1, children: [{
        id: 2, name: 'Solomon', itemCount: 1, children: [{ id: 3, name: 'Faithful/Vanilla+', itemCount: 1 }],
      }],
    }]),
    SoundCategory: buildCategoryPaths([{ id: 2, name: 'Abilities', itemCount: 1 }]),
  },
};

describe('getInstalledCardTaxonomy', () => {
  it('derives a hero from a hero category when locker metadata is absent', () => {
    expect(getInstalledCardTaxonomy({ categoryName: 'Abrams' })).toEqual({
      heroName: 'Abrams',
      globalType: undefined,
      categoryLabel: undefined,
    });
  });

  it('prefers an explicit locker hero and keeps a non-hero category', () => {
    expect(getInstalledCardTaxonomy({
      lockerHero: 'Warden',
      categoryName: 'Other/Misc',
    })).toEqual({
      heroName: 'Warden',
      globalType: undefined,
      categoryLabel: 'Other/Misc',
    });
  });

  it('canonicalizes hero aliases from either metadata source', () => {
    expect(getInstalledCardTaxonomy({ lockerHero: 'The Doorman' }).heroName).toBe('Doorman');
    expect(getInstalledCardTaxonomy({ categoryName: 'The Doorman' }).heroName).toBe('Doorman');
    expect(getInstalledCardTaxonomy({ categoryName: 'RatKing' }).heroName).toBe('Rat King');
  });

  it('uses a global classification instead of its redundant category', () => {
    expect(getInstalledCardTaxonomy({
      globalType: 'hud',
      categoryName: 'HUD',
    })).toEqual({
      heroName: undefined,
      globalType: 'hud',
      categoryLabel: undefined,
    });
  });

  it.each([
    ['soul-container', 'Soul Container', 'Soul Containers'],
    ['spirit-urn', 'Spirit Urn', 'Spirit Urns'],
  ] as const)('normalizes the %s category without changing classification', (globalType, categoryName, label) => {
    expect(getInstalledCardTaxonomy({ categoryName }).categoryLabel).toBe(label);
    expect(getInstalledCardTaxonomy({ globalType, categoryName })).toEqual({
      heroName: undefined, globalType, categoryLabel: undefined,
    });
  });

  it('retains a distinct leaf category for facets when the card has a global classification', () => {
    expect(getInstalledCardTaxonomy({ globalType: 'hud', categoryName: 'Quality of Life/Fixes' })).toEqual({
      heroName: undefined, globalType: 'hud', categoryLabel: 'Quality of Life/Fixes',
    });
    expect(getInstalledCardTaxonomy({ globalType: 'hud', categoryName: 'Other/Misc' }).categoryLabel).toBe('Other/Misc');
  });

  it('derives supported global sound categories', () => {
    expect(getInstalledCardTaxonomy({
      sourceSection: 'Sound',
      categoryName: 'Announcer',
    })).toEqual({
      heroName: undefined,
      globalType: 'announcer',
      categoryLabel: undefined,
    });
  });

  it('resolves a hero subcategory to its hero and keeps the subcategory label', () => {
    const heroByCategoryId = new Map([[33325, 'Viscous'], [50570, 'Viscous']]);
    expect(getInstalledCardTaxonomy({
      sourceSection: 'Mod',
      categoryId: 50570,
      categoryName: 'Faithful/Vanilla+',
    }, { heroByCategoryId })).toEqual({
      heroName: 'Viscous',
      globalType: undefined,
      categoryLabel: 'Faithful/Vanilla+',
    });
    expect(getInstalledCardTaxonomy({
      sourceSection: 'Sound',
      categoryId: 50570,
      categoryName: 'Abilities',
    }, { heroByCategoryId }).heroName).toBeUndefined();
  });

  it('returns a trimmed non-hero category as the sole text label', () => {
    expect(getInstalledCardTaxonomy({ categoryName: '  Quality of Life  ' })).toEqual({
      heroName: undefined,
      globalType: undefined,
      categoryLabel: 'Quality of Life',
    });
  });

  it('uses the current dynamic hero category instead of keeping a duplicate text label', () => {
    expect(getInstalledCardTaxonomy({ categoryId: 2, categoryName: 'Old category name', sourceSection: 'Mod' }, context)).toEqual({
      heroName: 'Solomon', globalType: undefined, categoryLabel: undefined,
    });
    expect(getInstalledCardTaxonomy({ lockerHero: 'Solomon', categoryName: 'Solomon' }).categoryLabel).toBeUndefined();
  });

  it('keeps only the current leaf classification when resolving a nested hero category', () => {
    expect(getInstalledCardTaxonomy({ categoryId: 3, categoryName: 'Old leaf name' }, context)).toEqual({
      heroName: 'Solomon', globalType: undefined, categoryLabel: 'Faithful/Vanilla+',
    });
  });

  it('keeps section category IDs isolated and preserves an explicit hero override', () => {
    expect(getInstalledCardTaxonomy({ categoryId: 2, categoryName: 'Old name', sourceSection: 'Sound' }, context)).toEqual({
      heroName: undefined, globalType: undefined, categoryLabel: 'Abilities',
    });
    expect(getInstalledCardTaxonomy({ categoryId: 2, lockerHero: 'Haze' }, context)).toEqual({
      heroName: 'Haze', globalType: undefined, categoryLabel: undefined,
    });
  });

  it('shares Sound title fallback without turning global sounds into hero content', () => {
    expect(getInstalledCardTaxonomy({ name: 'Haze voice', sourceSection: 'Sound', categoryName: 'Voices' }).heroName).toBe('Haze');
    expect(getInstalledCardTaxonomy({ name: 'Haze voice', sourceSection: 'Sound', categoryName: 'Announcer' })).toEqual({
      heroName: undefined, globalType: 'announcer', categoryLabel: undefined,
    });
  });

  it('normalizes known classification casing and falls back to supplied labels offline', () => {
    expect(getInstalledCardTaxonomy({ categoryName: '  hUd ' }).categoryLabel).toBe('HUD');
    expect(getInstalledCardTaxonomy({ categoryId: 99, categoryName: '  Custom   visuals  ' }, context).categoryLabel).toBe('Custom visuals');
  });

  it('retains legacy breadcrumb hero matching when no category ID resolves', () => {
    expect(getInstalledCardTaxonomy({ categoryName: 'Skins > Ivy' })).toEqual({
      heroName: 'Ivy', globalType: undefined, categoryLabel: undefined,
    });
    expect(getInstalledCardTaxonomy({ categoryId: 99, categoryName: 'Skins / Solomon' }, context)).toEqual({
      heroName: 'Solomon', globalType: undefined, categoryLabel: undefined,
    });
    expect(getInstalledCardTaxonomy({ categoryName: 'Skins > Ivy', lockerHero: 'Haze' }).heroName).toBe('Haze');
    expect(getInstalledCardTaxonomy({ categoryId: 3, categoryName: 'Skins > Ivy' }, context)).toEqual({
      heroName: 'Solomon', globalType: undefined, categoryLabel: 'Faithful/Vanilla+',
    });
  });
});
