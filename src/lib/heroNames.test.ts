import { describe, expect, it } from 'vitest';
import { heroNameForLabel, heroNamesInText } from './heroNames';
import { getHeroChipIconPath } from './lockerUtils';

describe('heroNameForLabel', () => {
  it('matches dynamic hero names exactly without relying on the shared roster', () => {
    expect(heroNameForLabel(' violet ', ['Violet'])).toBe('Violet');
    expect(heroNameForLabel('Violet effects', ['Violet'])).toBeNull();
  });

  it('canonicalizes category aliases case-insensitively', () => {
    expect(heroNameForLabel('ratking', ['Rat King'])).toBe('Rat King');
    expect(heroNameForLabel('RatKing')).toBe('Rat King');
    expect(heroNameForLabel('THE DOORMAN', ['Doorman'])).toBe('Doorman');
    expect(heroNameForLabel('  THE   DOORMAN  ', ['Doorman'])).toBe('Doorman');
    expect(getHeroChipIconPath('The Doorman')).toBe(getHeroChipIconPath('Doorman'));
    expect(getHeroChipIconPath('RatKing')).toBe(getHeroChipIconPath('Rat King'));
  });

  it('uses known names before a cached tree has loaded', () => {
    expect(heroNameForLabel('Abrams', [])).toBe('Abrams');
    expect(heroNameForLabel('  Custom   category  ', [])).toBeNull();
  });
});

describe('heroNamesInText', () => {
  it('matches newer cached heroes and normalizes authored separators', () => {
    expect(heroNamesInText('VIOLET + nurse_harrow and deadman-danny', ['Violet', 'Nurse Harrow', 'Deadman Danny']))
      .toEqual(['Violet', 'Nurse Harrow', 'Deadman Danny']);
  });

  it('deduplicates canonical names and preserves whole-name boundaries', () => {
    expect(heroNamesInText('The Doorman, RatKing and Rem2, not Silverhand', ['The Doorman', 'Doorman', 'Rat King', 'Rem', 'Silver']))
      .toEqual(['Doorman', 'Rat King', 'Rem']);
  });

  it('uses the bundled roster and its aliases without a cached tree', () => {
    expect(heroNamesInText('Geist and Mo and Krill', [])).toEqual(['Lady Geist', 'Mo & Krill']);
  });
});
