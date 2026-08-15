import { describe, expect, it } from 'vitest';
import { getInstalledCardTaxonomy } from './installedCardTaxonomy';

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

  it('returns a trimmed non-hero category as the sole text label', () => {
    expect(getInstalledCardTaxonomy({ categoryName: '  Quality of Life  ' })).toEqual({
      heroName: undefined,
      globalType: undefined,
      categoryLabel: 'Quality of Life',
    });
  });
});
