import type { GameBananaCategory, GameBananaCategoryNode } from '../types/gamebanana';
import type { GlobalModType, LockerHeroSource } from '../types/mod';
import { categoryIdFromProfileUrl } from './heroFilter';

export type CategoryPaths = ReadonlyMap<number, readonly GameBananaCategory[]>;

/** Correct the known upstream typo without changing category identities. */
export function normalizeCategoryLabel(label: string): string {
  const cleaned = label.replace(/\s+/g, ' ').trim();
  return /^faithul\/vanilla\+$/i.test(cleaned) ? 'Faithful/Vanilla+' : cleaned;
}

export function categoryModelForSection(section?: string): string {
  if (section === 'Sound') return 'SoundCategory';
  if (section === 'Wip') return 'WipCategory';
  return 'ModCategory';
}

/** Mod's Skins children name heroes, including additions newer than the app. */
export function categoryHeroName(path: readonly GameBananaCategory[]): string | undefined {
  const skins = path.findIndex(category => category.name.trim().toLowerCase() === 'skins');
  return skins < 0 ? undefined : path[skins + 1]?.name;
}

/** Category IDs are scoped to their section's tree. Keep its full ancestor path
 *  so repeated labels under different heroes never need a global name match. */
export function buildCategoryPaths(tree: readonly GameBananaCategoryNode[]): CategoryPaths {
  const paths = new Map<number, readonly GameBananaCategory[]>();
  const visit = (nodes: readonly GameBananaCategoryNode[], ancestors: readonly GameBananaCategory[]) => {
    for (const node of nodes) {
      const category: GameBananaCategory = {
        id: node.id,
        name: normalizeCategoryLabel(node.name),
        profileUrl: node.profileUrl,
        iconUrl: node.iconUrl,
      };
      const path = [...ancestors, category];
      paths.set(node.id, path);
      visit(node.children ?? [], path);
    }
  };
  visit(tree, []);
  return paths;
}

function categoryId(category: GameBananaCategory): number | undefined {
  return category.id ?? categoryIdFromProfileUrl(category.profileUrl);
}

/** Use IDs (including the profile URL's ID) for ancestry. On an old or missing
 *  tree, retain the supplied root and leaf rather than guess a matching name. */
export function resolveCategoryPath(
  paths: CategoryPaths | undefined,
  leaf?: GameBananaCategory,
  root?: GameBananaCategory,
): readonly GameBananaCategory[] {
  const knownPath = (category: GameBananaCategory | undefined) => {
    const id = category && categoryId(category);
    return id === undefined ? undefined : paths?.get(id);
  };
  const leafPath = knownPath(leaf);
  const candidates = leafPath ?? [...(knownPath(root) ?? (root ? [root] : [])), ...(leaf ? [leaf] : [])]
    .flatMap(category => {
      if (knownPath(category)) return [category];
      const names = category.name.split(/\s*>\s*|\s+\/\s+/);
      return names.map((name, index) => index === names.length - 1 ? { ...category, name } : { name });
    });
  const result: GameBananaCategory[] = [];
  const ids = new Set<number>();
  const labels = new Set<string>();
  for (const category of candidates) {
    const name = normalizeCategoryLabel(category.name);
    const label = name.toLowerCase();
    const id = categoryId(category);
    if (!label || (id !== undefined && ids.has(id)) || labels.has(label)) continue;
    result.push(name === category.name ? category : { ...category, name });
    if (id !== undefined) ids.add(id);
    labels.add(label);
  }
  return result;
}

/** Locker's existing General destinations, resolved from category ancestry. */
export function categoryGeneralType(path: readonly GameBananaCategory[]): GlobalModType | undefined {
  for (let index = path.length - 1; index >= 0; index--) {
    switch (normalizeCategoryLabel(path[index].name).toLowerCase()) {
      case 'soul container':
      case 'soul containers': return 'soul-container';
      case 'spirit urn':
      case 'spirit urns': return 'spirit-urn';
      case 'hideout': return 'hideout';
      case 'hud': return 'hud';
      case 'killstreak music': return 'killstreak-music';
      case 'animations': return 'animations';
      case 'maps': return 'maps';
    }
  }
  return undefined;
}

interface InstalledGeneralTypeInput {
  gameBananaId?: number;
  globalType?: GlobalModType | null;
  globalTypeSource?: 'manual';
  lockerHero?: string;
  lockerHeroSource?: LockerHeroSource;
  categoryId?: number;
  categoryName?: string;
  sourceSection?: string;
}

/** Resolve runtime classification without persisting category-derived tags. */
export function resolveInstalledGeneralType(
  mod: InstalledGeneralTypeInput,
  paths?: CategoryPaths,
  resolvedHeroes: readonly string[] = [],
): GlobalModType | undefined {
  if (mod.globalTypeSource === 'manual') return mod.globalType ?? undefined;
  if (mod.lockerHeroSource === 'manual' && mod.lockerHero?.trim()) return undefined;
  const linked = typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0;
  if (!linked && mod.globalType) return mod.globalType;
  const generalType = categoryGeneralType(resolveCategoryPath(paths, {
    id: mod.categoryId,
    name: mod.categoryName ?? '',
  }));
  if ((generalType === 'animations' || generalType === 'maps') && (mod.sourceSection ?? 'Mod') !== 'Mod') return undefined;
  if (generalType === 'animations') return generalType;
  if (!linked && generalType !== 'maps') return undefined;
  return resolvedHeroes.length > 0 ? undefined : generalType;
}
