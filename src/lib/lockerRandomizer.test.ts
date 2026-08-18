import { describe, it, expect } from 'vitest';
import type { GlobalModType, Mod } from '../types/mod';
import {
  planRandomization,
  planLaunchShuffle,
  prunePoolKeysForMod,
  shuffleGroupKind,
  shufflePoolKey,
  shuffleSkinKey,
  summarizeShufflePool,
  readStoredShuffleIncluded,
  readStoredShuffleVariants,
  type VariantChoice,
} from './lockerRandomizer';

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

const sequenceRng = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
};

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

  // Callers key off skin.primary, and the primary is whichever variant is
  // enabled: the one thing the shuffle changes. A per-file sha would move the
  // key on the first re-roll and drop the skin out of its own pool.
  it('shares one key across the variants of a local group', () => {
    const red = mod({ id: 'red', localGroupId: 'uuid-1', sha256: 'aaa' });
    const blue = mod({ id: 'blue', localGroupId: 'uuid-1', sha256: 'bbb' });
    expect(shuffleSkinKey(red)).toBe('localgroup:uuid-1');
    expect(shuffleSkinKey(blue)).toBe(shuffleSkinKey(red));
  });

  it('still prefers the GameBanana id over a stray local group id', () => {
    expect(shuffleSkinKey(mod({ id: 'e', gameBananaId: 42, localGroupId: 'uuid-1' }))).toBe(
      'gamebanana:42'
    );
  });
});

