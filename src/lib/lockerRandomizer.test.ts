import { describe, it, expect } from 'vitest';
import type { Mod } from '../types/mod';
import { planRandomization, planLaunchShuffle, shuffleSkinKey, readStoredShuffleIncluded } from './lockerRandomizer';

/**
 * Minimal Mod factory. Only the fields the randomizer + lockerUtils grouping
 * read matter (id, enabled, priority, metaKey, gameBananaId, sha256); the rest
 * are filled with inert defaults. metaKey is a bare filename so modLoadOrder
 * folds to priority (folder index 0).
 */
function mod(over: Partial<Mod> & { id: string }): Mod {
  return {
    name: over.id,
    fileName: `${over.id}.vpk`,
    path: `/addons/${over.id}.vpk`,
    metaKey: `${over.id}.vpk`,
    enabled: false,
    priority: 1,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/** rng stub returning a fixed value (picks pool[floor(value * len)]). */
const fixedRng = (value: number) => () => value;

describe('shuffleSkinKey', () => {
  it('prefers gameBananaId, then sha256, then mod id', () => {
    expect(shuffleSkinKey(mod({ id: 'a', gameBananaId: 42, sha256: 'deadbeef' }))).toBe(
      'gamebanana:42'
    );
    expect(shuffleSkinKey(mod({ id: 'b', sha256: 'cafe' }))).toBe('sha256:cafe');
    expect(shuffleSkinKey(mod({ id: 'c' }))).toBe('mod:c');
  });

  it('ignores a zero/absent gameBananaId', () => {
    expect(shuffleSkinKey(mod({ id: 'd', gameBananaId: 0, sha256: 'x' }))).toBe('sha256:x');
  });
});

describe('planRandomization', () => {
  it('leaves a hero untouched when no skin is opted in', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 1 }), mod({ id: 'b', gameBananaId: 2 })]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(),
      rng: fixedRng(0),
    });
    expect(plan).toEqual({ enableIds: [], disableIds: [], changedHeroes: [] });
  });

  it('is a no-op when the only opted-in skin is already the lone active one', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 1 })]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual([]);
    expect(plan.disableIds).toEqual([]);
    expect(plan.changedHeroes).toEqual([]);
  });

  it('enables a disabled pick and disables the previously-active skin', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 1 }),
        mod({ id: 'b', gameBananaId: 2, enabled: false, priority: 2 }),
      ]],
    ]);
    // Both opted in; avoidCurrent removes the active skin A from the pool,
    // leaving only B.
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1', 'gamebanana:2']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual(['b']);
    expect(plan.disableIds).toEqual(['a']);
    expect(plan.changedHeroes).toEqual([1]);
  });

  it('disable-only when the chosen skin is already enabled alongside others', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 1 }),
        mod({ id: 'b', gameBananaId: 2, enabled: true, priority: 2 }),
      ]],
    ]);
    // A is active (lower load order); avoidCurrent picks B, which is already on,
    // so we only disable A.
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1', 'gamebanana:2']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual([]);
    expect(plan.disableIds).toEqual(['a']);
    expect(plan.changedHeroes).toEqual([1]);
  });

  it('only draws from opted-in skins', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a', gameBananaId: 1, enabled: false, priority: 1 }),
        mod({ id: 'b', gameBananaId: 2, enabled: false, priority: 2 }),
        mod({ id: 'c', gameBananaId: 3, enabled: false, priority: 3 }),
      ]],
    ]);
    // Only B is in the pool; it's chosen regardless of rng.
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:2']),
      rng: fixedRng(0.99),
    });
    expect(plan.enableIds).toEqual(['b']);
    expect(plan.disableIds).toEqual([]);
  });

  it('equips the lone opted-in skin even when a non-included skin is active', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 1 }),
        mod({ id: 'b', gameBananaId: 2, enabled: false, priority: 2 }),
      ]],
    ]);
    // Only B is in the pool; A is the live skin but not included. The shuffle
    // makes the picked skin the hero's single active skin, so A is swapped out
    // for B even though A was never opted in.
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:2']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual(['b']);
    expect(plan.disableIds).toEqual(['a']);
    expect(plan.changedHeroes).toEqual([1]);
  });

  it('disables a non-pooled companion mod so exactly one skin is active', () => {
    // Hero has a pooled skin A plus a separate enabled mod W the user never
    // opted in. Grimoire files both under "Skins", so the shuffle resets the
    // hero's skin slot: A is the lone pick and W is disabled, leaving one skin.
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a', gameBananaId: 1, enabled: false, priority: 1 }),
        mod({ id: 'w', gameBananaId: 2, enabled: true, priority: 2 }),
      ]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual(['a']);
    expect(plan.disableIds).toEqual(['w']);
    expect(plan.changedHeroes).toEqual([1]);
  });

  it("leaves the chosen skin's own enabled variant VPK loaded (multi-VPK skin)", () => {
    // One pooled submission ships two co-required VPKs (same gameBananaId), both
    // enabled. When it's the pick, neither of its own variants may be disabled.
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a1', gameBananaId: 1, enabled: true, priority: 1 }),
        mod({ id: 'a2', gameBananaId: 1, enabled: true, priority: 2 }),
      ]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual([]);
    expect(plan.disableIds).toEqual([]);
    expect(plan.changedHeroes).toEqual([]);
  });

  it('never re-picks the current skin across the whole rng range when >=2 eligible', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 1 }),
        mod({ id: 'b', gameBananaId: 2, enabled: false, priority: 2 }),
        mod({ id: 'c', gameBananaId: 3, enabled: false, priority: 3 }),
      ]],
    ]);
    const included = new Set(['gamebanana:1', 'gamebanana:2', 'gamebanana:3']);
    for (const value of [0, 0.34, 0.5, 0.67, 0.99]) {
      const plan = planRandomization({ heroSkins, heroIds: [1], included, rng: fixedRng(value) });
      // A (current) is always turned off and never re-enabled.
      expect(plan.disableIds).toContain('a');
      expect(plan.enableIds).not.toContain('a');
      expect(plan.enableIds).toHaveLength(1);
      expect(['b', 'c']).toContain(plan.enableIds[0]);
    }
  });

  it('can re-pick the current skin when avoidCurrent is false', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 1 }),
        mod({ id: 'b', gameBananaId: 2, enabled: false, priority: 2 }),
      ]],
    ]);
    // rng 0 -> pool[0] which is the priority-1 skin A (the active one).
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1', 'gamebanana:2']),
      rng: fixedRng(0),
      avoidCurrent: false,
    });
    expect(plan.enableIds).toEqual([]);
    expect(plan.disableIds).toEqual([]);
    expect(plan.changedHeroes).toEqual([]);
  });

  it('treats variants of one skin as a single pick and leaves one VPK active', () => {
    // gb:1 has two VPK variants; gb:2 is a separate skin currently active.
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a1', gameBananaId: 1, enabled: false, priority: 3 }),
        mod({ id: 'a2', gameBananaId: 1, enabled: false, priority: 4 }),
        mod({ id: 'b', gameBananaId: 2, enabled: true, priority: 1 }),
      ]],
    ]);
    // Both opted in; avoidCurrent drops B (active), leaving only the gb:1 skin.
    // Its primary is the lowest-priority variant a1; a2 stays off, B is disabled.
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1', 'gamebanana:2']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual(['a1']);
    expect(plan.disableIds).toEqual(['b']);
  });

  it('honors scope: only shuffles heroes in heroIds', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [mod({ id: 'a', gameBananaId: 1, enabled: false, priority: 1 })]],
      [2, [mod({ id: 'b', gameBananaId: 2, enabled: true, priority: 1 })]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1', 'gamebanana:2']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual(['a']);
    // Hero 2 was out of scope; its mod is never touched.
    expect(plan.disableIds).not.toContain('b');
    expect(plan.changedHeroes).toEqual([1]);
  });

  it('skips heroes with no installed skins', () => {
    const heroSkins = new Map<number, Mod[]>([[1, []]]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1, 999],
      included: new Set(['gamebanana:1']),
      rng: fixedRng(0),
    });
    expect(plan).toEqual({ enableIds: [], disableIds: [], changedHeroes: [] });
  });
});

