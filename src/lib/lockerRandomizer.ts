import type { GlobalModType, Mod } from '../types/mod';
import {
  activeLockerSkin,
  getEffectiveGlobalType,
  GLOBAL_MOD_TYPE_ORDER,
  groupGlobalMods,
  groupLockerSkins,
  groupModsByCategory,
  isLockerManagedMod,
  isPropContainerType,
  type LockerSkin,
} from './lockerUtils';

/** localStorage key for the set of skin keys opted INTO the launch shuffle. */
export const SHUFFLE_INCLUDED_KEY = 'lockerShuffleIncluded';
/** localStorage key for the master "shuffle skins on launch" switch. */
export const SHUFFLE_ON_LAUNCH_KEY = 'lockerShuffleOnLaunch';
/** localStorage key for per-skin variant choices. */
export const SHUFFLE_VARIANT_KEY = 'lockerShuffleVariant';

/**
 * An explicit per-skin variant policy for the shuffle. Absence of a choice (no
 * map entry) is the default and means "keep whatever files are already loaded".
 *
 * There is deliberately no 'primary' option: a skin's primary is whichever
 * variant is currently enabled (or has the lowest pakNN), so as a shuffle policy
 * it is neither a stable pin nor a source of variety. It was offered briefly and
 * is now dropped on read (see isVariantChoice).
 */
export type VariantChoice = 'random' | { fileId: number };

/**
 * Stable identity for a skin used by the shuffle for the opt-in pool. Prefers
 * an explicit local variant group, then the GameBanana archive id, then the
 * content hash, then the volatile mod id.
 *
 * The key MUST be shared by every variant of a skin: callers read it off
 * `skin.primary`, and the primary is whichever variant is currently enabled.
 * That is exactly what the shuffle changes, so a per-file key would drop a
 * multi-variant skin out of its own pool the first time it was re-rolled. A
 * local variant group is therefore keyed by its group id, the same way a
 * GameBanana submission is keyed by its archive id.
 *
 * We deliberately do NOT reuse getLockerSkinKey: its `mod:<id>` fallback keys
 * off mod.id, which is derived from the pakNN filename and changes every time a
 * mod is enabled/disabled. A persisted opt-in for a local (non-GameBanana)
 * import would then silently stop matching after the first shuffle. sha256 is
 * content-addressed and survives the rename.
 */
export function shuffleSkinKey(mod: Mod): string {
  if (mod.localGroupId) {
    return `localgroup:${mod.localGroupId}`;
  }
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    return `gamebanana:${mod.gameBananaId}`;
  }
  if (mod.sha256) {
    return `sha256:${mod.sha256}`;
  }
  return `mod:${mod.id}`;
}

/**
 * The pool key for a mod on the axis it actually shuffles on.
 *
 * Hero-axis mods keep the bare shuffleSkinKey (the shipped format, so existing
 * opt-ins keep matching). Bucket-axis mods get an axis-qualified key, because
 * one GameBanana submission can ship both a hero skin VPK and a HUD/announcer
 * sibling: with a single shared key, opting the skin in would silently arm the
 * bucket too (force-enabling a deliberately disabled sibling), and a variant
 * choice made on the hero card would leak into the bucket's pick. Qualifying by
 * bucket makes the two axes separate opt-ins, which is what the two separate
 * cards already look like.
 *
 * Within one bucket, two VPKs sharing a submission id still collapse to one key
 * on purpose: they are one pick, exactly as on the hero axis.
 *
 * Bucket keys are new (nothing shipped wrote one), so there is no legacy form
 * to migrate.
 */
export function shufflePoolKey(mod: Mod): string {
  const globalType = getEffectiveGlobalType(mod);
  const skinKey = shuffleSkinKey(mod);
  // Keyed off the mod's own effective type rather than the bucket it was handed
  // in: groupGlobalMods buckets by exactly this value, so the two agree, and
  // every UI caller has a mod but not a bucket.
  return globalType ? `bucket:${globalType}:${skinKey}` : skinKey;
}