describe('shufflePoolKey', () => {
  it('keeps the bare skin key on the hero axis', () => {
    expect(shufflePoolKey(mod({ id: 'a', gameBananaId: 42 }))).toBe('gamebanana:42');
    expect(shufflePoolKey(mod({ id: 'b', sha256: 'cafe' }))).toBe('sha256:cafe');
  });

  it('qualifies a classified mod by its bucket', () => {
    expect(shufflePoolKey(mod({ id: 'h', gameBananaId: 42, globalType: 'hud' }))).toBe(
      'bucket:hud:gamebanana:42'
    );
  });

  it('separates the two axes of one submission', () => {
    // The collision this key exists to prevent: a hero skin VPK and a HUD VPK
    // from the same GameBanana page shared one key, so one opt-in armed both.
    const skinPart = mod({ id: 'skin', gameBananaId: 7 });
    const hudPart = mod({ id: 'hud', gameBananaId: 7, globalType: 'hud' });
    expect(shufflePoolKey(skinPart)).not.toBe(shufflePoolKey(hudPart));
  });

  it('collapses two VPKs of one submission inside the same bucket', () => {
    // Intentional: within one bucket they are a single pick, exactly as on the
    // hero axis.
    expect(shufflePoolKey(mod({ id: 'h1', gameBananaId: 7, globalType: 'hud' }))).toBe(
      shufflePoolKey(mod({ id: 'h2', gameBananaId: 7, globalType: 'hud' }))
    );
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

  it('enables the specifically selected variant by GameBanana file id', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a1', gameBananaId: 1, gameBananaFileId: 11, priority: 1 }),
        mod({ id: 'a2', gameBananaId: 1, gameBananaFileId: 12, priority: 2 }),
      ]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      variants: new Map([['gamebanana:1', { fileId: 12 }]]),
      rng: fixedRng(0),
    });

    expect(plan.enableIds).toEqual(['a2']);
  });

  it('disables an enabled sibling when a specific variant is selected', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a1', gameBananaId: 1, gameBananaFileId: 11, enabled: true, priority: 1 }),
        mod({ id: 'a2', gameBananaId: 1, gameBananaFileId: 12, priority: 2 }),
      ]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      variants: new Map([['gamebanana:1', { fileId: 12 }]]),
      rng: fixedRng(0),
    });

    expect(plan.enableIds).toEqual(['a2']);
    expect(plan.disableIds).toEqual(['a1']);
  });

  it('selects a random installed variant when configured for random', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a1', gameBananaId: 1, gameBananaFileId: 11, priority: 1 }),
        mod({ id: 'a2', gameBananaId: 1, gameBananaFileId: 12, priority: 2 }),
      ]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      variants: new Map([['gamebanana:1', 'random']]),
      rng: sequenceRng(0, 0.99),
    });

    expect(plan.enableIds).toEqual(['a2']);
  });

  it('ignores a legacy primary choice and stays non-exclusive', () => {
    // 'primary' is no longer an offered policy. readStoredShuffleVariants drops
    // it, but a map handed straight to the planner must not resurrect it as an
    // explicit (exclusive) choice: both co-required VPKs stay loaded, exactly as
    // if nothing were stored for this skin.
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a1', gameBananaId: 1, gameBananaFileId: 11, enabled: true, priority: 1 }),
        mod({ id: 'a2', gameBananaId: 1, gameBananaFileId: 12, enabled: true, priority: 2 }),
      ]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      variants: new Map([['gamebanana:1', 'primary' as unknown as VariantChoice]]),
      rng: fixedRng(0),
    });

    expect(plan.enableIds).toEqual([]);
    expect(plan.disableIds).toEqual([]);
    expect(plan.changedHeroes).toEqual([]);
  });

  it('falls back to a random installed variant when a specific file is missing', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [
        mod({ id: 'a1', gameBananaId: 1, gameBananaFileId: 11, priority: 1 }),
        mod({ id: 'a2', gameBananaId: 1, gameBananaFileId: 12, priority: 2 }),
      ]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      variants: new Map([['gamebanana:1', { fileId: 999 }]]),
      rng: sequenceRng(0, 0.99),
    });

    expect(plan.enableIds).toEqual(['a2']);
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

  // The reported bug: a mod the user wants kept on was turned off every time
  // the hero's skins re-rolled, forcing them to merge it into each skin.
  it('never disables a Global mod when the hero re-rolls', () => {
    const heroSkins = new Map<number, Mod[]>([
      [
        1,
        [
          mod({ id: 'keep', gameBananaId: 9, enabled: true, priority: 1, priorityMod: true }),
          mod({ id: 'a', gameBananaId: 1, enabled: true, priority: 2 }),
          mod({ id: 'b', gameBananaId: 2, priority: 3 }),
        ],
      ],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1', 'gamebanana:2']),
      rng: fixedRng(0),
    });
    expect(plan.disableIds).not.toContain('keep');
    // The ordinary enabled skin still gets swapped out, so the shuffle keeps
    // working around the Global mod rather than being disabled by it.
    expect(plan.disableIds).toContain('a');
    expect(plan.enableIds).toEqual(['b']);
  });

  it('never picks a Global mod as the re-rolled skin, even when pooled', () => {
    const heroSkins = new Map<number, Mod[]>([
      [
        1,
        [
          mod({ id: 'glob', gameBananaId: 1, enabled: true, priority: 1, priorityMod: true }),
          mod({ id: 'b', gameBananaId: 2, priority: 2 }),
        ],
      ],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1', 'gamebanana:2']),
      rng: fixedRng(0),
    });
    expect(plan.enableIds).toEqual(['b']);
    expect(plan.disableIds).toEqual([]);
  });

  // Pin beats pool: with nothing left to re-roll, the hero is skipped rather
  // than the Global mod being cycled with itself.
  it('skips a hero whose only pooled skin is Global', () => {
    const heroSkins = new Map<number, Mod[]>([
      [1, [mod({ id: 'glob', gameBananaId: 1, enabled: true, priority: 1, priorityMod: true })]],
    ]);
    const plan = planRandomization({
      heroSkins,
      heroIds: [1],
      included: new Set(['gamebanana:1']),
      rng: fixedRng(0),
    });
    expect(plan).toEqual({ enableIds: [], disableIds: [], changedHeroes: [] });
  });

  // The General classification buckets (Soul Containers, HUD, Announcer, ...)
  // are shuffle groups too, with exactly the hero rules.
  describe('global buckets', () => {
    it('re-rolls a bucket and disables the previously enabled member', () => {
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'hud',
          [
            mod({ id: 'hud-a', gameBananaId: 1, enabled: true, priority: 1 }),
            mod({ id: 'hud-b', gameBananaId: 2, enabled: false, priority: 2 }),
          ],
        ],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['gamebanana:1', 'gamebanana:2']),
        rng: fixedRng(0),
      });
      expect(plan.enableIds).toEqual(['hud-b']);
      expect(plan.disableIds).toEqual(['hud-a']);
    });

    it('leaves a bucket with nothing opted in untouched', () => {
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        ['announcer', [mod({ id: 'ann', gameBananaId: 1, enabled: true, priority: 1 })]],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['gamebanana:9']),
        rng: fixedRng(0),
      });
      expect(plan).toEqual({ enableIds: [], disableIds: [], changedHeroes: [] });
    });

    it('never picks or disables a Global mod inside a bucket', () => {
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'icons',
          [
            mod({ id: 'glob', gameBananaId: 1, enabled: true, priority: 1, priorityMod: true, metaKey: 'grimoire/pak05_dir.vpk' }),
            mod({ id: 'ico-a', gameBananaId: 2, enabled: true, priority: 2 }),
            mod({ id: 'ico-b', gameBananaId: 3, enabled: false, priority: 3 }),
          ],
        ],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['gamebanana:1', 'gamebanana:2', 'gamebanana:3']),
        rng: fixedRng(0),
      });
      expect(plan.enableIds).toEqual(['ico-b']);
      expect(plan.disableIds).toEqual(['ico-a']);
      expect(plan.enableIds).not.toContain('glob');
      expect(plan.disableIds).not.toContain('glob');
    });

    it('skips a bucket whose only opted-in mod is Global', () => {
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'hideout',
          [mod({ id: 'glob', gameBananaId: 1, enabled: true, priority: 1, priorityMod: true, metaKey: 'grimoire/pak05_dir.vpk' })],
        ],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['gamebanana:1']),
        rng: fixedRng(0),
      });
      expect(plan).toEqual({ enableIds: [], disableIds: [], changedHeroes: [] });
    });

    it('biases away from the active bucket member, ignoring the Global one', () => {
      // The Global mod sorts first by load order, so without the priorityMod
      // filter it would be read as "active" and the bias would compare against
      // the wrong mod, letting the re-roll land back on hud-a.
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'hud',
          [
            mod({ id: 'glob', gameBananaId: 9, enabled: true, priority: 1, priorityMod: true, metaKey: 'grimoire/pak05_dir.vpk' }),
            mod({ id: 'hud-a', gameBananaId: 1, enabled: true, priority: 2 }),
            mod({ id: 'hud-b', gameBananaId: 2, enabled: false, priority: 3 }),
          ],
        ],
      ]);
      for (const value of [0, 0.5, 0.99]) {
        const plan = planRandomization({
          heroSkins: new Map(),
          heroIds: [],
          globalBuckets,
          included: new Set(['gamebanana:1', 'gamebanana:2']),
          rng: fixedRng(value),
        });
        expect(plan.enableIds).toEqual(['hud-b']);
        expect(plan.disableIds).toEqual(['hud-a']);
      }
    });

    // A hero shows one skin, so its re-roll clears the slot. A bucket runs
    // several mods at once quite legitimately, so its sweep stops at the pool.
    it('leaves an enabled non-pooled companion on when the bucket re-rolls', () => {
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'hud',
          [
            mod({ id: 'hud-a', gameBananaId: 1, globalType: 'hud', enabled: true, priority: 1 }),
            mod({ id: 'hud-b', gameBananaId: 2, globalType: 'hud', enabled: false, priority: 2 }),
            // Never opted in, always on: a complementary tweak the user runs
            // alongside whatever else the bucket holds.
            mod({ id: 'hud-keep', gameBananaId: 3, globalType: 'hud', enabled: true, priority: 3 }),
          ],
        ],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['bucket:hud:gamebanana:1', 'bucket:hud:gamebanana:2']),
        rng: fixedRng(0),
      });
      expect(plan.enableIds).toEqual(['hud-b']);
      expect(plan.disableIds).toEqual(['hud-a']);
      expect(plan.disableIds).not.toContain('hud-keep');
    });

    // The exception to the pool-limited sweep: a prop-container bucket IS a
    // slot (the game shows one Soul Container / Spirit Urn, and the Locker's
    // selectGlobalMod force-disables the rest of the type on selection). Two
    // survivors would override the same prop and the lower pakNN wins, so the
    // shuffle's pick could be invisible in-game.
    it('clears a non-pooled enabled Soul Container when the bucket re-rolls', () => {
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'soul-container',
          [
            // Enabled but never opted in: the user's current pick.
            mod({ id: 'soul-keep', gameBananaId: 1, globalType: 'soul-container', enabled: true, priority: 1 }),
            mod({ id: 'soul-b', gameBananaId: 2, globalType: 'soul-container', enabled: false, priority: 2 }),
          ],
        ],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['bucket:soul-container:gamebanana:2']),
        rng: fixedRng(0),
      });
      expect(plan.enableIds).toEqual(['soul-b']);
      expect(plan.disableIds).toEqual(['soul-keep']);
    });

    it('still never disables a Global mod inside a prop-container bucket', () => {
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'spirit-urn',
          [
            mod({ id: 'urn-global', gameBananaId: 1, globalType: 'spirit-urn', enabled: true, priorityMod: true }),
            mod({ id: 'urn-a', gameBananaId: 2, globalType: 'spirit-urn', enabled: true, priority: 1 }),
            mod({ id: 'urn-b', gameBananaId: 3, globalType: 'spirit-urn', enabled: false, priority: 2 }),
          ],
        ],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['bucket:spirit-urn:gamebanana:3']),
        rng: fixedRng(0),
      });
      expect(plan.enableIds).toEqual(['urn-b']);
      // The whole-bucket sweep clears the non-pooled member but never the
      // priority-root one.
      expect(plan.disableIds).toEqual(['urn-a']);
    });

    it('reads bucket members under the axis-qualified key only', () => {
      // The bare key is the hero axis. A bucket that answered to it would be
      // armed by an opt-in the user made on a completely different card.
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'announcer',
          [
            mod({ id: 'ann-a', gameBananaId: 1, globalType: 'announcer', enabled: true }),
            mod({ id: 'ann-b', gameBananaId: 2, globalType: 'announcer', enabled: false }),
          ],
        ],
      ]);
      const plan = planRandomization({
        heroSkins: new Map(),
        heroIds: [],
        globalBuckets,
        included: new Set(['gamebanana:1', 'gamebanana:2']),
        rng: fixedRng(0),
      });
      expect(plan).toEqual({ enableIds: [], disableIds: [], changedHeroes: [] });
    });

    it('shuffles heroes and buckets in the same plan without crossing them', () => {
      const heroSkins = new Map<number, Mod[]>([
        [
          1,
          [
            mod({ id: 'skin-a', gameBananaId: 1, enabled: true, priority: 1 }),
            mod({ id: 'skin-b', gameBananaId: 2, enabled: false, priority: 2 }),
          ],
        ],
      ]);
      const globalBuckets = new Map<GlobalModType, Mod[]>([
        [
          'killstreak-music',
          [
            mod({ id: 'ks-a', gameBananaId: 3, enabled: true, priority: 3 }),
            mod({ id: 'ks-b', gameBananaId: 4, enabled: false, priority: 4 }),
          ],
        ],
      ]);
      const plan = planRandomization({
        heroSkins,
        heroIds: [1],
        globalBuckets,
        included: new Set(['gamebanana:1', 'gamebanana:2', 'gamebanana:3', 'gamebanana:4']),
        rng: fixedRng(0),
      });
      expect(plan.enableIds).toEqual(['skin-b', 'ks-b']);
      expect(plan.disableIds).toEqual(['skin-a', 'ks-a']);
      // Only the hero axis reports a changed id; buckets have no hero.
      expect(plan.changedHeroes).toEqual([1]);
    });
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

  it('re-rolls a General classification bucket alongside the heroes', () => {
    // Announcer packs are their own shuffle group: the pooled one that is off
    // comes on and the one that was on goes off, exactly like a hero skin.
    const mods = [
      skin({ id: 'ann-a', gameBananaId: 6, enabled: true, globalType: 'announcer', priority: 1 }),
      skin({ id: 'ann-b', gameBananaId: 7, enabled: false, globalType: 'announcer', priority: 2 }),
    ];
    const plan = planLaunchShuffle({
      mods,
      heroList,
      included: new Set(['bucket:announcer:gamebanana:6', 'bucket:announcer:gamebanana:7']),
    });
    expect(plan.enableIds).toEqual(['ann-b']);
    expect(plan.disableIds).toEqual(['ann-a']);
    // Buckets are not heroes, so the hero list stays empty.
    expect(plan.changedHeroes).toEqual([]);
  });

  it('leaves a bucket alone when its only pooled mod is Global', () => {
    const mods = [
      skin({
        id: 'g',
        gameBananaId: 6,
        enabled: true,
        globalType: 'announcer',
        priorityMod: true,
        metaKey: 'grimoire/pak05_dir.vpk',
      }),
    ];
    expect(
      planLaunchShuffle({
        mods,
        heroList,
        included: new Set(['bucket:announcer:gamebanana:6']),
      })
    ).toEqual(EMPTY);
  });

  // One GameBanana submission shipping a hero skin VPK and a HUD VPK: two
  // cards, two axes, and (since shufflePoolKey) two independent opt-ins.
  describe('one submission across two axes', () => {
    const crossAxisMods = () => [
      skin({ id: 'skin-pick', gameBananaId: 1, enabled: false, priority: 1 }),
      skin({ id: 'skin-live', gameBananaId: 2, enabled: true, priority: 2 }),
      // Deliberately off: the user does not want this sibling loaded.
      skin({ id: 'hud-sibling', gameBananaId: 1, globalType: 'hud', enabled: false, priority: 3 }),
      skin({ id: 'hud-live', gameBananaId: 2, globalType: 'hud', enabled: true, priority: 4 }),
    ];

    it('pooling the hero key re-rolls the hero group and leaves the bucket alone', () => {
      const plan = planLaunchShuffle({
        mods: crossAxisMods(),
        heroList,
        included: new Set(['gamebanana:1']),
      });
      expect(plan.enableIds).toEqual(['skin-pick']);
      expect(plan.disableIds).toEqual(['skin-live']);
      // The HUD sibling shares the submission id and must stay exactly as it is.
      expect(plan.enableIds).not.toContain('hud-sibling');
      expect(plan.disableIds).not.toContain('hud-live');
    });

    it('pooling the bucket key re-rolls the bucket and leaves the hero alone', () => {
      const plan = planLaunchShuffle({
        mods: crossAxisMods(),
        heroList,
        included: new Set(['bucket:hud:gamebanana:1']),
      });
      expect(plan.enableIds).toEqual(['hud-sibling']);
      // hud-live is enabled but never pooled, so the bucket sweep spares it.
      expect(plan.disableIds).toEqual([]);
      expect(plan.enableIds).not.toContain('skin-pick');
      expect(plan.disableIds).not.toContain('skin-live');
      expect(plan.changedHeroes).toEqual([]);
    });

    it('ignores a bare-key variant choice when picking inside a bucket', () => {
      const mods = [
        skin({ id: 'hud1', gameBananaId: 1, gameBananaFileId: 11, globalType: 'hud', priority: 1 }),
        skin({ id: 'hud2', gameBananaId: 1, gameBananaFileId: 12, globalType: 'hud', priority: 2 }),
      ];
      const plan = planLaunchShuffle({
        mods,
        heroList,
        included: new Set(['bucket:hud:gamebanana:1']),
        // Written by the hero card of the same submission. It must not reach
        // the bucket pick, which falls back to the unset default (primary, with
        // siblings spared).
        variants: new Map<string, VariantChoice>([['gamebanana:1', { fileId: 12 }]]),
      });
      expect(plan.enableIds).toEqual(['hud1']);
      expect(plan.disableIds).toEqual([]);
    });
  });

  it('files a mod on exactly one axis: a classified mod never shuffles as a hero skin', () => {
    // The mod is hero-tagged AND classified. getEffectiveGlobalType routes it to
    // the bucket, so the hero grouping must not also see it (double-counting it
    // would let one launch enable and disable the same mod).
    const mods = [
      skin({ id: 'hud', gameBananaId: 8, enabled: false, globalType: 'hud' }),
      skin({ id: 'plain', gameBananaId: 9, enabled: true, priority: 2 }),
    ];
    const plan = planLaunchShuffle({
      mods,
      heroList,
      included: new Set(['bucket:hud:gamebanana:8']),
    });
    expect(plan.enableIds).toEqual(['hud']);
    // 'plain' is the hero's only skin and is not pooled, so the hero group is
    // skipped entirely: the bucket re-roll must not reach across axes.
    expect(plan.disableIds).toEqual([]);
    expect(plan.changedHeroes).toEqual([]);
  });
});

