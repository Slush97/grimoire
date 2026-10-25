import type { GameBananaCategory, GameBananaCategoryNode } from '../types/gamebanana';
import { categoryIdFromProfileUrl } from './heroFilter';

export type CategoryPaths = ReadonlyMap<number, readonly GameBananaCategory[]>;

export function categoryModelForSection(section?: string): string {
  if (section === 'Sound') return 'SoundCategory';
  if (section === 'Wip') return 'WipCategory';
  return 'ModCategory';
}

/** Category IDs are scoped to their section's tree. Keep its full ancestor path
 *  so repeated labels under different heroes never need a global name match. */
export function buildCategoryPaths(tree: readonly GameBananaCategoryNode[]): CategoryPaths {
  const paths = new Map<number, readonly GameBananaCategory[]>();
  const visit = (nodes: readonly GameBananaCategoryNode[], ancestors: readonly GameBananaCategory[]) => {
    for (const node of nodes) {
      const category: GameBananaCategory = {
        id: node.id,
        name: node.name,
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
  const candidates = leafPath ?? [...(knownPath(root) ?? (root ? [root] : [])), ...(leaf ? [leaf] : [])];
  const result: GameBananaCategory[] = [];
  const ids = new Set<number>();
  const labels = new Set<string>();
  for (const category of candidates) {
    const label = category.name.trim().toLowerCase();
    const id = categoryId(category);
    if (!label || (id !== undefined && ids.has(id)) || labels.has(label)) continue;
    result.push(category);
    if (id !== undefined) ids.add(id);
    labels.add(label);
  }
  return result;
}
