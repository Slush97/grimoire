import type { GlobalModType, Mod } from '../types/mod';
import { generalPropModel, baseTagGlobalType, categoryModelForSection, normalizeCategoryLabel, resolveCategoryPath, type CategoryPaths } from './categoryPaths';
import { heroNameForLabel } from './heroNames';
import { GLOBAL_MOD_TYPE_LABELS, canonicalHeroName, skinCategoryHero } from './lockerUtils';

export type InstalledCardTaxonomyInput = Pick<
  Mod,
  'categoryId' | 'categoryName' | 'globalType' | 'lockerHero' | 'sourceSection'
> & Partial<Pick<Mod, 'gameBananaId' | 'lockerHeroes' | 'lockerHeroSource' | 'tagOverrides' | 'detectedTags' | 'propTypes'>>;

export interface InstalledTaxonomyContext {
  heroByCategoryId?: ReadonlyMap<number, string>;
  heroNames?: readonly string[];
  pathsByModel?: Readonly<Record<string, CategoryPaths | undefined>>;
}

export interface InstalledCardTaxonomy {
  heroNames: string[];
  /** All non-hero category ancestors and the assigned leaf, in path order. */
  categoryLabels: string[];
  /** Preserved local General labels, separate from GameBanana ancestry. */
  customLabels?: string[];
  /** The representative file's deepest non-hero category. */
  categoryLabel?: string;
  globalType?: GlobalModType;
  baseOverridden?: boolean;
}

/** Unranked tags keep their existing hierarchy and follow explicitly ranked tags. */
export function sortInstalledTags<T extends { key: string }>(tags: readonly T[], order: readonly string[]): T[] {
  const ranks = new Map(order.map((key, index) => [key, index]));
  return [...tags].sort((a, b) => (ranks.get(a.key) ?? order.length) - (ranks.get(b.key) ?? order.length));
}

/** Match the cards' deepest-first hierarchy without translating tag identities. */
export function defaultInstalledTagOrder(
  tags: readonly { key: string; custom?: boolean }[],
  pathsByModel: InstalledTaxonomyContext['pathsByModel'],
): string[] {
  const depths = new Map<string, number>();
  for (const paths of Object.values(pathsByModel ?? {})) {
    for (const path of paths?.values() ?? []) {
      path.forEach((category, index) => {
        const key = `tag:${normalizeCategoryLabel(category.name).toLowerCase()}`;
        depths.set(key, Math.max(depths.get(key) ?? -1, index));
      });
    }
  }
  return [...tags].sort((a, b) =>
    Number(!!b.custom) - Number(!!a.custom)
    || (depths.get(b.key) ?? -1) - (depths.get(a.key) ?? -1),
  ).map(tag => tag.key);
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
  const heroNames = uniqueLabels(mod.tagOverrides?.heroes ?? mod.lockerHeroes
    ?? (mod.globalType ? [] : explicitHero ? [explicitHero] : section === 'Mod' ? (mappedHero ? [mappedHero] : categoryHeroes) : []));
  const categoryLabels = uniqueLabels(mod.tagOverrides?.base ?? labels.filter(label => !heroNameForLabel(label, context.heroNames)
    && !heroNames.some(hero => hero.toLowerCase() === canonicalHeroName(label).toLowerCase())));
  categoryLabels.splice(0, categoryLabels.length, ...categoryLabels.filter(label => !/^cursors?$/i.test(label)));
  if (mod.tagOverrides?.base) {
    const depths = new Map(labels.map((label, index) => [label.toLowerCase(), index]));
    categoryLabels.sort((a, b) => (depths.get(a.toLowerCase()) ?? -1) - (depths.get(b.toLowerCase()) ?? -1));
  }
  // Locally generated/imported files keep their explicit General label when
  // there is no category to display. Linked files only expose real categories.
  const customLabels = mod.tagOverrides?.base === undefined && !linked && labels.length === 0 && mod.globalType && !generalPropModel(mod.globalType)
    ? [GLOBAL_MOD_TYPE_LABELS[mod.globalType]] : [];
  return {
    heroNames,
    categoryLabels,
    categoryLabel: categoryLabels.at(-1),
    ...(customLabels.length > 0 ? { customLabels } : {}),
    globalType: mod.globalType,
    ...(mod.tagOverrides?.base !== undefined ? { baseOverridden: true } : {}),
  };
}

function sectionTags(section?: string): string[] {
  return section === 'Sound' ? ['Sounds'] : section === 'Wip' ? ['Wip'] : [];
}

