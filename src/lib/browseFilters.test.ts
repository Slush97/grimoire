import { describe, expect, it } from 'vitest';
import { browseRemoteFilters } from './browseFilters';

describe('Browse remote hero filters', () => {
  it('uses the hero category for Mods', () => {
    expect(browseRemoteFilters({
      section: 'Mod', search: 'blue', heroCategoryId: 42,
      selectedHeroName: 'Haze', effectiveCategoryId: 42,
    })).toEqual({ search: 'blue', categoryId: 42 });
  });

  it.each(['Sound', 'Wip'])('searches %s by hero name without a ModCategory id', (section) => {
    expect(browseRemoteFilters({
      section, search: ' blue ', heroCategoryId: 42,
      selectedHeroName: 'Haze', effectiveCategoryId: 42,
    })).toEqual({ search: 'blue Haze', categoryId: undefined });
  });

  it('keeps a Sound category with the No hero filter', () => {
    expect(browseRemoteFilters({
      section: 'Sound', search: '', heroCategoryId: 'none',
      selectedHeroName: undefined, effectiveCategoryId: 7,
    })).toEqual({ search: undefined, categoryId: 7 });
  });
});