/**
 * Where a mod shuffles, if it shuffles at all.
 *
 *   - 'hero'     competes in its hero's skin group.
 *   - 'bucket'   competes in its General classification bucket.
 *   - 'priority' Global (priority root): always on, never picked, never
 *                disabled, so the UI shows a pin instead of an opt-in.
 *   - null       the planner never touches it.
 */
export type ShuffleGroupKind = 'hero' | 'bucket' | 'priority';

export interface ShuffleGroupOptions {
  /**
   * Hero categories (buildHeroList output). With the list, a Locker-managed
   * skin that matches no hero (groupModsByCategory's `unassigned` pile) is
   * correctly reported as null instead of 'hero'. Pass it wherever offering a
   * dead opt-in would be a lie; omit it when the caller only needs the axis.
   */
  heroList?: readonly { id: number; name: string }[];
}

/**
 * The group a mod is FILED into, ignoring the Global pin. This is exactly the
 * partition planLaunchShuffle builds: 'bucket' for anything carrying an
 * effective global type (what groupGlobalMods buckets), 'hero' for the
 * Locker-managed remainder (what groupModsByCategory groups).
 */
function homeGroupKind(
  mod: Mod,
  heroList?: readonly { id: number; name: string }[]
): 'hero' | 'bucket' | null {
  if (getEffectiveGlobalType(mod)) return 'bucket';
  if (!isLockerManagedMod(mod)) return null;
  if (!heroList) return 'hero';
  // Ask the real grouper rather than re-deriving the hero match: its fallback
  // chain (manual tag, author category, fuzzy name match) lives there, and a
  // second copy here is precisely the drift this helper exists to prevent.
  return groupModsByCategory([mod], [...heroList]).map.size > 0 ? 'hero' : null;
}

/**
 * Single source of truth for "where does this mod shuffle", shared by the
 * planner's own grouping and by every card that offers the pool toggle. A
 * surface that shows the opt-in for a kind the planner ignores persists a
 * choice that does nothing, so the UI asks here rather than re-deriving.
 */
export function shuffleGroupKind(
  mod: Mod,
  options: ShuffleGroupOptions = {}
): ShuffleGroupKind | null {
  // Placement beats filing: a priority-root mod still sits in its home group,
  // but planShuffleGroup neither picks it nor disables it.
  if (mod.priorityMod) return 'priority';
  return homeGroupKind(mod, options.heroList);
}

export interface ShufflePoolSummary {
  /** Distinct shuffle keys of the mods the planner can actually re-roll. */
  eligibleKeys: string[];
  /** Every eligible key is already pooled. False when there are none. */
  allIncluded: boolean;
}

/**
 * Pool math for a bulk "shuffle all / remove all" control over an arbitrary set
 * of cards (today: one user category, which is a view grouping and never a
 * shuffle group of its own). Keys are deduped because two installed cards can
 * share one shuffle identity, and pooling is per identity. Keys come from
 * shufflePoolKey, so a category mixing a hero skin with a classified sibling of
 * the same submission reports two entries, matching the two toggles it shows.
 */
export function summarizeShufflePool(
  mods: readonly Mod[],
  included: ReadonlySet<string>,
  options: ShuffleGroupOptions = {}
): ShufflePoolSummary {
  const eligibleKeys: string[] = [];
  const seen = new Set<string>();
  for (const mod of mods) {
    const kind = shuffleGroupKind(mod, options);
    if (kind !== 'hero' && kind !== 'bucket') continue;
    const key = shufflePoolKey(mod);
    if (seen.has(key)) continue;
    seen.add(key);
    eligibleKeys.push(key);
  }
  return {
    eligibleKeys,
    allIncluded: eligibleKeys.length > 0 && eligibleKeys.every((key) => included.has(key)),
  };
}