describe('shuffleGroupKind', () => {
  const heroList = [{ id: 1, name: 'Vindicta' }];
  const skin = (over: Partial<Mod> & { id: string }) =>
    mod({ sourceSection: 'Mod', lockerHero: 'Vindicta', ...over });

  it('reports hero for a Locker-managed skin that lands on a hero', () => {
    expect(shuffleGroupKind(skin({ id: 'a' }), { heroList })).toBe('hero');
  });

  it('reports bucket for a classified mod, hero tag or not', () => {
    expect(shuffleGroupKind(skin({ id: 'hud', globalType: 'hud' }), { heroList })).toBe('bucket');
    expect(shuffleGroupKind(mod({ id: 'ann', globalType: 'announcer' }), { heroList })).toBe(
      'bucket'
    );
  });

  it('reports priority for a Global mod, whatever else it is', () => {
    expect(
      shuffleGroupKind(skin({ id: 'g', priorityMod: true, metaKey: 'grimoire/pak05_dir.vpk' }), {
        heroList,
      })
    ).toBe('priority');
    expect(
      shuffleGroupKind(
        skin({ id: 'gh', globalType: 'hud', priorityMod: true, metaKey: 'grimoire/pak06_dir.vpk' }),
        { heroList }
      )
    ).toBe('priority');
  });

  it('reports null for a mod the planner never touches', () => {
    // Sound-section mods are the Sounds tab's domain, never shuffled.
    expect(
      shuffleGroupKind(mod({ id: 'snd', sourceSection: 'Sound', lockerHero: 'Vindicta' }), {
        heroList,
      })
    ).toBeNull();
    // Locker-managed but matching no hero: it lands in `unassigned`, which the
    // planner discards, so offering an opt-in here would be a dead control.
    expect(shuffleGroupKind(mod({ id: 'orphan', sourceSection: 'Mod' }), { heroList })).toBeNull();
  });

  it('without a hero list, answers on the axis alone (no hero placement check)', () => {
    expect(shuffleGroupKind(mod({ id: 'orphan', sourceSection: 'Mod' }))).toBe('hero');
  });

  it('agrees with planLaunchShuffle: each kind ends up exactly where it says', () => {
    const heroSkin = skin({ id: 'hero-pick', gameBananaId: 1 });
    const bucketMod = skin({ id: 'bucket-pick', gameBananaId: 2, globalType: 'announcer' });
    const globalMod = skin({
      id: 'global-pinned',
      gameBananaId: 3,
      enabled: true,
      globalType: 'announcer',
      priorityMod: true,
      metaKey: 'grimoire/pak05_dir.vpk',
    });
    const untouched = mod({ id: 'sound', sourceSection: 'Sound', gameBananaId: 4, enabled: true });
    const mods = [heroSkin, bucketMod, globalMod, untouched];
    const options = { heroList };

    expect(shuffleGroupKind(heroSkin, options)).toBe('hero');
    expect(shuffleGroupKind(bucketMod, options)).toBe('bucket');
    expect(shuffleGroupKind(globalMod, options)).toBe('priority');
    expect(shuffleGroupKind(untouched, options)).toBeNull();

    const plan = planLaunchShuffle({
      mods,
      heroList,
      // Bucket-axis mods pool under their qualified key (shufflePoolKey), the
      // hero-axis one under the bare key.
      included: new Set([
        'gamebanana:1',
        'bucket:announcer:gamebanana:2',
        'bucket:announcer:gamebanana:3',
        'gamebanana:4',
      ]),
    });
    // hero kind: re-rolled on the hero axis (its hero id is reported).
    expect(plan.changedHeroes).toEqual([1]);
    expect(plan.enableIds).toContain('hero-pick');
    // bucket kind: re-rolled, but off the hero axis.
    expect(plan.enableIds).toContain('bucket-pick');
    // priority kind: never enabled by the plan (already on) and never disabled.
    expect(plan.enableIds).not.toContain('global-pinned');
    expect(plan.disableIds).not.toContain('global-pinned');
    // null kind: pooled or not, the planner never sees it.
    expect(plan.enableIds).not.toContain('sound');
    expect(plan.disableIds).not.toContain('sound');
  });
});