describe('planLaunchShuffle', () => {
  const heroList = [{ id: 1, name: 'Vindicta' }];
  const EMPTY = { enableIds: [], disableIds: [], changedHeroes: [] };

  // A per-hero skin the Locker manages: sourceSection 'Mod' + a hero tag, so it
  // both passes isLockerManagedMod and groups under the hero via heroList.
  const skin = (over: Partial<Mod> & { id: string }) =>
    mod({ sourceSection: 'Mod', lockerHero: 'Vindicta', ...over });

  it('returns an empty plan when nothing is opted in (early return)', () => {
    const mods = [
      skin({ id: 'a', gameBananaId: 1, enabled: true }),
      skin({ id: 'b', gameBananaId: 2 }),
    ];
    expect(planLaunchShuffle({ mods, heroList, included: new Set() })).toEqual(EMPTY);
  });

  it('delegates to the randomizer for a hero with an opted-in skin', () => {
    const mods = [
      skin({ id: 'active', gameBananaId: 1, enabled: true, priority: 1 }), // enabled, NOT opted in
      skin({ id: 'pick', gameBananaId: 2, enabled: false }),               // the lone opted-in pick
    ];
    const plan = planLaunchShuffle({ mods, heroList, included: new Set(['gamebanana:2']) });
    expect(plan.changedHeroes).toEqual([1]);
    expect(plan.enableIds).toContain('pick');
    expect(plan.disableIds).toContain('active');
  });

  it('excludes Sound-section mods from the shuffle', () => {
    // A hero-tagged Sound mod is the Sounds tab's domain, never a skin.
    const mods = [
      mod({ id: 'snd', sourceSection: 'Sound', lockerHero: 'Vindicta', gameBananaId: 5, enabled: true }),
    ];
    expect(planLaunchShuffle({ mods, heroList, included: new Set(['gamebanana:5']) })).toEqual(EMPTY);
  });

  it('excludes global mods (e.g. announcer packs) from the shuffle', () => {
    const mods = [skin({ id: 'g', gameBananaId: 6, enabled: true, globalType: 'announcer' })];
    expect(planLaunchShuffle({ mods, heroList, included: new Set(['gamebanana:6']) })).toEqual(EMPTY);
  });
});

