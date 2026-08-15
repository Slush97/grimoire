import type { GlobalModType, Mod } from '../types/mod';
import {
  HERO_NAMES,
  canonicalHeroName,
  getEffectiveGlobalType,
} from './lockerUtils';

export type InstalledCardTaxonomyInput = Pick<
  Mod,
  'categoryName' | 'globalType' | 'lockerHero' | 'sourceSection'
>;

export interface InstalledCardTaxonomy {
  /** Canonical hero identity shown by the card, regardless of metadata source. */
  heroName?: string;
  /** Locker-wide classification. Supersedes the GameBanana category label. */
  globalType?: GlobalModType;
  /** Non-hero GameBanana category shown when no global classification exists. */
  categoryLabel?: string;
}

function heroFromCategory(categoryName?: string): string | undefined {
  const needle = categoryName?.trim().toLowerCase();
  if (!needle) return undefined;
  const rosterName = HERO_NAMES.find((name) => name.toLowerCase() === needle);
  return rosterName ? canonicalHeroName(rosterName) : undefined;
}

/**
 * Resolve the single taxonomy model shared by Installed's grid, compact, and
 * list cards. Display size must only affect presentation, never which metadata
 * survives. The persisted Locker global classification wins over a GameBanana
 * category; otherwise a hero category becomes the hero identity, and a
 * non-hero category remains a text label.
 */
export function getInstalledCardTaxonomy(
  mod: InstalledCardTaxonomyInput,
): InstalledCardTaxonomy {
  const globalType = getEffectiveGlobalType(mod);
  const explicitHero = canonicalHeroName(mod.lockerHero) || undefined;
  const categoryHero = globalType ? undefined : heroFromCategory(mod.categoryName);
  const heroName = explicitHero ?? categoryHero;
  const categoryLabel = !globalType && !categoryHero
    ? mod.categoryName?.trim() || undefined
    : undefined;

  return {
    heroName,
    globalType,
    categoryLabel,
  };
}
