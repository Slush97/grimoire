import { describe, expect, it } from 'vitest';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import { buildCategoryPaths, categoryGeneralType, categoryHeroName, categoryModelForSection, normalizeCategoryLabel, resolveCategoryPath, resolveInstalledGeneralType } from './categoryPaths';

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
  it('keeps Mod hero ancestry dynamic without interpreting deeper categories as heroes', () => {
    expect(categoryHeroName([{ name: 'Skins' }, { name: 'Future Hero' }, { name: 'Ports' }])).toBe('Future Hero');
    expect(categoryHeroName([{ name: 'HUD' }, { name: 'Character HUD' }])).toBeUndefined();
    expect(categoryHeroName([{ name: 'Skins' }])).toBeUndefined();
  });
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

  it.each(['Skins > Ivy > Faithful/Vanilla+', 'Skins / Ivy / Faithful/Vanilla+'])(
    'reconstructs unresolved breadcrumb %s while keeping the real leaf identity', (name) => {
      expect(resolveCategoryPath(undefined, { id: 99, name, iconUrl: 'leaf.png' })).toEqual([
        { name: 'Skins' }, { name: 'Ivy' }, { id: 99, name: 'Faithful/Vanilla+', iconUrl: 'leaf.png' },
      ]);
    });

  it('does not split an indexed category label or an unspaced category slash', () => {
    const known = buildCategoryPaths([node(99, 'Mode > Variant')]);
    expect(labels(resolveCategoryPath(known, { id: 99, name: 'Old name' }))).toEqual(['Mode > Variant']);
    expect(labels(resolveCategoryPath(undefined, { name: 'Other/Misc' }))).toEqual(['Other/Misc']);
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

  it('corrects the upstream Faithul typo in cached paths and offline labels without changing IDs', () => {
    const misspelled = node(6, 'Faithul/Vanilla+');
    const corrected = resolveCategoryPath(buildCategoryPaths([misspelled]), misspelled);
    expect(corrected).toEqual([{ id: 6, name: 'Faithful/Vanilla+', profileUrl: misspelled.profileUrl, iconUrl: undefined }]);
    expect(labels(resolveCategoryPath(undefined, { id: 6, name: 'Faithul/Vanilla+' })))
      .toEqual(['Faithful/Vanilla+']);
    expect(misspelled.name).toBe('Faithul/Vanilla+');
    expect(normalizeCategoryLabel('  Soul   Container  ')).toBe('Soul Container');
    expect(normalizeCategoryLabel('Faithful/Vanilla+')).toBe('Faithful/Vanilla+');
  });
});

describe('category-based General classification', () => {
  const generalPaths = buildCategoryPaths([
    node(10, 'HUD', [node(11, 'Character HUD')]),
    node(20, 'Model Replacement', [node(21, 'Soul Container'), node(22, 'Spirit Urn'), node(23, 'Hideout')]),
  ]);

  it('resolves a General ancestor from an unresolved offline breadcrumb', () => {
    expect(resolveInstalledGeneralType({ gameBananaId: 7, categoryName: 'HUD > Character HUD' })).toBe('hud');
  });

  it('uses actual leaf and ancestor categories rather than generating classification tags', () => {
    expect(categoryGeneralType(generalPaths.get(11)!)).toBe('hud');
    expect(categoryGeneralType(generalPaths.get(21)!)).toBe('soul-container');
    expect(categoryGeneralType(generalPaths.get(22)!)).toBe('spirit-urn');
    expect(categoryGeneralType(generalPaths.get(23)!)).toBe('hideout');
    expect(categoryGeneralType([{ name: 'Killstreak Music' }])).toBe('killstreak-music');
    expect(categoryGeneralType([{ name: 'Other/Misc' }])).toBeUndefined();
    expect(categoryGeneralType([{ name: 'Character HUD' }])).toBeUndefined();
  });

  it('ignores linked legacy classifications and preserves local or explicit manual choices', () => {
    const linked = { gameBananaId: 123, globalType: 'effects' as const, categoryId: 11, categoryName: 'Character HUD' };
    expect(resolveInstalledGeneralType(linked, generalPaths)).toBe('hud');
    expect(resolveInstalledGeneralType({ ...linked, globalTypeSource: 'manual' }, generalPaths)).toBe('effects');
    expect(resolveInstalledGeneralType({ ...linked, globalType: null, globalTypeSource: 'manual' }, generalPaths)).toBeUndefined();
    expect(resolveInstalledGeneralType({ globalType: 'effects' })).toBe('effects');
    expect(resolveInstalledGeneralType({ gameBananaId: 0, globalType: 'hud' })).toBe('hud');
  });

  it('respects manual or detected hero ownership before deriving automatic General buckets', () => {
    const linked = { gameBananaId: 123, categoryId: 11, categoryName: 'Character HUD' };
    expect(resolveInstalledGeneralType({ ...linked, lockerHero: 'Baba', lockerHeroSource: 'manual' }, generalPaths)).toBeUndefined();
    expect(resolveInstalledGeneralType({ globalType: 'hud', lockerHero: 'Baba', lockerHeroSource: 'manual' })).toBeUndefined();
    expect(resolveInstalledGeneralType(linked, generalPaths, ['Baba', 'Vindicta'])).toBeUndefined();
    expect(resolveInstalledGeneralType({ ...linked, globalType: 'hud', globalTypeSource: 'manual' }, generalPaths, ['Baba'])).toBe('hud');
  });

  it('retains honest leaf-only classification offline without guessing an ancestor', () => {
    expect(resolveInstalledGeneralType({ gameBananaId: 1, categoryName: 'Spirit Urn' })).toBe('spirit-urn');
    expect(resolveInstalledGeneralType({ gameBananaId: 1, categoryName: 'Character HUD' })).toBeUndefined();
  });
});
