import { describe, expect, it } from 'vitest';
import { heroNameForLabel } from './heroNames';
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