describe('summarizeShufflePool', () => {
  const heroList = [{ id: 1, name: 'Vindicta' }];
  const skin = (over: Partial<Mod> & { id: string }) =>
    mod({ sourceSection: 'Mod', lockerHero: 'Vindicta', ...over });

  it('collects only the keys the planner can re-roll', () => {
    const mods = [
      skin({ id: 'a', gameBananaId: 1 }),
      skin({ id: 'b', gameBananaId: 2, globalType: 'hud' }),
      skin({ id: 'g', gameBananaId: 3, priorityMod: true, metaKey: 'grimoire/pak05_dir.vpk' }),
      mod({ id: 'snd', sourceSection: 'Sound', gameBananaId: 4 }),
    ];
    const summary = summarizeShufflePool(mods, new Set(), { heroList });
    // The hero-axis card keeps the bare key; the classified one is qualified by
    // its bucket (see shufflePoolKey).
    expect(summary.eligibleKeys).toEqual(['gamebanana:1', 'bucket:hud:gamebanana:2']);
    expect(summary.allIncluded).toBe(false);
  });

  it('reports one key per axis for a submission that spans both', () => {
    const mods = [
      skin({ id: 'skin', gameBananaId: 1 }),
      skin({ id: 'hud', gameBananaId: 1, globalType: 'hud' }),
    ];
    expect(summarizeShufflePool(mods, new Set(), { heroList }).eligibleKeys).toEqual([
      'gamebanana:1',
      'bucket:hud:gamebanana:1',
    ]);
  });

  it('dedupes cards that share one shuffle identity', () => {
    const mods = [
      skin({ id: 'a1', gameBananaId: 1 }),
      skin({ id: 'a2', gameBananaId: 1 }),
    ];
    expect(summarizeShufflePool(mods, new Set(), { heroList }).eligibleKeys).toEqual([
      'gamebanana:1',
    ]);
  });

  it('reports allIncluded only when every eligible key is pooled', () => {
    const mods = [skin({ id: 'a', gameBananaId: 1 }), skin({ id: 'b', gameBananaId: 2 })];
    expect(summarizeShufflePool(mods, new Set(['gamebanana:1']), { heroList }).allIncluded).toBe(
      false
    );
    expect(
      summarizeShufflePool(mods, new Set(['gamebanana:1', 'gamebanana:2']), { heroList })
        .allIncluded
    ).toBe(true);
  });

  it('is not allIncluded when nothing is eligible (the bulk button stays hidden)', () => {
    const mods = [mod({ id: 'snd', sourceSection: 'Sound', gameBananaId: 4 })];
    const summary = summarizeShufflePool(mods, new Set(['gamebanana:4']), { heroList });
    expect(summary.eligibleKeys).toEqual([]);
    expect(summary.allIncluded).toBe(false);
  });
});

