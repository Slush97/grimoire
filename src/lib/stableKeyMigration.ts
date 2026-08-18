import type { Mod } from '../types/mod';
import {
  readStoredDisabledFavorites,
  readStoredDisabledOrder,
  writeStoredDisabledFavorites,
  writeStoredDisabledOrder,
} from './disabledModPrefs';
import { readStoredModLists, writeStoredModLists, type ModList } from './modLists';
import {
  readStoredLockerCategories,
  writeStoredLockerCategories,
  type LockerCategory,
} from './lockerCategories';
import {
  readStoredShuffleIncluded,
  readStoredShuffleVariants,
  writeStoredShuffleIncluded,
  writeStoredShuffleVariants,
  type VariantChoice,
} from './lockerRandomizer';

type KeyedMod = Pick<Mod, 'id' | 'enabled' | 'priority'>;

interface MigrationEdge {
  source: string;
  destination: string;
  sourceRank: number;
  destinationRank: number;
  legacy: boolean;
}

/**
 * A logical-key topology change. One source can split into several destinations
 * (detaching from a group), and several sources can merge into one destination
 * (forming or joining a group).
 */
export interface StableKeyMigrationPlan {
  destinationsBySource: ReadonlyMap<string, readonly string[]>;
  sourcesByDestination: ReadonlyMap<string, readonly string[]>;
  liveSourceKeys: ReadonlySet<string>;
  liveDestinationKeys: ReadonlySet<string>;
}

export interface CreateStableKeyMigrationOptions<T extends KeyedMod> {
  before: readonly T[];
  after: readonly T[];
  keyOf: (mod: T) => string;
  /** Former key forms that shipped for an already-canonical `after` mod. */
  legacyKeysOf?: (mod: T) => readonly string[];
}

function primaryRanks<T extends KeyedMod>(mods: readonly T[]): Map<string, number> {
  return new Map(
    mods
      .map((mod, index) => ({ mod, index }))
      .sort(
        (left, right) =>
          Number(!left.mod.enabled) - Number(!right.mod.enabled) ||
          left.mod.priority - right.mod.priority ||
          left.index - right.index
      )
      .map(({ mod }, rank) => [mod.id, rank])
  );
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key);
  if (values) {
    if (!values.includes(value)) values.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Build a deterministic migration from the same installed files before and
 * after a metadata mutation. Mod ids do not change during local grouping, so
 * they are the join key. Edges are ranked around the old/new primary member:
 * this gives singular preferences (image and variant policy) an unambiguous
 * owner when a group splits or several entries merge.
 */
export function createStableKeyMigrationPlan<T extends KeyedMod>(
  options: CreateStableKeyMigrationOptions<T>
): StableKeyMigrationPlan {
  const { before, after, keyOf, legacyKeysOf = () => [] } = options;
  const beforeById = new Map(before.map((mod) => [mod.id, mod]));
  const beforeRank = primaryRanks(before);
  const afterRank = primaryRanks(after);
  const edges: MigrationEdge[] = [];

  for (const mod of after) {
    const destination = keyOf(mod);
    const old = beforeById.get(mod.id);
    if (old) {
      edges.push({
        source: keyOf(old),
        destination,
        sourceRank: beforeRank.get(old.id) ?? Number.MAX_SAFE_INTEGER,
        destinationRank: afterRank.get(mod.id) ?? Number.MAX_SAFE_INTEGER,
        legacy: false,
      });
    }
    for (const source of legacyKeysOf(mod)) {
      if (!source || source === destination) continue;
      edges.push({
        source,
        destination,
        sourceRank: Number.MAX_SAFE_INTEGER,
        destinationRank: afterRank.get(mod.id) ?? Number.MAX_SAFE_INTEGER,
        legacy: true,
      });
    }
  }

  const destinationsBySource = new Map<string, string[]>();
  for (const edge of [...edges].sort(
    (left, right) =>
      left.sourceRank - right.sourceRank ||
      left.destinationRank - right.destinationRank ||
      Number(left.legacy) - Number(right.legacy)
  )) {
    pushUnique(destinationsBySource, edge.source, edge.destination);
  }

  const sourcesByDestination = new Map<string, string[]>();
  for (const edge of [...edges].sort(
    (left, right) =>
      left.destinationRank - right.destinationRank ||
      Number(left.legacy) - Number(right.legacy) ||
      left.sourceRank - right.sourceRank
  )) {
    pushUnique(sourcesByDestination, edge.destination, edge.source);
  }

  return {
    destinationsBySource,
    sourcesByDestination,
    liveSourceKeys: new Set(before.map(keyOf)),
    liveDestinationKeys: new Set(after.map(keyOf)),
  };
}

/** Presence-like state uses union semantics. A split copies membership to each
 * new entry; a merge is true when any source was true. Retired source keys are
 * removed, while a source still represented by a live entry is retained. */
export function migrateKeySet(
  current: ReadonlySet<string>,
  plan: StableKeyMigrationPlan
): Set<string> {
  const next = new Set(current);
  for (const source of current) {
    const destinations = plan.destinationsBySource.get(source);
    if (!destinations) continue;
    for (const destination of destinations) next.add(destination);
    if (!plan.liveDestinationKeys.has(source)) next.delete(source);
  }
  return next;
}

/** Ordered state replaces a source in place. Splits expand at the old slot in
 * primary-first order; merges occupy the earliest source slot. */
export function migrateKeyOrder(
  current: readonly string[],
  plan: StableKeyMigrationPlan
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  const append = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      next.push(key);
    }
  };

  for (const source of current) {
    const destinations = plan.destinationsBySource.get(source);
    if (!destinations) {
      append(source);
      continue;
    }
    if (plan.liveDestinationKeys.has(source)) append(source);
    for (const destination of destinations) append(destination);
  }
  return next;
}

