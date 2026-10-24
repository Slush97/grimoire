import { describe, expect, it } from 'vitest';
import { getInstalledCardTaxonomy } from './installedCardTaxonomy';

const base = { name: 'A skin', fileName: 'a_skin_dir.vpk' };

describe('getInstalledCardTaxonomy', () => {
  it('derives a hero from a hero category when locker metadata is absent', () => {
    expect(getInstalledCardTaxonomy({ ...base, categoryName: 'Abrams' })).toEqual({
      heroName: 'Abrams',
      globalType: undefined,
      categoryLabel: undefined,
    });
  });

  it('prefers an explicit locker hero and keeps a non-hero category', () => {
    expect(getInstalledCardTaxonomy({
      ...base,
      lockerHero: 'Warden',
      categoryName: 'Other/Misc',
    })).toEqual({
      heroName: 'Warden',
      globalType: undefined,
      categoryLabel: 'Other/Misc',
    });
  });

  it('canonicalizes hero aliases from either metadata source', () => {
    expect(getInstalledCardTaxonomy({ ...base, lockerHero: 'The Doorman' }).heroName).toBe('Doorman');
    expect(getInstalledCardTaxonomy({ ...base, categoryName: 'The Doorman' }).heroName).toBe('Doorman');
    expect(getInstalledCardTaxonomy({ ...base, categoryName: 'RatKing' }).heroName).toBe('Rat King');
  });

  it('uses a global classification instead of its redundant category', () => {
    expect(getInstalledCardTaxonomy({
      ...base,
      globalType: 'hud',
      categoryName: 'HUD',
    })).toEqual({
      heroName: undefined,
      globalType: 'hud',
      categoryLabel: undefined,
    });
  });

  it('derives the killstreak music global type from its sound category', () => {
    expect(getInstalledCardTaxonomy({
      ...base,
      sourceSection: 'Sound',
      categoryName: 'Killstreak Music',
    })).toEqual({
      heroName: undefined,
      globalType: 'killstreak-music',
      categoryLabel: undefined,
    });
  });

  it('resolves a hero subcategory to its hero and keeps the subcategory label', () => {
    const heroByCategoryId = new Map([[33325, 'Viscous'], [50570, 'Viscous']]);
    expect(getInstalledCardTaxonomy({
      ...base,
      sourceSection: 'Mod',
      categoryId: 50570,
      categoryName: 'Faithful/Vanilla+',
    }, heroByCategoryId)).toEqual({
      heroName: 'Viscous',
      globalType: undefined,
      categoryLabel: 'Faithful/Vanilla+',
    });
    expect(getInstalledCardTaxonomy({
      ...base,
      sourceSection: 'Sound',
      categoryId: 50570,
      categoryName: 'Abilities',
    }, heroByCategoryId).heroName).toBeUndefined();
  });

  it('returns a trimmed non-hero category as the sole text label', () => {
    expect(getInstalledCardTaxonomy({ ...base, categoryName: '  Quality of Life  ' })).toEqual({
      heroName: undefined,
      globalType: undefined,
      categoryLabel: 'Quality of Life',
    });
  });

  describe('a skin filed under a root category', () => {
    const heroByCategoryId = new Map([[33306, 'Abrams'], [41313, 'Mina'], [33324, 'Vindicta']]);

    it.each([
      ['Skins', 33295, 'Breezy Butterfly Mina (UPDATED 9/30/2026)', 'Mina'],
      ['Model Replacement', 33154, 'goth vindicta by ju', 'Vindicta'],
    ])('takes the hero from the title under %s', (categoryName, categoryId, name, hero) => {
      expect(getInstalledCardTaxonomy({
        ...base, name, sourceSection: 'Mod', categoryId, categoryName,
      }, heroByCategoryId)).toEqual({ heroName: hero, globalType: undefined, categoryLabel: categoryName });
    });

    it('leaves a title that names no hero unassigned', () => {
      expect(getInstalledCardTaxonomy({
        ...base, name: 'Midnight Skin', sourceSection: 'Mod', categoryId: 33295, categoryName: 'Skins',
      }, heroByCategoryId).heroName).toBeUndefined();
    });

    it('does not title-match a global mod or a mod the Locker does not manage', () => {
      const hideout = { ...base, name: 'Mina Hideout', sourceSection: 'Mod', categoryId: 33154, categoryName: 'Model Replacement' };
      expect(getInstalledCardTaxonomy({ ...hideout, globalType: 'hideout' }, heroByCategoryId).heroName).toBeUndefined();
      expect(getInstalledCardTaxonomy({ ...hideout, fileName: 'clothing_preset_a_dir.vpk' }, heroByCategoryId).heroName).toBeUndefined();
      expect(getInstalledCardTaxonomy({ ...hideout, sourceSection: 'Sound' }, heroByCategoryId).heroName).toBeUndefined();
    });
  });
});
