import type { GlobalModType, Mod } from '../types/mod';
import {
  HERO_NAMES,
  canonicalHeroName,
  getEffectiveGlobalType,
  skinCategoryHero,
  skinTitleHero,
} from './lockerUtils';

export type InstalledCardTaxonomyInput = Pick<
  Mod,
  | 'categoryId'
  | 'categoryName'
  | 'fileName'
  | 'globalType'
  | 'lockerCosmetics'
  | 'lockerHero'
  | 'lockerSounds'
  | 'name'
  | 'sourceSection'
>;

export interface InstalledCardTaxonomy {
  /** Canonical hero identity shown by the card, regardless of metadata source. */
  heroName?: string;
  /** Locker-wide classification. Supersedes the GameBanana category label. */
  globalType?: GlobalModType;
  /** Non-hero GameBanana category shown when no global classification exists. */
  categoryLabel?: string;
}

/** GameBanana roots a skin can be filed under directly. Beside a hero they add
 *  nothing: the skin is that hero's, however the author filed it. */
const SKIN_ROOT_CATEGORIES: ReadonlySet<string> = new Set(['skins', 'model replacement']);

export function isSkinRootCategory(categoryName?: string): boolean {
  return SKIN_ROOT_CATEGORIES.has(categoryName?.trim().toLowerCase() ?? '');
}

function heroFromCategory(categoryName?: string): string | undefined {
  const needle = canonicalHeroName(categoryName?.trim()).toLowerCase();
  if (!needle) return undefined;
  const rosterName = HERO_NAMES.find((name) => name.toLowerCase() === needle);
  return rosterName ? canonicalHeroName(rosterName) : undefined;
}

/**
 * Resolve the single taxonomy model shared by Installed's grid, compact, and
 * list cards. Display size must only affect presentation, never which metadata
 * survives. The persisted Locker global classification wins over a GameBanana
 * category; otherwise a hero category becomes the hero identity, and a
 * non-hero category remains a text label. A skin filed under a category that
 * names no hero gets one from its title, as the Locker does, and drops the
 * root's label so every hero skin reads the same.
 */
export function getInstalledCardTaxonomy(
  mod: InstalledCardTaxonomyInput,
  heroByCategoryId?: ReadonlyMap<number, string>,
): InstalledCardTaxonomy {
  const globalType = getEffectiveGlobalType(mod);
  const explicitHero = canonicalHeroName(mod.lockerHero) || undefined;
  const categoryHero = globalType ? undefined : heroFromCategory(mod.categoryName);
  // A hero subcategory (Faithful/Vanilla+) gets the hero and keeps its label.
  const subcategoryHero = globalType ? undefined : skinCategoryHero(mod, heroByCategoryId);
  const heroName = explicitHero ?? categoryHero ?? subcategoryHero ?? skinTitleHero(mod, heroByCategoryId);
  const categoryLabel = !globalType && !categoryHero && !(heroName && isSkinRootCategory(mod.categoryName))
    ? mod.categoryName?.trim() || undefined
    : undefined;

  return {
    heroName,
    globalType,
    categoryLabel,
  };
}