export interface MigratedKeyedValues<T> {
  values: Map<string, T>;
  /** Source selected for a newly populated destination. */
  sourceForDestination: Map<string, string>;
}

/**
 * Singular state uses primary-wins semantics. An existing destination value is
 * never overwritten. Otherwise the new primary member's old key wins a merge.
 * With `exclusiveSource`, a retired source transfers only to the old primary's
 * destination rather than cloning across siblings. A source still owned by a
 * surviving entry stays there and is never copied to a detached member.
 */
export function migrateKeyedValues<T>(
  current: ReadonlyMap<string, T>,
  plan: StableKeyMigrationPlan,
  options: { exclusiveSource?: boolean } = {}
): MigratedKeyedValues<T> {
  const values = new Map(current);
  const sourceForDestination = new Map<string, string>();

  for (const source of plan.destinationsBySource.keys()) {
    if (!plan.liveDestinationKeys.has(source)) values.delete(source);
  }

  for (const [destination, sources] of plan.sourcesByDestination) {
    // A value belonging to an entry that existed before the mutation is an
    // intentional destination preference (joining that group must not replace
    // its art/policy). A merely orphaned destination key does not beat the
    // visible source entry during a split; allowing it to win would resurrect
    // stale state left by an older grouping cycle.
    const destinationWasLive = plan.liveSourceKeys.has(destination);
    const hasRetiredLiveSource = sources.some(
      (source) => source !== destination && plan.liveSourceKeys.has(source)
    );
    if (current.has(destination) && (destinationWasLive || !hasRetiredLiveSource)) continue;
    const source = sources.find((candidate) => {
      if (!current.has(candidate)) return false;
      if (!options.exclusiveSource) return true;
      const preferredDestination = plan.liveDestinationKeys.has(candidate)
        ? candidate
        : plan.destinationsBySource.get(candidate)?.[0];
      return preferredDestination === destination;
    });
    if (source === undefined) continue;
    values.set(destination, current.get(source) as T);
    sourceForDestination.set(destination, source);
  }

  return { values, sourceForDestination };
}