/**
 * Drop a mod's pool keys when it becomes Global (priority root).
 *
 * A pinned mod is always on and the planner never re-rolls it, so its card
 * shows the pin instead of the opt-in. Left in the pool, the key would be
 * invisible yet still counted by the toolbar badge, and unpinning would slide
 * the mod back into the shuffle without the user ever asking for it again.
 * Unpinning deliberately does NOT restore the key: re-opting in is one click on
 * a control that is visible again.
 *
 * Both axis keys are considered (the bare hero-axis key and the qualified
 * bucket one) because a mod can have been pooled before it was classified.
 * A key another live non-priority mod still maps to is kept: that sibling's
 * opt-in is not ours to cancel.
 *
 * Pure: returns the new set, or null when there is nothing to remove (the
 * common case, so the caller can skip the write entirely).
 */
export function prunePoolKeysForMod(
  included: ReadonlySet<string>,
  mod: Mod,
  allMods: readonly Mod[]
): Set<string> | null {
  const candidates = [shuffleSkinKey(mod), shufflePoolKey(mod)].filter((key) =>
    included.has(key)
  );
  if (candidates.length === 0) return null;
  // Every key still claimed by a mod that is not pinned. The pinned mod itself
  // is skipped by that same rule, so it never keeps its own key alive. Only
  // shufflePoolKey counts as a claim: it IS the key the sibling pools under
  // (bare for hero-axis mods, axis-qualified for bucket mods). Adding a bucket
  // sibling's bare shuffleSkinKey too would let a classified sibling of the
  // same submission keep a pinned hero skin's key alive, which is exactly the
  // stale-badge / silent-re-entry pair this function exists to prevent.
  const claimed = new Set<string>();
  for (const other of allMods) {
    if (other.priorityMod) continue;
    claimed.add(shufflePoolKey(other));
  }
  const removable = candidates.filter((key) => !claimed.has(key));
  if (removable.length === 0) return null;
  const next = new Set(included);
  for (const key of removable) next.delete(key);
  return next;
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

/**
 * Persist the whole pool in one write. Both the single-card toggle and the
 * bulk category action go through here, so a bulk change is one localStorage
 * write rather than one per key.
 */
export function writeStoredShuffleIncluded(included: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SHUFFLE_INCLUDED_KEY, JSON.stringify([...included]));
  } catch {
    // The in-memory pool still applies when storage is unavailable.
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

/**
 * Legacy 'primary' entries written by an earlier build fail this guard and are
 * dropped by the reader's filter, which is the whole migration: a dropped entry
 * reverts that skin to the unset default, and the next write persists the
 * cleaned map (the writer serializes the entire in-memory map).
 */
function isVariantChoice(value: unknown): value is VariantChoice {
  if (value === 'random') return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    'fileId' in value &&
    typeof value.fileId === 'number' &&
    Number.isFinite(value.fileId)
  );
}

/** Synchronous loader for per-skin variant preferences. */
export function readStoredShuffleVariants(): Map<string, VariantChoice> {
  try {
    const stored = localStorage.getItem(SHUFFLE_VARIANT_KEY);
    if (!stored) return new Map();
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, VariantChoice] => isVariantChoice(entry[1])
      )
    );
  } catch {
    return new Map();
  }
}

