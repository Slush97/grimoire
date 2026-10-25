import type { GlobalModType, Mod } from '../types/mod';
import { categoryModelForSection, resolveCategoryPath, type CategoryPaths } from './categoryPaths';
import { heroNameForLabel } from './heroNames';
import {
  GLOBAL_MOD_TYPE_LABELS,
  canonicalHeroName,
  getEffectiveGlobalType,
  inferHeroFromTitle,
  skinCategoryHero,
} from './lockerUtils';

export type InstalledCardTaxonomyInput = Pick<
  Mod,
  'categoryId' | 'categoryName' | 'globalType' | 'lockerHero' | 'sourceSection'
> & Partial<Pick<Mod, 'name'>>;

export interface InstalledTaxonomyContext {
  heroByCategoryId?: ReadonlyMap<number, string>;
  heroNames?: readonly string[];
  pathsByModel?: Readonly<Record<string, CategoryPaths | undefined>>;
}

export interface InstalledCardTaxonomy {
  /** Canonical hero identity shown by the card, regardless of metadata source. */
  heroName?: string;
  /** Locker-wide classification. Supersedes the GameBanana category label. */
  globalType?: GlobalModType;
  /** Distinct non-hero leaf category. Cards prefer the global label if present. */
  categoryLabel?: string;
}

const canonicalTagLabels = new Map(
  [...Object.values(GLOBAL_MOD_TYPE_LABELS), 'Sounds', 'Wip']
    .map(label => [label.toLowerCase(), label]),
);
canonicalTagLabels.set('soul container', GLOBAL_MOD_TYPE_LABELS['soul-container']);
canonicalTagLabels.set('spirit urn', GLOBAL_MOD_TYPE_LABELS['spirit-urn']);

/** Source and category tags share their visible identity, not their provenance. */
export function normalizeInstalledTagLabel(label: string): string {
  const cleaned = label.replace(/\s+/g, ' ').trim();
  return canonicalTagLabels.get(cleaned.toLowerCase()) ?? cleaned;
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
  context: InstalledTaxonomyContext = {},
): InstalledCardTaxonomy {
  const section = mod.sourceSection ?? 'Mod';
  const categoryPaths = context.pathsByModel?.[categoryModelForSection(section)];
  const path = resolveCategoryPath(
    categoryPaths,
    { id: mod.categoryId, name: mod.categoryName ?? '' },
  );
  // Older imports can supply a breadcrumb without a resolvable category ID.
  // Keep their hero filter working without inferring a different tree path.
  const breadcrumbHero = mod.categoryId === undefined || !categoryPaths?.has(mod.categoryId)
    ? mod.categoryName?.split(/[/>]/).reverse()
      .map(label => heroNameForLabel(label, context.heroNames)).find(Boolean)
    : undefined;
  const leafLabel = normalizeInstalledTagLabel(path.at(-1)?.name ?? mod.categoryName ?? '') || undefined;
  const globalType = getEffectiveGlobalType({ ...mod, categoryName: leafLabel });
  const explicitHero = heroNameForLabel(mod.lockerHero, context.heroNames)
    ?? (canonicalHeroName(mod.lockerHero?.trim()) || undefined);
  const mappedHero = skinCategoryHero(
    { sourceSection: section, categoryId: mod.categoryId }, context.heroByCategoryId,
  );
  const categoryHero = globalType ? undefined : mappedHero
    ?? path.map(category => heroNameForLabel(category.name, context.heroNames)).find(Boolean)
    ?? breadcrumbHero
    ?? undefined;
  const heroName = explicitHero ?? categoryHero
    ?? (!globalType && section === 'Sound' ? inferHeroFromTitle(mod.name ?? '') : undefined)
    ?? undefined;
  const leafIsHero = heroNameForLabel(leafLabel, context.heroNames)
    || breadcrumbHero
    || (leafLabel && [explicitHero, mappedHero].some(hero => hero?.toLowerCase() === canonicalHeroName(leafLabel).toLowerCase()));
  const leafMatchesGlobal = globalType && (
    normalizeInstalledTagLabel(GLOBAL_MOD_TYPE_LABELS[globalType]).toLowerCase() === leafLabel?.toLowerCase()
    || getEffectiveGlobalType({ ...mod, globalType: undefined, categoryName: leafLabel }) === globalType
  );
  const categoryLabel = !leafMatchesGlobal && !leafIsHero
    ? leafLabel
    : undefined;

  return {
    heroName,
    globalType,
    categoryLabel,
  };
}