function migrateMemberships<T extends { keys: string[] }>(
  collections: readonly T[],
  plan: StableKeyMigrationPlan
): T[] {
  return collections.map((collection) => ({
    ...collection,
    keys: migrateKeyOrder(collection.keys, plan),
  }));
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function mapsEqual<T>(left: ReadonlyMap<string, T>, right: ReadonlyMap<string, T>): boolean {
  return (
    left.size === right.size &&
    [...left].every(([key, value]) => Object.is(value, right.get(key)))
  );
}

export const STABLE_KEY_PREFERENCES_MIGRATED_EVENT =
  'grimoire:stable-key-preferences-migrated' as const;

export interface StableKeyPreferencesMigratedDetail {
  disabledFavorites: Set<string>;
  disabledOrder: string[];
  modLists: ModList[];
  lockerCategories: LockerCategory[];
}

declare global {
  interface WindowEventMap {
    'grimoire:stable-key-preferences-migrated': CustomEvent<StableKeyPreferencesMigratedDetail>;
  }
}

/** Migrate every renderer-persisted preference that keys a logical mod/skin. */
export function migrateStoredStableKeyPreferences(
  preferencePlan: StableKeyMigrationPlan,
  shufflePlan: StableKeyMigrationPlan = preferencePlan
): {
  changed: boolean;
  detail: StableKeyPreferencesMigratedDetail;
  shuffleIncluded: Set<string>;
  shuffleVariants: Map<string, VariantChoice>;
} {
  const oldFavorites = readStoredDisabledFavorites();
  const oldOrder = readStoredDisabledOrder();
  const oldLists = readStoredModLists();
  const oldCategories = readStoredLockerCategories();
  const oldIncluded = readStoredShuffleIncluded();
  const oldVariants = readStoredShuffleVariants();

  const disabledFavorites = migrateKeySet(oldFavorites, preferencePlan);
  const disabledOrder = migrateKeyOrder(oldOrder, preferencePlan);
  const modLists = migrateMemberships(oldLists, preferencePlan);
  const lockerCategories = migrateMemberships(oldCategories, preferencePlan) as LockerCategory[];
  const shuffleIncluded = migrateKeySet(oldIncluded, shufflePlan);
  const shuffleVariants = migrateKeyedValues(oldVariants, shufflePlan, {
    exclusiveSource: true,
  }).values;

  const listsChanged = JSON.stringify(modLists) !== JSON.stringify(oldLists);
  const categoriesChanged = JSON.stringify(lockerCategories) !== JSON.stringify(oldCategories);
  const changed =
    !setsEqual(disabledFavorites, oldFavorites) ||
    JSON.stringify(disabledOrder) !== JSON.stringify(oldOrder) ||
    listsChanged ||
    categoriesChanged ||
    !setsEqual(shuffleIncluded, oldIncluded) ||
    !mapsEqual(shuffleVariants, oldVariants);

  if (!setsEqual(disabledFavorites, oldFavorites)) writeStoredDisabledFavorites(disabledFavorites);
  if (JSON.stringify(disabledOrder) !== JSON.stringify(oldOrder)) writeStoredDisabledOrder(disabledOrder);
  if (listsChanged) writeStoredModLists(modLists);
  if (categoriesChanged) writeStoredLockerCategories(lockerCategories);
  if (!setsEqual(shuffleIncluded, oldIncluded)) writeStoredShuffleIncluded(shuffleIncluded);
  if (!mapsEqual(shuffleVariants, oldVariants)) writeStoredShuffleVariants(shuffleVariants);

  const detail = {
    disabledFavorites,
    disabledOrder,
    modLists,
    lockerCategories: lockerCategories.map((category) => ({
      ...category,
      keys: [...category.keys],
    })),
  };
  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<StableKeyPreferencesMigratedDetail>(
        STABLE_KEY_PREFERENCES_MIGRATED_EVENT,
        { detail }
      )
    );
  }
  return { changed, detail, shuffleIncluded, shuffleVariants };
}