describe('prunePoolKeysForMod', () => {
  it('drops both axis keys of the newly pinned mod', () => {
    // Pooled as a plain skin, later classified, now pinned Global: both keys it
    // could have been stored under go, or the toolbar keeps counting a card
    // that no longer offers the opt-in.
    const pinned = mod({ id: 'g', gameBananaId: 1, globalType: 'hud', priorityMod: true });
    const included = new Set(['gamebanana:1', 'bucket:hud:gamebanana:1', 'gamebanana:2']);
    expect(prunePoolKeysForMod(included, pinned, [pinned])).toEqual(new Set(['gamebanana:2']));
  });

  it('keeps a key another live non-priority mod still maps to', () => {
    // A sibling skin from the same submission is still shuffleable, and its
    // opt-in is not the pinned mod's to cancel.
    const pinned = mod({ id: 'g', gameBananaId: 1, globalType: 'hud', priorityMod: true });
    const sibling = mod({ id: 's', gameBananaId: 1 });
    const included = new Set(['gamebanana:1', 'bucket:hud:gamebanana:1']);
    expect(prunePoolKeysForMod(included, pinned, [pinned, sibling])).toEqual(
      new Set(['gamebanana:1'])
    );
  });

  it('returns null when the mod was never pooled', () => {
    const pinned = mod({ id: 'g', gameBananaId: 1, priorityMod: true });
    expect(prunePoolKeysForMod(new Set(['gamebanana:9']), pinned, [pinned])).toBeNull();
  });

  it('returns null when every key it holds is claimed elsewhere', () => {
    const pinned = mod({ id: 'g', gameBananaId: 1, priorityMod: true });
    const sibling = mod({ id: 's', gameBananaId: 1 });
    expect(prunePoolKeysForMod(new Set(['gamebanana:1']), pinned, [pinned, sibling])).toBeNull();
  });

  it('prunes a pinned hero skin despite a classified sibling of the same submission', () => {
    // The sibling pools under its qualified bucket key only; its bare
    // shuffleSkinKey is a key nothing uses, so it must not keep the pinned
    // skin's hero-axis key alive (stale badge + silent re-entry on unpin).
    const pinned = mod({ id: 'skin', gameBananaId: 1, priorityMod: true });
    const bucketSibling = mod({ id: 'hud', gameBananaId: 1, globalType: 'hud' });
    const included = new Set(['gamebanana:1', 'bucket:hud:gamebanana:1']);
    expect(prunePoolKeysForMod(included, pinned, [pinned, bucketSibling])).toEqual(
      new Set(['bucket:hud:gamebanana:1'])
    );
  });

  it('ignores other pinned mods when deciding a key is still claimed', () => {
    // Another Global mod on the same key cannot keep the opt-in alive: its own
    // card shows the pin too, so nothing would ever use it.
    const pinned = mod({ id: 'g1', gameBananaId: 1, priorityMod: true });
    const otherPinned = mod({ id: 'g2', gameBananaId: 1, priorityMod: true });
    expect(prunePoolKeysForMod(new Set(['gamebanana:1']), pinned, [pinned, otherPinned])).toEqual(
      new Set()
    );
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

describe('readStoredShuffleVariants', () => {
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

  it('loads valid choices and drops legacy or malformed entries', () => {
    // This is the whole 'primary' migration: the guard rejects it, the reader's
    // filter drops it, and that skin reverts to the unset default. No versioned
    // migration code, and the next write persists the cleaned map because the
    // writer serializes the entire in-memory map.
    withLocalStorage(
      JSON.stringify({
        legacyPrimary: 'primary',
        b: 'random',
        c: { fileId: 12 },
        bad: { fileId: '12' },
      }),
      () =>
        expect(readStoredShuffleVariants()).toEqual(
          new Map<string, VariantChoice>([
            ['b', 'random'],
            ['c', { fileId: 12 }],
          ])
        )
    );
  });
});
