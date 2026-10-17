import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/grimoire-search-test' } }));

import { applyCategoryFilter } from './searchService';

function filter(
  categoryId: number | undefined,
  categoryName: string | undefined,
  heroName: string | undefined,
  heroCategoryIds: number[] | undefined
) {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  applyCategoryFilter(conditions, params, categoryId, categoryName, heroName, heroCategoryIds);
  return { conditions, params };
}

describe('applyCategoryFilter hero scoping', () => {
  it('matches Mod skins on the hero category ids, never the title', () => {
    const { conditions, params } = filter(42671, undefined, undefined, [42671]);
    expect(conditions).toEqual(['mods.sub_category_id IN (@hero_category_0)']);
    expect(params).toEqual({ hero_category_0: 42671 });
  });

  it('includes nested categories so a Rat King skin filed under its flag category still matches', () => {
    const { conditions, params } = filter(49629, undefined, undefined, [49629, 49852]);
    expect(conditions).toEqual(['mods.sub_category_id IN (@hero_category_0, @hero_category_1)']);
    expect(params).toEqual({ hero_category_0: 49629, hero_category_1: 49852 });
  });

  it('matches Sound and Wip by whole-word hero name through the registered function', () => {
    const { conditions, params } = filter(42671, undefined, 'Silver', undefined);
    expect(conditions).toEqual(['hero_name_match(mods.name, @heroName)']);
    expect(params).toEqual({ heroName: 'Silver' });
    expect(conditions.join(' ')).not.toMatch(/LIKE/i);
  });

  it('prefers the category ids when both are given', () => {
    const { conditions } = filter(42671, undefined, 'Silver', [42671]);
    expect(conditions).toEqual(['mods.sub_category_id IN (@hero_category_0)']);
  });

  it('lets a hero scope without a category id', () => {
    expect(filter(undefined, undefined, undefined, [33306]).conditions)
      .toEqual(['mods.sub_category_id IN (@hero_category_0)']);
  });

  it('leaves non-hero category scoping alone', () => {
    const named = filter(33154, 'Model Replacement', undefined, undefined);
    expect(named.conditions).toEqual(['mods.category_name = @categoryName COLLATE NOCASE']);
    expect(named.params).toEqual({ categoryName: 'Model Replacement' });
    expect(filter(undefined, undefined, undefined, undefined).conditions).toEqual([]);
  });
});
