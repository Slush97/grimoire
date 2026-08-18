/**
 * User-defined categories for the Locker's General drill-in: named buckets a
 * mod can be filed into, used purely to organize the Global/General view.
 *
 * This is a THIRD axis, orthogonal to the two documented in
 * docs/locker-global-mods.md:
 *
 *   - `globalType` (UI "General") answers "what kind of mod is this?"
 *   - `priorityMod` (UI "Global") answers "does this mod win?"
 *   - a category answers "which of my own piles did I put it in?"
 *
 * A category is a *view* concept and nothing else. Filing a mod never enables,
 * disables, moves, or reorders it, and this module never writes either of the
 * fields above. Mod Profiles are the feature for changing what is on.
 *
 * Membership is keyed by `modPreferenceKey` (see disabledModPrefs.ts), the same
 * identity the Installed page's lists use, so it survives the pakNN rename that
 * enabling/disabling performs and a GameBanana group shares a key with
 * singletons from the same submission.
 *
 * Orphans are kept, never pruned, including when a mod is deleted: a key with
 * no matching installed mod can come back (reinstalling a GameBanana mod
 * produces the same `gamebanana:<id>` key), and a temporarily unreadable game
 * folder must not silently destroy the user's organization. Counts shown in the
 * UI come from live entries only, so a stale key costs nothing but a few bytes.
 *
 * Deliberately a near-copy of lib/modLists.ts rather than a shared factory: the
 * Installed lists are shipped, and this feature is not worth the risk of
 * refactoring them under it. Folding the two together is a follow-up.
 *
 * The localStorage key string is frozen: changing it orphans every category
 * already saved by a shipped build. It is also separate from the Installed
 * lists' key on purpose, so the two surfaces never share buckets.
 */
import type { Mod } from '../types/mod';
import { modPreferenceKey } from './disabledModPrefs';

export const LOCKER_CATEGORIES_KEY = 'lockerCustomCategories';

/** Defensive clamp so pathological stored data can't blow out the tab rail. */
const MAX_NAME_LENGTH = 80;

export interface LockerCategory {
  /** Opaque, stable across renames. The active tab references this. */
  id: string;
  name: string;
  /** modPreferenceKey values. */
  keys: string[];
}

function normalizeName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

/** Case-insensitive name identity, so "Ivy" and "ivy" are the same category. */
function nameToken(name: string): string {
  return name.trim().toLowerCase();
}

function slugifyCategoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A readable id derived from the name, disambiguated against existing ids.
 * Derived rather than random so the store stays pure and unit-testable without
 * stubbing Date.now or Math.random. Ids are opaque: a non-latin name slugifies
 * to empty and falls back to the `category` seed, which is fine.
 */
