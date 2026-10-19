import { describe, expect, it } from 'vitest';
import { getLockerHeroNeighbors } from './lockerHeroNavigation';

const ivy = { id: 1, name: 'Ivy' };
const haze = { id: 2, name: 'Haze' };
const shiv = { id: 3, name: 'Shiv' };
const heroes = [ivy, haze, shiv];

describe('Locker hero navigation', () => {
  it('follows the displayed order and wraps in both directions', () => {
    expect(getLockerHeroNeighbors(heroes, heroes, ivy.id)).toEqual({ previous: shiv, next: haze });
    expect(getLockerHeroNeighbors(heroes, heroes, shiv.id)).toEqual({ previous: haze, next: ivy });
  });

  it('skips hidden heroes, retaining a newly hidden current hero as an anchor', () => {
    expect(getLockerHeroNeighbors(heroes, [ivy, shiv], ivy.id)).toEqual({ previous: shiv, next: shiv });
    expect(getLockerHeroNeighbors(heroes, [ivy, shiv], haze.id)).toEqual({ previous: ivy, next: shiv });
  });

  it('has no destination for an empty roster, a single hero or a missing current hero', () => {
    const empty = { previous: undefined, next: undefined };
    expect(getLockerHeroNeighbors([], [], ivy.id)).toEqual(empty);
    expect(getLockerHeroNeighbors(heroes, [ivy], ivy.id)).toEqual(empty);
    expect(getLockerHeroNeighbors(heroes, [], ivy.id)).toEqual(empty);
    expect(getLockerHeroNeighbors(heroes, heroes, 99)).toEqual(empty);
  });
});
