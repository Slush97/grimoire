import type { BrowseUiState } from '../stores/appStore';
import type { NsfwContentMode } from '../types/mod';

export type BrowseContentMode = NsfwContentMode | 'only';

export function browseNsfwFilter(mode: NsfwContentMode, onlyNsfw: boolean) {
  return onlyNsfw ? 'nsfw' : mode === 'hide' ? 'sfw' : 'all';
}

export function browseRemoteFilters({
  section, search, heroCategoryId, selectedHeroName, effectiveCategoryId,
}: Pick<BrowseUiState, 'section' | 'search' | 'heroCategoryId'> & {
  selectedHeroName: string | undefined;
  effectiveCategoryId: number | undefined;
}): { search: string | undefined; categoryId: number | undefined } {
  // Hero ids come from ModCategory. Sounds and WiPs must search by name
  // instead of sending that id to their unrelated category trees.
  if (section !== 'Mod' && typeof heroCategoryId === 'number') {
    return {
      search: [search.trim(), selectedHeroName].filter(Boolean).join(' ') || undefined,
      categoryId: undefined,
    };
  }
  return { search: search || undefined, categoryId: effectiveCategoryId };
}
