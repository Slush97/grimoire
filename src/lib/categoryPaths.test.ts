import { describe, expect, it } from 'vitest';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import { buildCategoryPaths, categoryModelForSection, resolveCategoryPath } from './categoryPaths';

const node = (id: number, name: string, children: GameBananaCategoryNode[] = []): GameBananaCategoryNode => ({
  id, name, children, itemCount: 1, profileUrl: `https://gamebanana.com/mods/cats/${id}`,
});
const tree = [node(1, 'Skins', [
  node(2, 'Abrams', [node(3, 'Faithful/Vanilla+')]),
  node(4, 'Baba', [node(5, 'Faithful/Vanilla+')]),
])];
const paths = buildCategoryPaths(tree);
const labels = (path: ReturnType<typeof resolveCategoryPath>) => path.map((category) => category.name);

describe('category ancestry', () => {
  it('indexes full paths without confusing repeated labels in separate branches', () => {
    expect(labels(resolveCategoryPath(paths, { id: 5, name: 'Faithful/Vanilla+' })))
      .toEqual(['Skins', 'Baba', 'Faithful/Vanilla+']);
    expect(labels(resolveCategoryPath(paths, { id: 3, name: 'Faithful/Vanilla+' })))
      .toEqual(['Skins', 'Abrams', 'Faithful/Vanilla+']);
    expect(paths.size).toBe(5);
  });

  it('uses a profile URL ID when the list endpoint omits the category ID', () => {
    expect(labels(resolveCategoryPath(paths, {
      name: 'Faithful/Vanilla+', profileUrl: 'https://gamebanana.com/mods/cats/5',
    }))).toEqual(['Skins', 'Baba', 'Faithful/Vanilla+']);
  });

  it('preserves an unknown leaf after the known root instead of dropping it', () => {
    expect(labels(resolveCategoryPath(paths, { id: 99, name: 'New category' }, { id: 1, name: 'Skins' })))
      .toEqual(['Skins', 'New category']);
  });

  it('keeps supplied names offline without guessing ambiguous nested matches', () => {
    expect(labels(resolveCategoryPath(paths, { name: 'Faithful/Vanilla+' }, { id: 1, name: 'Skins' })))
      .toEqual(['Skins', 'Faithful/Vanilla+']);
    expect(labels(resolveCategoryPath(undefined, { name: 'Baba' }, { name: 'Skins' })))
      .toEqual(['Skins', 'Baba']);
    expect(resolveCategoryPath(undefined)).toEqual([]);
  });

  it('avoids duplicate IDs and labels when supplied root and leaf are the same', () => {
    expect(labels(resolveCategoryPath(paths, { id: 1, name: 'Old skins label' }, { id: 1, name: 'Skins' })))
      .toEqual(['Skins']);
    expect(labels(resolveCategoryPath(undefined, { name: ' skins ' }, { name: 'Skins' })))
      .toEqual(['Skins']);
  });

  it('keeps category models scoped to the item section', () => {
    expect(categoryModelForSection('Sound')).toBe('SoundCategory');
    expect(categoryModelForSection('Wip')).toBe('WipCategory');
    expect(categoryModelForSection('Mod')).toBe('ModCategory');
    expect(categoryModelForSection()).toBe('ModCategory');
  });
});
