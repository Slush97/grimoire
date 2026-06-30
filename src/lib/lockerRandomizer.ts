import type { Mod } from '../types/mod';
import {
  activeLockerSkin,
  getEffectiveGlobalType,
  groupLockerSkins,
  groupModsByCategory,
  isLockerManagedMod,
} from './lockerUtils';

/** localStorage key for the set of skin keys opted INTO the launch shuffle. */
export const SHUFFLE_INCLUDED_KEY = 'lockerShuffleIncluded';
/** localStorage key for the master "shuffle skins on launch" switch. */
export const SHUFFLE_ON_LAUNCH_KEY = 'lockerShuffleOnLaunch';

/**
 * Stable identity for a skin used by the shuffle for the opt-in pool. Prefers
 * the GameBanana archive id, then the content hash, then the volatile mod id.
 *
 * We deliberately do NOT reuse getLockerSkinKey: its `mod:<id>` fallback keys
 * off mod.id, which is derived from the pakNN filename and changes every time a
 * mod is enabled/disabled. A persisted opt-in for a local (non-GameBanana)
 * import would then silently stop matching after the first shuffle. sha256 is
 * content-addressed and survives the rename.
 */
export function shuffleSkinKey(mod: Mod): string {
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    return `gamebanana:${mod.gameBananaId}`;
  }
  if (mod.sha256) {
    return `sha256:${mod.sha256}`;
  }
  return `mod:${mod.id}`;
}

/**
 * Synchronous loader for the persisted shuffle-inclusion set. Used as a lazy
 * useState initializer so the value is present on the very first render. See
 * readStoredFavorites (lockerUtils.ts) for the StrictMode save/load race this
 * synchronous-seed pattern avoids.
 */
export function readStoredShuffleIncluded(): Set<string> {
  try {
    const stored = localStorage.getItem(SHUFFLE_INCLUDED_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

/** Synchronous loader for the master on-launch switch (defaults off). */
export function readStoredShuffleOnLaunch(): boolean {
  try {
    return localStorage.getItem(SHUFFLE_ON_LAUNCH_KEY) === 'true';
  } catch {
    return false;
  }
}

export interface RandomizePlanOptions {
  /** Per-hero skin mods, keyed by hero category id (Locker's heroMods.map). */
  heroSkins: Map<number, Mod[]>;
  /** Hero ids to consider (usually every hero with installed skins). */
  heroIds: number[];
  /** Skin keys (shuffleSkinKey) the user opted INTO the shuffle pool. */
  included: Set<string>;
  /** Injectable RNG returning [0, 1); defaults to Math.random. */
  rng?: () => number;
  /**
   * When a hero has >=2 eligible skins, avoid re-picking the currently-active
   * one so a repeat shuffle visibly changes its look. Defaults to true.
   */
  avoidCurrent?: boolean;
}

export interface RandomizePlan {
  enableIds: string[];
  disableIds: string[];
  /** Hero ids that actually changed (drives the result toast count). */
  changedHeroes: number[];
}

/**
 * Compute the enable/disable set for a skin shuffle. For each in-scope hero,
 * picks one of the skins the user opted into the pool at random and makes it the
 * hero's single active skin: enable its primary variant and disable every other
 * currently-enabled skin VPK for that hero, sparing only the chosen skin's own
 * variant VPKs so a multi-file submission loads whole. Heroes with no opted-in
 * skins (or no installed skins) are left untouched - that is the per-hero
 * opt-out: don't add any of a hero's skins and it never shuffles. Sounds, cards
 * and ability effects are separate axes and are never touched.
 *
 * Pure and deterministic given a fixed rng, so it's unit-tested directly. The
 * returned ids are renderer-current; they stay valid because the apply runs them
 * as one batch under the main-process mutation lock (see setModsEnabledBatch).
 */
export function planRandomization(options: RandomizePlanOptions): RandomizePlan {
  const { heroSkins, heroIds, included, rng = Math.random, avoidCurrent = true } = options;
  const enableIds: string[] = [];
  const disableIds: string[] = [];
  const changedHeroes: number[] = [];

  for (const heroId of heroIds) {
    const mods = heroSkins.get(heroId);
    if (!mods || mods.length === 0) continue;

    const skins = groupLockerSkins(mods);
    const eligible = skins.filter((skin) => included.has(shuffleSkinKey(skin.primary)));
    if (eligible.length === 0) continue;

    // Bias away from the currently-active skin so each launch changes the look.
    // Only when there's an alternative left to pick.
    const activeMod = activeLockerSkin(mods);
    const activeKey = activeMod ? shuffleSkinKey(activeMod) : undefined;
    let pool = eligible;
    if (avoidCurrent && eligible.length > 1 && activeKey) {
      const without = eligible.filter((skin) => shuffleSkinKey(skin.primary) !== activeKey);
      if (without.length > 0) pool = without;
    }

    const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    const chosen = pool[index];
    const chosenPrimaryId = chosen.primary.id;

    let heroChanged = false;
    if (!chosen.primary.enabled) {
      enableIds.push(chosenPrimaryId);
      heroChanged = true;
    }
    // Make the chosen skin the hero's single active skin: disable every other
    // enabled skin VPK for this hero. We spare ONLY the chosen skin's own
    // variant VPKs (same submission) so a skin that ships several required files
    // isn't left half-loaded. Sounds, cards and ability effects live on other
    // Locker axes and are never in this list, so they stay exactly as set.
    const chosenVariantIds = new Set(chosen.variants.map((v) => v.id));
    for (const mod of mods) {
      if (mod.enabled && !chosenVariantIds.has(mod.id)) {
        disableIds.push(mod.id);
        heroChanged = true;
      }
    }
    if (heroChanged) changedHeroes.push(heroId);
  }

  return { enableIds, disableIds, changedHeroes };
}

export interface LaunchShufflePlanOptions {
  /** The full installed mod list (appStore `mods`). */
  mods: Mod[];
  /** Hero categories used to group skins by hero (buildHeroList output). */
  heroList: { id: number; name: string }[];
  /** Skin keys (shuffleSkinKey) opted into the shuffle pool. */
  included: Set<string>;
  /** Injectable RNG; defaults to Math.random. */
  rng?: () => number;
}

/**
 * Build the launch-time shuffle plan from the raw mod list. Filters to per-hero
 * skin mods (the same predicate the Locker uses for its hero grid), groups them
 * by hero, and shuffles every hero that has at least one opted-in skin. Keeping
 * this here means the Locker and the launch path share one grouping + selection
 * path, so the set of skins a launch can pick is exactly the set the Locker
 * shows the per-skin opt-in toggle on.
 */
export function planLaunchShuffle(options: LaunchShufflePlanOptions): RandomizePlan {
  const { mods, heroList, included, rng } = options;
  if (included.size === 0) return { enableIds: [], disableIds: [], changedHeroes: [] };
  const lockerSkins = mods.filter((m) => isLockerManagedMod(m) && !getEffectiveGlobalType(m));
  const { map } = groupModsByCategory(lockerSkins, heroList);
  return planRandomization({ heroSkins: map, heroIds: [...map.keys()], included, rng });
}
