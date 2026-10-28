import { describe, expect, it } from 'vitest';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { Mod } from '../types/mod';
import { getInstalledCardTaxonomy } from './installedCardTaxonomy';
import { buildHeroByCategoryId, buildHeroList, getEffectiveGlobalType, groupModsByCategory, isLockerManagedMod } from './lockerUtils';
import { entryHeroNames, entryTagKeys } from './modEntries';

const single = (over: Partial<Mod>) => ({
  kind: 'single' as const,
  key: 'a',
  mod: { id: 'a', name: 'Viscous Redesign', fileName: 'a.vpk', sourceSection: 'Mod', ...over } as Mod,
});

describe('entryHeroNames', () => {
  it('finds the hero of a skin filed in a hero subcategory', () => {
    const entry = single({ categoryId: 50570, categoryName: 'Faithful/Vanilla+' });
    expect(entryHeroNames(entry)).toEqual([]);
    expect(entryHeroNames(entry, new Map([[50570, 'Viscous']]))).toEqual(['Viscous']);
  });

  it('keeps a manual hero tag ahead of the category tree', () => {
    const entry = single({ categoryId: 50570, categoryName: 'Faithful/Vanilla+', lockerHero: 'Haze' });
    expect(entryHeroNames(entry, new Map([[50570, 'Viscous']]))).toEqual(['Haze']);
  });
});

describe('Installed hero resolution agrees with the Locker grouping', () => {
  const node = (id: number, name: string, children?: GameBananaCategoryNode[]): GameBananaCategoryNode =>
    ({ id, name, itemCount: 0, children });
  const tree = [
    node(31713, 'HUD'),
    node(33154, 'Model Replacement', [node(44206, 'Hideout')]),
    node(46154, 'Quality of Life/Fixes'),
    node(33295, 'Skins', [
      node(33306, 'Abrams'),
      node(42673, 'Apollo'),
      node(41313, 'Mina'),
      node(42675, 'Rem'),
      node(33324, 'Vindicta'),
      node(33325, 'Viscous', [node(50570, 'Faithful/Vanilla+')]),
    ]),
  ];
  const heroes = buildHeroList(tree);
  const heroByCategoryId = buildHeroByCategoryId(tree);

  const skin = (name: string, over: Partial<Mod>): Mod => ({
    id: name, name, fileName: 'skin_dir.vpk', path: '/addons/skin_dir.vpk', metaKey: 'skin_dir.vpk',
    enabled: true, priority: 1, size: 0, installedAt: '2026-01-01T00:00:00Z', sourceSection: 'Mod', ...over,
  });

  const lockerHero = (mod: Mod): string | undefined => {
    if (!isLockerManagedMod(mod) || getEffectiveGlobalType(mod)) return undefined;
    const [heroId] = [...groupModsByCategory([mod], heroes).map.keys()];
    return heroes.find((hero) => hero.id === heroId)?.name;
  };

  it.each<[string, Mod, string | undefined]>([
    ['root Skins, hero in title', skin('Breezy Butterfly Mina (UPDATED 9/30/2026)', { categoryId: 33295, categoryName: 'Skins' }), 'Mina'],
    ['Model Replacement root, hero in title', skin('goth vindicta by ju', { categoryId: 33154, categoryName: 'Model Replacement' }), 'Vindicta'],
    ['root Skins, manual tag', skin('Gabriel (ULTRAKILL)', { categoryId: 33295, categoryName: 'Skins', lockerHero: 'Apollo' }), 'Apollo'],
    ['hero category', skin('Some outfit', { categoryId: 41313, categoryName: 'Mina' }), 'Mina'],
    ['hero subcategory', skin('Plain', { categoryId: 50570, categoryName: 'Faithful/Vanilla+' }), 'Viscous'],
    ['hero id under the Skins root name', skin('Bunnydicta Outfits', { categoryId: 33324, categoryName: 'Skins' }), 'Vindicta'],
    ['manual tag over the category', skin('Plain', { categoryId: 50570, categoryName: 'Faithful/Vanilla+', lockerHero: 'Abrams' }), 'Abrams'],
    ['unknown category, hero in title', skin('Viscous Redesign', { categoryId: 99999, categoryName: 'New Hero Thing' }), 'Viscous'],
    ['unknown category, no hero', skin('Midnight Skin', { categoryId: 99999, categoryName: 'New Hero Thing' }), undefined],
    ['hero name inside a longer word', skin('Remastered Night Sky', { categoryId: 46154, categoryName: 'Quality of Life/Fixes' }), undefined],
    ['underscored file-style title', skin('goth_vindicta_by_ju', { categoryId: 33154, categoryName: 'Model Replacement' }), 'Vindicta'],
    ['hero-less category, hero in title', skin('Apollo cooldown timer', { categoryId: 46154, categoryName: 'Quality of Life/Fixes' }), undefined],
    ['other root, hero in title', skin('Apollo hideout poster', { categoryId: 31713, categoryName: 'HUD' }), 'Apollo'],
    ['global mod, hero in title', skin('Abrams Hideout', { categoryId: 33154, categoryName: 'Model Replacement', globalType: 'hideout' }), undefined],
  ])('%s', (_label, mod, hero) => {
    expect(lockerHero(mod)).toBe(hero);
    expect(entryHeroNames({ kind: 'single', key: mod.id, mod }, heroByCategoryId)).toEqual(hero ? [hero] : []);
    expect(getInstalledCardTaxonomy(mod, heroByCategoryId).heroName).toBe(hero);
  });

  it.each<[string, Partial<Mod>, string[]]>([
    ['hero category', { categoryId: 41313, categoryName: 'Mina' }, ['cat:Skins']],
    ['hero subcategory', { name: 'Plain', categoryId: 50570, categoryName: 'Faithful/Vanilla+' }, ['cat:Skins']],
    ['root Skins, manual tag', { categoryId: 33324, categoryName: 'Skins', lockerHero: 'Vindicta' }, ['cat:Skins']],
    ['Model Replacement root, hero in title', { name: 'goth vindicta by ju', categoryId: 33154, categoryName: 'Model Replacement' }, ['cat:Skins']],
    ['local import with a manual tag', { sourceSection: undefined, lockerHero: 'Violet' }, ['cat:Skins']],
    ['root Skins, no hero', { name: 'Midnight Skin', categoryId: 33295, categoryName: 'Skins' }, ['cat:Skins']],
    ['other root, hero in title', { name: 'Apollo cooldown timer', categoryId: 46154, categoryName: 'Quality of Life/Fixes' }, ['cat:Quality of Life/Fixes']],
    ['global type over its category', { categoryId: 41868, categoryName: 'Soul Container', globalType: 'soul-container' }, ['global:soul-container']],
    ['global type over a broader category', { categoryId: 46154, categoryName: 'Quality of Life/Fixes', globalType: 'hud' }, ['global:hud']],
    ['a category named Other', { sourceSection: undefined, categoryName: 'Other' }, ['other']],
    ['hero sound', { sourceSection: 'Sound', categoryId: 6270, categoryName: 'Abilities', lockerHero: 'Abrams' }, ['section:sound', 'cat:Abilities']],
    ['no metadata', { name: 'Kitty Paw Cursor', sourceSection: undefined }, ['other']],
  ])('tags %s', (_label, over, tags) => {
    const mod = skin('Some outfit', over);
    expect(entryTagKeys({ kind: 'single', key: mod.id, mod }, heroByCategoryId)).toEqual(tags);
  });
});
