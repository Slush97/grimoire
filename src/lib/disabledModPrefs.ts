import type { Mod } from '../types/mod';

export const DISABLED_FAVORITES_KEY = 'installedDisabledFavorites';
export const DISABLED_ORDER_KEY = 'installedDisabledOrder';

type DisabledModIdentity = Pick<Mod, 'id' | 'gameBananaId' | 'sha256'>;

/**
 * Persisted identity for an Installed entry. A GameBanana group and a
 * singleton from that same submission intentionally share a key, so the
 * preference survives the entry changing between grouped and ungrouped.
 */
export function disabledModPreferenceKey(mod: DisabledModIdentity): string {
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    return `gamebanana:${mod.gameBananaId}`;
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