function uniqueCategoryId(name: string, taken: ReadonlySet<string>): string {
  const seed = slugifyCategoryName(name) || 'category';
  if (!taken.has(seed)) return seed;
  // At most taken.size ids can collide, so this always terminates with a hit.
  for (let suffix = 2; suffix <= taken.size + 2; suffix += 1) {
    const candidate = `${seed}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return seed;
}

function normalizeCategory(value: unknown, taken: Set<string>): LockerCategory | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;

  const id = raw.id.trim();
  const name = normalizeName(raw.name);
  if (!id || !name || taken.has(id)) return null;

  const keys = Array.isArray(raw.keys)
    ? Array.from(new Set(raw.keys.filter((key): key is string => typeof key === 'string' && !!key)))
    : [];

  taken.add(id);
  return { id, name, keys };
}

export function readStoredLockerCategories(): LockerCategory[] {
  try {
    const stored = localStorage.getItem(LOCKER_CATEGORIES_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const taken = new Set<string>();
    return parsed
      .map((value) => normalizeCategory(value, taken))
      .filter((category): category is LockerCategory => category !== null);
  } catch {
    return [];
  }
}

export function writeStoredLockerCategories(categories: readonly LockerCategory[]): void {
  try {
    localStorage.setItem(LOCKER_CATEGORIES_KEY, JSON.stringify(categories));
  } catch {
    // Categories remain usable for this session when storage is unavailable.
  }
}

/**
 * Add a category, or return the existing one when the name is already taken.
 * Reusing the match is deliberate: "New category: Ivy" when an Ivy category
 * exists should file the mod under Ivy, not create a confusing second Ivy.
 *
 * Returns a null id for an empty name so the caller can no-op without having to
 * pre-validate.
 */
export function createCategory(
  categories: readonly LockerCategory[],
  rawName: string
): { categories: LockerCategory[]; id: string | null } {
  const name = normalizeName(rawName);
  if (!name) return { categories: [...categories], id: null };

  const token = nameToken(name);
  const existing = categories.find((category) => nameToken(category.name) === token);
  if (existing) return { categories: [...categories], id: existing.id };

  const id = uniqueCategoryId(name, new Set(categories.map((category) => category.id)));
  return { categories: [...categories, { id, name, keys: [] }], id };
}

/**
 * Rename in place. A blank name, an unknown id, or a name already used by a
 * *different* category all no-op, so the caller can bind this straight to an
 * input without validating first. Re-casing a category's own name is allowed.
 *
 * `applied` reports whether the rename took, because the caller needs to tell a
 * rejected name from an accepted one to restore the field and explain why.
 * Reported here rather than re-derived by the caller: comparing against the
 * normalized name outside this module means duplicating the trim-and-clamp
 * rules, which then rot silently the moment MAX_NAME_LENGTH changes.
 */
export function renameCategory(
  categories: readonly LockerCategory[],
  id: string,
  rawName: string
): { categories: LockerCategory[]; applied: boolean } {
  const name = normalizeName(rawName);
  if (!name) return { categories: [...categories], applied: false };
  if (!categories.some((category) => category.id === id)) {
    return { categories: [...categories], applied: false };
  }

  const token = nameToken(name);
  if (categories.some((category) => category.id !== id && nameToken(category.name) === token)) {
    return { categories: [...categories], applied: false };
  }

  return {
    categories: categories.map((category) => (category.id === id ? { ...category, name } : category)),
    applied: true,
  };
}

export function deleteCategory(
  categories: readonly LockerCategory[],
  id: string
): LockerCategory[] {
  return categories.filter((category) => category.id !== id);
}

/**
 * File one mod into one category, idempotently. Unknown ids and blank keys
 * no-op.
 *
 * Separate from toggleCategoryMembership because the create-a-category flow
 * must never un-file: createCategory reuses an existing category when the name
 * matches, so typing the name of a category the mod is already in would
 * otherwise toggle it back out, the opposite of what "New category" asks for.
 */
export function addCategoryMembership(
  categories: readonly LockerCategory[],
  id: string,
  prefKey: string
): LockerCategory[] {
  if (!prefKey) return [...categories];
  return categories.map((category) =>
    category.id === id && !category.keys.includes(prefKey)
      ? { ...category, keys: [...category.keys, prefKey] }
      : category
  );
}

/** Add or remove one mod from one category. Unknown ids no-op. */
export function toggleCategoryMembership(
  categories: readonly LockerCategory[],
  id: string,
  prefKey: string
): LockerCategory[] {
  if (!prefKey) return [...categories];
  return categories.map((category) => {
    if (category.id !== id) return category;
    const has = category.keys.includes(prefKey);
    return {
      ...category,
      keys: has
        ? category.keys.filter((key) => key !== prefKey)
        : [...category.keys, prefKey],
    };
  });
}

/**
 * prefKey -> category ids. Built once per categories change so the per-card
 * menu stays a cheap Map lookup instead of scanning every category.
 */
export function buildCategoryMembershipIndex(
  categories: readonly LockerCategory[]
): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const category of categories) {
    for (const key of category.keys) {
      const ids = byKey.get(key);
      if (ids) ids.push(category.id);
      else byKey.set(key, [category.id]);
    }
  }
  return byKey;
}

/**
 * Live member count per category id, counted from the keys actually present in
 * the library. Orphaned keys are excluded, so the count tracks what is
 * installed rather than what was ever filed.
 *
 * It counts distinct keys, not cards, exactly like the Installed lists: the two
 * differ only when two physically distinct installs share content identity (the
 * same local VPK installed twice), and filing one of them files both.
 *
 * Categories with no live members still get a 0, which is what keeps a freshly
 * created (empty) category visible in the tab rail.
 */
export function countLiveCategoryMembers(
  categories: readonly LockerCategory[],
  liveKeys: ReadonlySet<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const category of categories) {
    let count = 0;
    for (const key of category.keys) {
      if (liveKeys.has(key)) count += 1;
    }
    counts.set(category.id, count);
  }
  return counts;
}

/** The mod fields the grouping helper needs: identity, plus the sort keys. */
export type CategorizableMod = Pick<Mod, 'id' | 'gameBananaId' | 'sha256' | 'name' | 'enabled'>;

/**
 * category id -> the installed mods filed into it, enabled first then by name.
 *
 * Sorted like the classification tabs (groupGlobalMods) so a custom tab reads
 * the same as the builtin ones. Orphaned keys simply contribute nothing, and a
 * key shared by two installed cards yields both, because both are real cards
 * the user can act on.
 */
export function groupCategoryMods<T extends CategorizableMod>(
  categories: readonly LockerCategory[],
  mods: readonly T[]
): Map<string, T[]> {
  const byKey = new Map<string, T[]>();
  for (const mod of mods) {
    const key = modPreferenceKey(mod);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(mod);
    else byKey.set(key, [mod]);
  }

  const groups = new Map<string, T[]>();
  for (const category of categories) {
    const members: T[] = [];
    for (const key of category.keys) {
      const bucket = byKey.get(key);
      if (bucket) members.push(...bucket);
    }
    members.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    groups.set(category.id, members);
  }
  return groups;
}
