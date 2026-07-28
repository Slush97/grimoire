import { describe, expect, it } from 'vitest';
import {
  appendHeroTypeaheadCharacter,
  backspaceHeroTypeahead,
  expireHeroTypeaheadQuery,
  isHeroTypeaheadKey,
  reconcileHeroTypeaheadHeroes,
  type HeroTypeaheadState,
} from './lockerHeroTypeahead';

const heroes = [
  { id: 1, name: 'Ivy' },
  { id: 2, name: 'Shiv' },
  { id: 3, name: 'Seven' },
  { id: 4, name: 'Haze' },
];

const emptyState: HeroTypeaheadState = {
  query: '',
  highlightedHeroIds: null,
};

describe('locker hero typeahead', () => {
  it('uses prefix matching for one letter, then substring matching', () => {
    const withI = appendHeroTypeaheadCharacter(emptyState, 'i', heroes);
    const withIv = appendHeroTypeaheadCharacter(withI, 'v', heroes);

    expect(withI).toEqual({
      query: 'i',
      highlightedHeroIds: [1],
    });
    expect(withIv).toEqual({
      query: 'iv',
      highlightedHeroIds: [1, 2],
    });
  });

  it('accepts punctuation used in hero names', () => {
    expect(isHeroTypeaheadKey('&', false)).toBe(true);
    expect(isHeroTypeaheadKey(' ', false)).toBe(false);
    expect(isHeroTypeaheadKey(' ', true)).toBe(true);

    const moAndKrill = [{ id: 5, name: 'Mo & Krill' }];
    const state = [...'mo & krill'].reduce(
      (current, character) =>
        appendHeroTypeaheadCharacter(current, character, moAndKrill),
      emptyState
    );

    expect(state.highlightedHeroIds).toEqual([5]);
  });

  it('leaves the hero list unfiltered when nothing matches', () => {
    const withT = appendHeroTypeaheadCharacter(emptyState, 't', heroes);
    const withTe = appendHeroTypeaheadCharacter(withT, 'e', heroes);
    const withTes = appendHeroTypeaheadCharacter(withTe, 's', heroes);
    const withTest = appendHeroTypeaheadCharacter(withTes, 't', heroes);

    expect(withTest).toEqual({
      query: 'test',
      highlightedHeroIds: null,
    });
  });

  it('edits the active query with Backspace', () => {
    const withS = appendHeroTypeaheadCharacter(emptyState, 's', heroes);
    const withSh = appendHeroTypeaheadCharacter(withS, 'h', heroes);

    expect(backspaceHeroTypeahead(withSh, heroes)).toEqual({
      query: 's',
      highlightedHeroIds: [2, 3],
    });
  });

  it('fades the text without clearing the current highlight', () => {
    const withS = appendHeroTypeaheadCharacter(emptyState, 's', heroes);

    expect(expireHeroTypeaheadQuery(withS)).toEqual({
      query: '',
      highlightedHeroIds: [2, 3],
    });
  });

  it('clears a persisted highlight when Backspace is pressed after fading', () => {
    const expired = expireHeroTypeaheadQuery(
      appendHeroTypeaheadCharacter(emptyState, 's', heroes)
    );

    expect(backspaceHeroTypeahead(expired, heroes)).toEqual(emptyState);
  });

  it('starts a fresh query after the previous text has faded', () => {
    const withI = appendHeroTypeaheadCharacter(emptyState, 'i', heroes);
    const withIv = appendHeroTypeaheadCharacter(withI, 'v', heroes);
    const expired = expireHeroTypeaheadQuery(withIv);

    expect(appendHeroTypeaheadCharacter(expired, 's', heroes)).toEqual({
      query: 's',
      highlightedHeroIds: [2, 3],
    });
  });

  it('keeps only visible highlights when the displayed heroes change', () => {
    const expired = expireHeroTypeaheadQuery(
      appendHeroTypeaheadCharacter(emptyState, 's', heroes)
    );

    expect(reconcileHeroTypeaheadHeroes(expired, [heroes[1]])).toEqual({
      query: '',
      highlightedHeroIds: [2],
    });
    expect(reconcileHeroTypeaheadHeroes(expired, [heroes[0]])).toEqual({
      query: '',
      highlightedHeroIds: null,
    });
  });
});
