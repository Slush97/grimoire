import { describe, expect, it } from 'vitest';
import { getFoundryHeroNeighbors, orderFoundryHeroes } from './foundryHeroNavigation';
import type { HeroInfo } from '../types/foundry';

const hero = (name: string, selectable = true, disabled = false): HeroInfo => ({
  codename: name.toLowerCase(), name, selectable, disabled, inDevelopment: !selectable,
});
const ivy = hero('Ivy');
const haze = hero('Haze');
const staging = hero('Alpha', false);

describe('Foundry hero navigation', () => {
  it('uses the grid order, skips disabled heroes, and does not mutate the roster', () => {
    const roster = [ivy, staging, hero('Hidden', true, true), haze];
    expect(orderFoundryHeroes(roster)).toEqual([haze, ivy, staging]);
    expect(roster[0]).toBe(ivy);
    expect(orderFoundryHeroes(roster, ' IV ')).toEqual([ivy]);
  });

  it('wraps both ways within the filtered roster', () => {
    expect(getFoundryHeroNeighbors([haze, ivy, staging], haze.codename)).toEqual({ previous: staging, next: ivy });
    expect(getFoundryHeroNeighbors([haze, ivy], ivy.codename)).toEqual({ previous: haze, next: haze });
  });

  it('disables both controls without another destination', () => {
    for (const roster of [[], [ivy], [haze]]) {
      expect(getFoundryHeroNeighbors(roster, ivy.codename)).toEqual({ previous: undefined, next: undefined });
    }
  });
});