export function writeStoredShuffleVariants(choices: ReadonlyMap<string, VariantChoice>): void {
  try {
    localStorage.setItem(SHUFFLE_VARIANT_KEY, JSON.stringify(Object.fromEntries(choices)));
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}

export interface RandomizePlanOptions {
  /** Per-hero skin mods, keyed by hero category id (Locker's heroMods.map). */
  heroSkins: Map<number, Mod[]>;
  /** Hero ids to consider (usually every hero with installed skins). */
  heroIds: number[];
  /** Pool keys (shufflePoolKey) the user opted INTO the shuffle pool. */
  included: Set<string>;
  /**
   * The Locker's General classification buckets (Soul Containers, HUD,
   * Announcer, ...), keyed by globalType. Each non-empty bucket is one more
   * shuffle group: one pick among the opted-in mods, every OTHER POOLED member
   * goes off, and Global (priority root) mods are neither picked nor disabled.
   * The sweep stops at the pool because multi-toggle is a supported bucket
   * state, unlike a hero's single skin slot. Exception: the prop-container
   * buckets (Soul Containers, Spirit Urns) fill one in-game slot each, so
   * their sweep clears the whole bucket like a hero re-roll. Omitted (the
   * default) keeps the shuffle hero-only, which is what pre-existing callers
   * expect.
   */
  globalBuckets?: ReadonlyMap<GlobalModType, Mod[]>;
  /** Per-skin variant preference. Unset (the default) keeps already-enabled
   *  sibling files from the chosen submission loaded. */
  variants?: ReadonlyMap<string, VariantChoice>;
  /** Injectable RNG returning [0, 1); defaults to Math.random. */
  rng?: () => number;
  /**
   * When a group has >=2 eligible skins, avoid re-picking the currently-active
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

/** One of the skin's installed variant VPKs, uniformly at random. */
function pickRandomVariant(skin: LockerSkin, rng: () => number): Mod {
  const index = Math.min(skin.variants.length - 1, Math.floor(rng() * skin.variants.length));
  return skin.variants[index] ?? skin.primary;
}

/** Shared state one group's re-roll reads and appends to. */
interface GroupPlanContext {
  included: Set<string>;
  variants: ReadonlyMap<string, VariantChoice>;
  rng: () => number;
  avoidCurrent: boolean;
  enableIds: string[];
  disableIds: string[];
}

/**
 * Which axis a group belongs to. It decides the pool key the group reads (see
 * shufflePoolKey) and how wide the re-roll's disable sweep goes.
 */
type ShuffleGroupScope = 'hero' | 'bucket';

/**
 * Re-roll one shuffle group, appending to the shared enable/disable lists and
 * returning whether anything actually changed. A group is any set of mods that
 * competes for one slot: a hero's skin pile, or a General classification bucket.
 * Both axes run this one function on purpose, so the three Global rules below
 * hold for buckets without a second copy of the algorithm.
 *
 * The two axes differ in exactly one place, the disable sweep (see below): a
 * hero shows one skin, while most buckets legitimately run several mods at
 * once. `singleSlot` widens a bucket's sweep back to the whole group for the
 * types that, like a hero, fill exactly one in-game slot (Soul Containers,
 * Spirit Urns): the Locker's own toggle path force-disables the rest of the
 * type, and the shuffle must not undo that invariant.
 */
function planShuffleGroup(
  mods: Mod[],
  ctx: GroupPlanContext,
  scope: ShuffleGroupScope,
  { singleSlot = scope === 'hero' }: { singleSlot?: boolean } = {}
): boolean {
  const { included, variants, rng, avoidCurrent, enableIds, disableIds } = ctx;
  // Bucket members are pooled under an axis-qualified key so a hero-card opt-in
  // (or variant choice) on the same submission cannot arm this group.
  const poolKeyOf = scope === 'bucket' ? shufflePoolKey : shuffleSkinKey;
  const skins = groupLockerSkins(mods);
  // A Global mod is pinned by construction: it lives in the priority root and
  // outranks everything, so offering it as a shuffle candidate is
  // contradictory (it is already always on). Dropping it from the pool also
  // means a group whose only pooled entry is Global is skipped entirely, which
  // is the right outcome: there is nothing left to re-roll.
  const eligible = skins.filter(
    (skin) => included.has(poolKeyOf(skin.primary)) && !skin.primary.priorityMod
  );
  if (eligible.length === 0) return false;

  // Bias away from the currently-active skin so each launch changes the look.
  // Only when there's an alternative left to pick.
  //
  // Global mods are excluded from the "active" lookup: activeLockerSkin picks
  // the lowest load order, and a Global mod lives in the priority root, so it
  // sorts ahead of every addons mod by construction. Without this filter one
  // Global mod would make the group's avoid-current bias compare against the
  // wrong skin, and the shuffle could re-pick the skin already on screen.
  const activeMod = activeLockerSkin(mods.filter((m) => !m.priorityMod));
  const activeKey = activeMod ? poolKeyOf(activeMod) : undefined;
  let pool = eligible;
  if (avoidCurrent && eligible.length > 1 && activeKey) {
    const without = eligible.filter((skin) => poolKeyOf(skin.primary) !== activeKey);
    if (without.length > 0) pool = without;
  }

  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const chosen = pool[index];
  const chosenKey = poolKeyOf(chosen.primary);
  const variantChoice = variants.get(chosenKey);
  let chosenVariant = chosen.primary;
  // Only 'random' and a file id count as an explicit policy. Anything else,
  // including a legacy 'primary' handed straight to the planner rather than
  // through the storage reader, falls through to the unset default.
  let explicitChoice = false;
  if (variantChoice === 'random') {
    chosenVariant = pickRandomVariant(chosen, rng);
    explicitChoice = true;
  } else if (typeof variantChoice === 'object') {
    // A specific file that is no longer installed degrades to random rather
    // than silently pinning the primary.
    chosenVariant =
      chosen.variants.find((variant) => variant.gameBananaFileId === variantChoice.fileId) ??
      pickRandomVariant(chosen, rng);
    explicitChoice = true;
  }

  let changed = false;
  if (!chosenVariant.enabled) {
    enableIds.push(chosenVariant.id);
    changed = true;
  }
  // Preserve the historical multi-file behavior until the user explicitly
  // chooses a variant policy: without one, every sibling of the chosen skin is
  // spared, so a submission shipping co-required VPKs is never half-loaded. An
  // explicit selection is exclusive: random and file-specific choices must not
  // leave a previously enabled sibling active.
  const chosenVariantIds = new Set(
    explicitChoice ? [chosenVariant.id] : chosen.variants.map((variant) => variant.id)
  );
  for (const mod of mods) {
    // Global mods survive every re-roll. This is the whole point of the
    // feature: without it, marking a mod Global would keep it winning file
    // collisions right up until the next launch turned it off.
    if (mod.priorityMod) continue;
    if (!mod.enabled || chosenVariantIds.has(mod.id)) continue;
    // A single-slot group (a hero's skin pile, or a prop-container bucket
    // where the game shows exactly one Soul Container / Spirit Urn) clears the
    // whole slot on re-roll, pooled or not: two survivors would override the
    // same asset and whichever holds the lower pakNN wins, making the pick
    // invisible in-game. Multi-toggle buckets are different: running several
    // of their mods at once is a supported state (two complementary HUD
    // tweaks, both always on), so pooling one of them must not turn off
    // companions the user never opted in. Their sweep is limited to the pool,
    // which is precisely the set the user handed to the shuffle.
    if (!singleSlot && !included.has(poolKeyOf(mod))) continue;
    disableIds.push(mod.id);
    changed = true;
  }
  return changed;
}

/**
 * Compute the enable/disable set for a skin shuffle. For each in-scope hero,
 * picks one of the skins the user opted into the pool at random and makes it the
 * hero's single active skin. Without a saved variant preference, already-enabled
 * sibling files from the chosen submission stay loaded: that is what keeps a
 * submission shipping co-required VPKs (model plus voice lines) from being
 * half-loaded, and it is why the unset state stays the default. Once the user
 * explicitly chooses random or a specific file, only that one file remains
 * enabled for the chosen skin. Heroes with no opted-in
 * skins (or no installed skins) are left untouched - that is the per-hero
 * opt-out: don't add any of a hero's skins and it never shuffles.
 *
 * With globalBuckets, every non-empty General classification bucket (Soul
 * Containers, HUD, ...) is one more group under the same rules, minus the
 * whole-group disable: a bucket only turns off its own pooled members, so
 * always-on companions nobody opted in survive the re-roll. Sounds, cards and
 * ability effects are separate axes and are never touched.
 *
 * Pure and deterministic given a fixed rng, so it's unit-tested directly. The
 * returned ids are renderer-current; they stay valid because the apply runs them
 * as one batch under the main-process mutation lock (see setModsEnabledBatch).
 */
export function planRandomization(options: RandomizePlanOptions): RandomizePlan {
  const {
    heroSkins,
    heroIds,
    included,
    globalBuckets,
    variants = new Map(),
    rng = Math.random,
    avoidCurrent = true,
  } = options;
  const enableIds: string[] = [];
  const disableIds: string[] = [];
  const changedHeroes: number[] = [];
  const ctx: GroupPlanContext = { included, variants, rng, avoidCurrent, enableIds, disableIds };

  for (const heroId of heroIds) {
    const mods = heroSkins.get(heroId);
    if (!mods || mods.length === 0) continue;
    if (planShuffleGroup(mods, ctx, 'hero')) changedHeroes.push(heroId);
  }

  // Buckets run after the heroes so a hero-only plan draws exactly the rng
  // sequence it always did. The plan reports no per-bucket change list on
  // purpose: nothing consumes changedHeroes today, so growing the return shape
  // would only break callers that compare a whole plan.
  for (const [type, mods] of globalBuckets?.entries() ?? []) {
    if (mods.length === 0) continue;
    planShuffleGroup(mods, ctx, 'bucket', { singleSlot: isPropContainerType(type) });
  }

  return { enableIds, disableIds, changedHeroes };
}

export interface LaunchShufflePlanOptions {
  /** The full installed mod list (appStore `mods`). */
  mods: Mod[];
  /** Hero categories used to group skins by hero (buildHeroList output). */
  heroList: { id: number; name: string }[];
  /** Pool keys (shufflePoolKey) opted into the shuffle pool. */
  included: Set<string>;
  /** Per-skin variant preferences. */
  variants?: ReadonlyMap<string, VariantChoice>;
  /** Injectable RNG; defaults to Math.random. */
  rng?: () => number;
}

/**
 * Build the launch-time shuffle plan from the raw mod list. Filters to per-hero
 * skin mods (the same predicate the Locker uses for its hero grid), groups them
 * by hero, and shuffles every hero that has at least one opted-in skin. The
 * General classification buckets (groupGlobalMods, the same grouping the
 * Locker's General view tabs on) ride along as extra groups, so an opted-in
 * announcer pack or HUD re-rolls exactly like a hero skin. Keeping this here
 * means the Locker and the launch path share one grouping + selection path, so
 * the set of mods a launch can pick is exactly the set the Locker shows the
 * opt-in toggle on.
 */
export function planLaunchShuffle(options: LaunchShufflePlanOptions): RandomizePlan {
  const { mods, heroList, included, variants, rng } = options;
  if (included.size === 0) return { enableIds: [], disableIds: [], changedHeroes: [] };
  // homeGroupKind is the shared filing rule (see shuffleGroupKind): asking it
  // here is what keeps the planner's partition and the Locker's opt-in controls
  // from drifting apart. The hero list is deliberately not passed: the grouping
  // below resolves heroes itself, and mods it cannot place land in `unassigned`
  // and are dropped there.
  const lockerSkins = mods.filter((m) => homeGroupKind(m) === 'hero');
  const { map } = groupModsByCategory(lockerSkins, heroList);
  // Bucket over the full mod list, not lockerSkins: getEffectiveGlobalType is
  // exactly what lockerSkins filtered out, so the two group sets partition the
  // library instead of overlapping.
  const groups = groupGlobalMods(mods);
  const globalBuckets = new Map<GlobalModType, Mod[]>(
    GLOBAL_MOD_TYPE_ORDER.map((type) => [type, groups[type]])
  );
  return planRandomization({
    heroSkins: map,
    heroIds: [...map.keys()],
    included,
    globalBuckets,
    variants,
    rng,
  });
}