describe('readStoredShuffleIncluded', () => {
  // node test env has no localStorage; stub getItem per-case, restore after.
  const withLocalStorage = (value: string | null, fn: () => void) => {
    const g = globalThis as unknown as { localStorage?: { getItem: (k: string) => string | null } };
    const original = g.localStorage;
    g.localStorage = { getItem: () => value };
    try {
      fn();
    } finally {
      if (original === undefined) delete g.localStorage;
      else g.localStorage = original;
    }
  };

  it('returns an empty set when unset', () => {
    withLocalStorage(null, () => expect(readStoredShuffleIncluded().size).toBe(0));
  });

  it('parses a stored string array', () => {
    withLocalStorage(JSON.stringify(['gamebanana:1', 'sha256:x']), () =>
      expect(readStoredShuffleIncluded()).toEqual(new Set(['gamebanana:1', 'sha256:x']))
    );
  });

  it('ignores malformed JSON', () => {
    withLocalStorage('{not json', () => expect(readStoredShuffleIncluded().size).toBe(0));
  });

  it('ignores a non-array payload', () => {
    withLocalStorage(JSON.stringify({ a: 1 }), () => expect(readStoredShuffleIncluded().size).toBe(0));
  });

  it('filters out non-string entries', () => {
    withLocalStorage(JSON.stringify(['ok', 42, null, 'ok2']), () =>
      expect(readStoredShuffleIncluded()).toEqual(new Set(['ok', 'ok2']))
    );
  });
});
