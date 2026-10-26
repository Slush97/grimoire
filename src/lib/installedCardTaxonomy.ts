import type { GlobalModType, Mod } from '../types/mod';
import { categoryModelForSection, normalizeCategoryLabel, resolveCategoryPath, type CategoryPaths } from './categoryPaths';
import { heroNameForLabel } from './heroNames';
import { GLOBAL_MOD_TYPE_LABELS, canonicalHeroName, skinCategoryHero } from './lockerUtils';

export type InstalledCardTaxonomyInput = Pick<
  Mod,
  'categoryId' | 'categoryName' | 'globalType' | 'lockerHero' | 'sourceSection'
> & Partial<Pick<Mod, 'gameBananaId' | 'lockerHeroes' | 'lockerHeroSource'>>;

export interface InstalledTaxonomyContext {
  heroByCategoryId?: ReadonlyMap<number, string>;
  heroNames?: readonly string[];
  pathsByModel?: Readonly<Record<string, CategoryPaths | undefined>>;
}

export interface InstalledCardTaxonomy {
  heroNames: string[];
  /** All non-hero category ancestors and the assigned leaf, in path order. */
  categoryLabels: string[];
  /** The representative file's deepest non-hero category. */
  categoryLabel?: string;
  globalType?: GlobalModType;
}

function uniqueLabels(labels: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const raw of labels) {
    const label = normalizeCategoryLabel(raw);
    if (label && !unique.has(label.toLowerCase())) unique.set(label.toLowerCase(), label);
  }
  return [...unique.values()];
}

/** Category tags retain GameBanana's labels; General routing stays separate. */
export function getInstalledCardTaxonomy(
  mod: InstalledCardTaxonomyInput,
  context: InstalledTaxonomyContext = {},
): InstalledCardTaxonomy {
  const section = mod.sourceSection ?? 'Mod';
  const paths = context.pathsByModel?.[categoryModelForSection(section)];
  const path = resolveCategoryPath(paths, { id: mod.categoryId, name: mod.categoryName ?? '' });
  const labels = path.map(category => category.name);
  const categoryHeroes = labels.map(label => heroNameForLabel(label, context.heroNames)).filter((name): name is string => !!name);
  const linked = typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0;
  const explicitHero = mod.lockerHero && (mod.lockerHeroSource === 'manual'
    || (!linked && section !== 'Sound' && section !== 'Wip'))
    ? canonicalHeroName(mod.lockerHero.trim())
    : undefined;
  const mappedHero = section === 'Mod' ? skinCategoryHero(
    { sourceSection: section, categoryId: mod.categoryId }, context.heroByCategoryId,
  ) : undefined;
  // Main has already applied manual choices and General precedence. An empty
  // resolved set is authoritative too; raw legacy metadata must not revive it.
  const heroNames = uniqueLabels(mod.lockerHeroes
    ?? (mod.globalType ? [] : explicitHero ? [explicitHero] : section === 'Mod' ? (mappedHero ? [mappedHero] : categoryHeroes) : []));
  const categoryLabels = uniqueLabels(labels.filter(label => !heroNameForLabel(label, context.heroNames)
    && !heroNames.some(hero => hero.toLowerCase() === canonicalHeroName(label).toLowerCase())));
  // Locally generated/imported files keep their explicit General label when
  // there is no category to display. Linked files only expose real categories.
  if (!linked && labels.length === 0 && mod.globalType) categoryLabels.push(GLOBAL_MOD_TYPE_LABELS[mod.globalType]);
  return {
    heroNames,
    categoryLabels,
    categoryLabel: categoryLabels.at(-1),
    globalType: mod.globalType,
  };
}

/** Shared by card overflow and filter facets so they expose the same tags. */
export function installedTaxonomyTags(taxonomy: InstalledCardTaxonomy, section?: string): string[] {
  return uniqueLabels([
    ...taxonomy.categoryLabels,
    ...(section === 'Sound' ? ['Sounds'] : section === 'Wip' ? ['Wip'] : []),
  ]);
}

export function getInstalledGroupTaxonomy(
  representative: InstalledCardTaxonomyInput,
  variants: readonly InstalledCardTaxonomyInput[],
  context: InstalledTaxonomyContext = {},
): InstalledCardTaxonomy & { tags: string[]; previewHeroName?: string } {
  const primary = getInstalledCardTaxonomy(representative, context);
  const taxonomies = variants.map(mod => ({ mod, taxonomy: mod === representative ? primary : getInstalledCardTaxonomy(mod, context) }));
  const heroNames = uniqueLabels(taxonomies.flatMap(({ taxonomy }) => taxonomy.heroNames));
  return {
    ...primary,
    previewHeroName: heroNames.length === 1 ? primary.heroNames[0] : undefined,
    heroNames,
    categoryLabels: uniqueLabels(taxonomies.flatMap(({ taxonomy }) => taxonomy.categoryLabels)),
    tags: uniqueLabels(taxonomies.flatMap(({ mod, taxonomy }) => installedTaxonomyTags(taxonomy, mod.sourceSection))),
  };
}
