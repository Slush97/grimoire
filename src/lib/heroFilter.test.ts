import { describe, expect, it } from 'vitest';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import { categoryIdFromProfileUrl, categorySubtreeIds, nameMentionsHero } from './heroFilter';

describe('nameMentionsHero', () => {
  it('does not match a hero inside a longer word', () => {
    expect(nameMentionsHero('Johnny Silverhand', 'Silver')).toBe(false);
    expect(nameMentionsHero('Remodel pack', 'Rem')).toBe(false);
    expect(nameMentionsHero('Remake of the HUD', 'Rem')).toBe(false);
    expect(nameMentionsHero('Reminder chime', 'Rem')).toBe(false);
    expect(nameMentionsHero('Hazelnut latte', 'Haze')).toBe(false);
  });

  it('matches the hero as a whole word', () => {
    expect(nameMentionsHero('Silver', 'Silver')).toBe(true);
    expect(nameMentionsHero('Silver color scheme', 'Silver')).toBe(true);
    expect(nameMentionsHero('Dynamo in silver', 'Silver')).toBe(true);
    expect(nameMentionsHero('Rem (Re:Zero) voice lines', 'Rem')).toBe(true);
    expect(nameMentionsHero("Rem's ultimate", 'Rem')).toBe(true);
    expect(nameMentionsHero('Rem-chan', 'Rem')).toBe(true);
  });

  it('ignores case', () => {
    expect(nameMentionsHero('SILVER wolf', 'Silver')).toBe(true);
    expect(nameMentionsHero('rem', 'Rem')).toBe(true);
  });

  it('treats a trailing digit as part of a version, not of the name', () => {
    expect(nameMentionsHero('Rem2', 'Rem')).toBe(true);
    expect(nameMentionsHero('Haze v2', 'Haze')).toBe(true);
  });

  it('matches multi-word and symbol names', () => {
    expect(nameMentionsHero('Mo & Krill gold', 'Mo & Krill')).toBe(true);
    expect(nameMentionsHero('Lady Geist crimson', 'Lady Geist')).toBe(true);
    expect(nameMentionsHero('Grey Talon hunter', 'Grey Talon')).toBe(true);
  });

  it('uses the roster aliases', () => {
    expect(nameMentionsHero('Mo and Krill', 'Mo & Krill')).toBe(true);
    expect(nameMentionsHero('Geist but red', 'Lady Geist')).toBe(true);
    expect(nameMentionsHero('Rat King flag', 'Rat King')).toBe(true);
    expect(nameMentionsHero('RatKing flag', 'Rat King')).toBe(true);
  });

  it('does not let one hero match another', () => {
    expect(nameMentionsHero('Lady Geist crimson', 'Silver')).toBe(false);
    expect(nameMentionsHero('Grey wolf', 'Grey Talon')).toBe(false);
  });

  it('is not tripped by regex metacharacters in a name', () => {
    expect(nameMentionsHero('anything', 'Mo + (Krill)')).toBe(false);
    expect(nameMentionsHero('Mo + (Krill)', 'Mo + (Krill)')).toBe(true);
  });
});

describe('categoryIdFromProfileUrl', () => {
  it('reads the id out of a category profile URL', () => {
    expect(categoryIdFromProfileUrl('https://gamebanana.com/mods/cats/42674')).toBe(42674);
    expect(categoryIdFromProfileUrl('https://gamebanana.com/sounds/cats/6270')).toBe(6270);
    expect(categoryIdFromProfileUrl('https://gamebanana.com/wips/cats/2976')).toBe(2976);
  });

  it('returns undefined when there is no id to read', () => {
    expect(categoryIdFromProfileUrl(undefined)).toBeUndefined();
    expect(categoryIdFromProfileUrl('')).toBeUndefined();
    expect(categoryIdFromProfileUrl('https://gamebanana.com/mods/681048')).toBeUndefined();
  });
});

describe('categorySubtreeIds', () => {
  const node = (id: number, children?: GameBananaCategoryNode[]): GameBananaCategoryNode => ({
    id, name: `c${id}`, itemCount: 0, children,
  });

  it('is just the id for a leaf', () => {
    expect(categorySubtreeIds(node(33306))).toEqual([33306]);
  });

  it('includes every descendant, since a mod records the deepest category', () => {
    const ratKing = node(49629, [node(49852), node(1, [node(2)])]);
    expect(categorySubtreeIds(ratKing)).toEqual([49629, 49852, 1, 2]);
  });
});
