/**
 * Persisted per-entry preferences for the Installed page: the favorite (star)
 * set and the manual drag order of the disabled section.
 *
 * A favorite is settable from either section, so these keys must identify an
 * entry regardless of whether it is currently enabled or disabled. They do:
 * see modPreferenceKey. The stored order is only consumed by the disabled
 * section, because the enabled section is real load order (pakNN prefixes on
 * disk) and must never be re-sorted for display.
 *
 * The localStorage key strings are frozen: changing one orphans every
 * preference already saved by a shipped build.
 */
import type { Mod } from '../types/mod';

export const DISABLED_FAVORITES_KEY = 'installedDisabledFavorites';
export const DISABLED_ORDER_KEY = 'installedDisabledOrder';

type DisabledModIdentity = Pick<Mod, 'id' | 'gameBananaId' | 'sha256' | 'localGroupId'>;

/**
 * Persisted identity for an Installed entry, in either section. A GameBanana
 * group and a singleton from that same submission intentionally share a key, so
 * the preference survives the entry changing between grouped and ungrouped.
 *
 * A local variant group shares one key the same way, and for a sharper reason:
 * the page derives an entry's key from the group's PRIMARY, which is whichever
 * member happens to be enabled. Falling through to the per-file sha256 would
 * move the key every time the user switched variants, silently dropping the
 * card out of its lists and losing its star.
 *
 * The key is also stable across the enabled/disabled boundary: the GameBanana id
 * is immutable, the local group id is minted once and carried by the sidecar,
 * sha256 is content-addressed (the metadata sidecar carries it across the pakNN
 * rename that enabling/disabling performs), and only the last-resort `mod:<id>`
 * form is volatile, because mod.id is derived from the pakNN filename.
 */
export function modPreferenceKey(mod: DisabledModIdentity): string {
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    return `gamebanana:${mod.gameBananaId}`;
  }
  if (mod.localGroupId) {
    return `localgroup:${mod.localGroupId}`;
  }
  if (mod.sha256) {
    return `sha256:${mod.sha256}`;
  }
  return `mod:${mod.id}`;
}

function readStoredStringArray(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string')));
  } catch {
    return [];
  }
}

function writeStoredStringArray(key: string, values: Iterable<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(new Set(values))));
  } catch {
    // Preferences remain usable for this render when storage is unavailable.
  }
}

/**
 * Add or remove one key, returning a new set. Extracted so the star toggle is
 * unit-testable without rendering the Installed page, and so the caller's
 * setState updater can stay pure (StrictMode double-invokes it).
 */
export function toggleFavoriteKey(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function readStoredDisabledFavorites(): Set<string> {
  return new Set(readStoredStringArray(DISABLED_FAVORITES_KEY));
}

export function writeStoredDisabledFavorites(favorites: Iterable<string>): void {
  writeStoredStringArray(DISABLED_FAVORITES_KEY, favorites);
}

export function readStoredDisabledOrder(): string[] {
  return readStoredStringArray(DISABLED_ORDER_KEY);
}

export function writeStoredDisabledOrder(order: Iterable<string>): void {
  writeStoredStringArray(DISABLED_ORDER_KEY, order);
}

/**
 * Favorite status is the primary band. The saved drag order breaks ties
 * within each band, and the caller's existing sort is the final fallback.
 */
export function createDisabledEntryComparator<T>(options: {
  favorites: ReadonlySet<string>;
  manualOrder: readonly string[];
  keyOf: (item: T) => string;
  fallback: (left: T, right: T) => number;
}): (left: T, right: T) => number {
  const { favorites, manualOrder, keyOf, fallback } = options;
  const orderIndex = new Map(manualOrder.map((key, index) => [key, index]));

  return (left, right) => {
    const leftKey = keyOf(left);
    const rightKey = keyOf(right);
    const favoriteComparison = Number(favorites.has(rightKey)) - Number(favorites.has(leftKey));
    if (favoriteComparison !== 0) return favoriteComparison;

    const leftIndex = orderIndex.get(leftKey) ?? Number.POSITIVE_INFINITY;
    const rightIndex = orderIndex.get(rightKey) ?? Number.POSITIVE_INFINITY;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;

    return fallback(left, right);
  };
}
