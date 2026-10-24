import { describe, it, expect } from 'vitest';
import type { Mod } from '../types/mod';
import { countLockerSkins, groupLockerSkins, groupModsByCategory, modLoadOrder, activeLockerSkin, buildHeroList, heroListMissesRoster, HERO_NAMES_SORTED, inferHeroFromTitle } from './lockerUtils';
import type { GameBananaCategoryNode } from '../types/gamebanana';

const skinCategories: GameBananaCategoryNode[] = [{
  id: 33295, name: 'Skins', itemCount: 0,
  children: [
    {
      id: 33325, name: 'Viscous', itemCount: 0,
      children: [
        { id: 50570, name: 'Faithful/Vanilla+', itemCount: 0 },
        { id: 50571, name: 'Ports', itemCount: 0, children: [
          { id: 60000, name: 'Nested port category', itemCount: 0 },
        ] },
      ],
    },
    { id: 33301, name: 'Haze', itemCount: 0 },
  ],
}];

function mod(over: Partial<Mod> & { id: string; metaKey: string; priority: number }): Mod {
  return {
    name: over.id,
    fileName: `pak${String(over.priority).padStart(2, '0')}_dir.vpk`,
    path: `/addons/${over.id}.vpk`,
    enabled: true,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/**
 * Load order decides which mod wins when two cover the same file, so it drives
 * the Locker's "active skin", the Conflicts page's winner column, and the
 * per-hero reorder strip. The citadel/grimoire priority root is the first Game
 * line in the canonical SearchPaths block, so it must outrank every addons
 * folder; this used to be mirrored by hand on the Conflicts page and went stale.
 */
describe('modLoadOrder', () => {
  it('ranks the priority root ahead of base addons', () => {
    const global = mod({ id: 'g', metaKey: 'grimoire/pak99_dir.vpk', priority: 99 });
    const base = mod({ id: 'b', metaKey: 'pak01_dir.vpk', priority: 1 });
    // Even the LAST priority slot beats the FIRST base slot: the folder wins,
    // not the number.
    expect(modLoadOrder(global)).toBeLessThan(modLoadOrder(base));
  });

  it('orders within the priority root by pakNN', () => {
    const first = mod({ id: 'a', metaKey: 'grimoire/pak05_dir.vpk', priority: 5 });
    const second = mod({ id: 'b', metaKey: 'grimoire/pak06_dir.vpk', priority: 6 });
    expect(modLoadOrder(first)).toBeLessThan(modLoadOrder(second));
  });

  it('keeps base addons ahead of overflow folders', () => {
    const base = mod({ id: 'b', metaKey: 'pak99_dir.vpk', priority: 99 });
    const overflow = mod({ id: 'o', metaKey: 'addons1/pak01_dir.vpk', priority: 1 });
    expect(modLoadOrder(base)).toBeLessThan(modLoadOrder(overflow));
  });
});

describe('activeLockerSkin', () => {
  // The Locker's hero card art follows the active skin. A Global mod sorts
  // first by construction, so it would hijack every hero card it is grouped
  // under if callers did not filter it out (the shuffle planner does).
  it('returns the lowest load order among enabled mods', () => {
    const mods = [
      mod({ id: 'late', metaKey: 'pak09_dir.vpk', priority: 9 }),
      mod({ id: 'early', metaKey: 'pak02_dir.vpk', priority: 2 }),
      mod({ id: 'off', metaKey: 'pak01_dir.vpk', priority: 1, enabled: false }),
    ];
    expect(activeLockerSkin(mods)?.id).toBe('early');
  });

  it('is undefined when nothing is enabled', () => {
    expect(activeLockerSkin([mod({ id: 'x', metaKey: 'pak01_dir.vpk', priority: 1, enabled: false })])).toBeUndefined();
  });
});

describe('buildHeroList', () => {
  it('canonicalizes GameBanana category names to roster names', () => {
    const skins = {
      id: 33295,
      name: 'Skins',
      itemCount: 0,
      children: [
        { id: 49629, name: 'RatKing', itemCount: 0 },
        { id: 40060, name: 'Doorman', itemCount: 0 },
      ],
    };
    expect(buildHeroList([skins]).map((hero) => hero.name)).toEqual(['Rat King', 'Doorman']);
  });

  it('flags a cached tree that predates a roster hero', () => {
    const full = HERO_NAMES_SORTED.map((name, i) => ({ id: i, name }));
    expect(heroListMissesRoster(full)).toBe(false);
    expect(heroListMissesRoster(full.filter((hero) => hero.name !== 'Violet'))).toBe(true);
    expect(heroListMissesRoster([])).toBe(false);
  });
});

describe('groupModsByCategory', () => {
  const heroes = buildHeroList(skinCategories);

  it.each([33325, 50570, 50571, 60000])('files skin category %i under its hero', (categoryId) => {
    const skin = mod({ id: 'skin', metaKey: 'pak01_dir.vpk', priority: 1,
      name: 'A remodel without a hero in its title', categoryId });
    const grouped = groupModsByCategory([skin], heroes);
    expect([...grouped.map.entries()]).toEqual([[33325, [skin]]]);
    expect(grouped.unassigned).toEqual([]);
  });

  it('keeps a manual hero assignment ahead of category ancestry', () => {
    const skin = mod({ id: 'skin', metaKey: 'pak01_dir.vpk', priority: 1,
      categoryId: 50570, lockerHero: 'Haze' });
    expect([...groupModsByCategory([skin], heroes).map.entries()]).toEqual([[33301, [skin]]]);
  });

  it('uses the title when a cached tree does not know the new category', () => {
    const skin = mod({ id: 'skin', metaKey: 'pak01_dir.vpk', priority: 1,
      name: 'Viscous Redesign', categoryId: 99999, categoryName: 'Faithful/Vanilla+' });
    expect([...groupModsByCategory([skin], heroes).map.entries()]).toEqual([[33325, [skin]]]);
  });

  it('keeps an unknown category visible in Unassigned when no hero matches', () => {
    const skin = mod({ id: 'skin', metaKey: 'pak01_dir.vpk', priority: 1,
      name: 'Unknown remodel', categoryId: 99999 });
    const grouped = groupModsByCategory([skin], heroes);
    expect(grouped.map.size).toBe(0);
    expect(grouped.unassigned).toEqual([skin]);
  });
});

describe('inferHeroFromTitle', () => {
  it('does not let colour words or partial names steal a title from the hero it names', () => {
    expect(inferHeroFromTitle('Patches of Violet on Billy Blasted (Ability 3)')).toBe('Billy');
    expect(inferHeroFromTitle('Violet Haze')).toBe('Haze');
    expect(inferHeroFromTitle('Warden as Makina from Deadman Wonderland')).toBe('Warden');
    expect(inferHeroFromTitle('Harrow Grey Talon')).toBe('Grey Talon');
  });

  it('still matches the new heroes by name', () => {
    expect(inferHeroFromTitle('Violet Painter Outfit')).toBe('Violet');
    expect(inferHeroFromTitle('Deadman Danny Crash Test')).toBe('Deadman Danny');
    expect(inferHeroFromTitle('Nurse Harrow VO')).toBe('Nurse Harrow');
    expect(inferHeroFromTitle('RatKing recolor')).toBe('Rat King');
  });
});


describe('countLockerSkins', () => {
  it('counts submission, local archive and standalone groups without merging namespaces', () => {
    const mods = [
      mod({ id: 'gb-a', metaKey: 'a', priority: 9, gameBananaId: 42 }),
      mod({ id: 'gb-b', metaKey: 'b', priority: 1, gameBananaId: 42, enabled: false }),
      mod({ id: 'local-a', metaKey: 'c', priority: 3, localGroupId: '42' }),
      mod({ id: 'local-b', metaKey: 'd', priority: 2, localGroupId: '42', gameBananaId: 42 }),
      mod({ id: '42', metaKey: 'e', priority: 4, gameBananaId: 0 }),
      mod({ id: 'standalone', metaKey: 'f', priority: 5, enabled: false }),
    ];
    const original = [...mods];
    expect(countLockerSkins(mods)).toBe(4);
    expect(countLockerSkins(mods)).toBe(groupLockerSkins(mods).length);
    expect(mods).toEqual(original);
    expect(countLockerSkins([])).toBe(0);
  });
});
