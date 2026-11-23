import { describe, expect, it } from 'vitest';
import { applyProfileOrder } from './profileOrder';

const profiles = ['ranked', 'casual', 'memes', 'testing'].map(id => ({ id }));
const ids = (list: { id: string }[]) => list.map(profile => profile.id);

describe('applyProfileOrder', () => {
  it('lists profiles in the dragged order', () => {
    expect(ids(applyProfileOrder(profiles, ['testing', 'ranked', 'casual', 'memes'])))
      .toEqual(['testing', 'ranked', 'casual', 'memes']);
  });

  it('keeps a profile the order does not mention, after the listed ones', () => {
    expect(ids(applyProfileOrder(profiles, ['memes', 'ranked']))).toEqual(['memes', 'ranked', 'casual', 'testing']);
  });

  it('ignores deleted and repeated ids instead of dropping or duplicating a profile', () => {
    expect(ids(applyProfileOrder(profiles, ['gone', 'memes', 'memes', 'ranked', 'casual', 'testing'])))
      .toEqual(['memes', 'ranked', 'casual', 'testing']);
    expect(ids(applyProfileOrder(profiles, []))).toEqual(ids(profiles));
  });
});