/** Filter facets keep the complete tag set, independently of card ordering. */
export function installedTaxonomyTags(taxonomy: InstalledCardTaxonomy, section?: string): string[] {
  return uniqueLabels([
    ...taxonomy.categoryLabels,
    ...(taxonomy.customLabels ?? []),
    ...(taxonomy.baseOverridden ? [] : sectionTags(section)),
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
  const customLabels = uniqueLabels(taxonomies.flatMap(({ taxonomy }) => taxonomy.customLabels ?? []));
  const categories = new Map<string, { label: string; depth: number }>();
  for (const taxonomy of [primary, ...taxonomies.map(({ taxonomy }) => taxonomy)]) {
    taxonomy.categoryLabels.forEach((label, depth) => {
      const key = label.toLowerCase();
      const existing = categories.get(key);
      if (existing) existing.depth = Math.max(existing.depth, depth);
      else categories.set(key, { label, depth });
    });
  }
  const primaryLeaf = primary.categoryLabel?.toLowerCase();
  const orderedCategories = [...categories.values()].sort((a, b) =>
    Number(b.label.toLowerCase() === primaryLeaf) - Number(a.label.toLowerCase() === primaryLeaf)
    || b.depth - a.depth,
  ).map(({ label }) => label);
  return {
    ...primary,
    previewHeroName: heroNames.length === 1 ? primary.heroNames[0] : undefined,
    heroNames,
    categoryLabels: uniqueLabels(taxonomies.flatMap(({ taxonomy }) => taxonomy.categoryLabels)),
    ...(customLabels.length > 0 ? { customLabels } : {}),
    tags: uniqueLabels([
      ...orderedCategories,
      ...taxonomies.flatMap(({ mod, taxonomy }) => taxonomy.baseOverridden ? [] : sectionTags(mod.sourceSection)),
      ...customLabels,
    ]),
  };
}

/** Defaults come from detection, even after a manual selection changed the live identity. */
export function getInstalledDefaultTaxonomy(
  representative: InstalledCardTaxonomyInput,
  variants: readonly InstalledCardTaxonomyInput[],
  context: InstalledTaxonomyContext = {},
): ReturnType<typeof getInstalledGroupTaxonomy> {
  const restore = (mod: InstalledCardTaxonomyInput): InstalledCardTaxonomyInput => ({
    ...mod,
    tagOverrides: undefined,
    ...(mod.detectedTags ? { lockerHeroes: mod.detectedTags.heroes, globalType: mod.detectedTags.globalType } : {}),
  });
  return getInstalledGroupTaxonomy(restore(representative), variants.map(restore), context);
}

/** Apply only the changed group selections; keep each file's other tags intact. */
export function installedTagChangesForVariants<T extends InstalledCardTaxonomyInput>(
  representative: T,
  variants: readonly T[],
  changes: Mod['tagOverrides'] | null,
  context: InstalledTaxonomyContext = {},
): { mod: T; tags: Mod['tagOverrides'] | null }[] {
  if (!changes) return variants.map(mod => ({ mod, tags: changes }));
  const group = getInstalledGroupTaxonomy(representative, variants, context);
  return variants.map(mod => {
    const taxonomy = getInstalledCardTaxonomy(mod, context);
    const tags: NonNullable<Mod['tagOverrides']> = {};
    for (const axis of ['base', 'heroes'] as const) {
      const desired = changes[axis];
      if (desired === undefined) continue;
      const previous = axis === 'base' ? group.tags : group.heroNames;
      const current = axis === 'base' ? installedTaxonomyTags(taxonomy, mod.sourceSection) : taxonomy.heroNames;
      const removed = new Set(previous.filter(tag => !desired.includes(tag)));
      tags[axis] = [...new Set([...current.filter(tag => !removed.has(tag)), ...desired.filter(tag => !previous.includes(tag))])];
    }
    return { mod, tags };
  });
}

/** Share the built-in labels used by cards and filters, including cached categories. */
export function installedBaseTagOptions(context: InstalledTaxonomyContext, current: readonly string[] = []): string[] {
  const labels = ['Skins', 'Sounds', 'Wip', ...current];
  for (const paths of Object.values(context.pathsByModel ?? {})) {
    for (const path of paths?.values() ?? []) {
      for (const category of path) {
        if (!heroNameForLabel(category.name, context.heroNames)) labels.push(category.name);
      }
    }
  }
  const destinations = new Set(labels.map(baseTagGlobalType));
  for (const [type, label] of Object.entries(GLOBAL_MOD_TYPE_LABELS)) {
    // GameBanana keeps one Patrons tag; the two model slots are Locker destinations.
    if (type === 'hidden-king' || type === 'archmother') continue;
    if (baseTagGlobalType(label) && !destinations.has(type as GlobalModType)) labels.push(label);
  }
  return uniqueLabels(labels).filter(label => !/^cursors?$/i.test(label)).sort((a, b) => a.localeCompare(b));
}
