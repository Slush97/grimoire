import type { GameBananaMod, GameBananaModsResponse } from '../types/gamebanana';

export type BrowseSortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';

export const BROWSE_REQUEST_SIZE = 50;
const BROWSE_CACHE_MAX_AGE_MS = 5 * 60_000;

export function browseCacheIsFresh(fetchedAt?: number, now = Date.now()): boolean {
  return typeof fetchedAt === 'number' && fetchedAt > 0 && now >= fetchedAt && now - fetchedAt < BROWSE_CACHE_MAX_AGE_MS;
}

/** Search may return 15 records per page even when the index accepts 50.
 * Short nonempty pages can still have more results according to the metadata. */
export function browsePageHasMore(response: Pick<GameBananaModsResponse, 'records' | 'totalCount' | 'perPage'>, page: number, requestedSize = BROWSE_REQUEST_SIZE): boolean {
  const size = Number.isFinite(response.perPage) && response.perPage > 0 ? response.perPage : requestedSize;
  return response.records.length > 0 && page * size < response.totalCount;
}

/** Hold an incomplete row in memory until more records arrive. At the end,
 * include every remaining record even when there are too few to fill a row. */
export function completeBrowseRowCount(count: number, columns: number, hasMore: boolean): number {
  const width = Math.max(1, Math.floor(columns));
  return hasMore ? Math.floor(count / width) * width : count;
}

/** Refresh repeated records without duplicating cards. Explicit sorts keep
 * the loaded portion ordered as metadata changes, without another API call. */
export function mergeBrowseMods(previous: readonly GameBananaMod[], incoming: readonly GameBananaMod[], sort: BrowseSortOption): GameBananaMod[] {
  const merged: GameBananaMod[] = [];
  const indexes = new Map<string, number>();
  for (const mod of [...previous, ...incoming]) {
    const key = browseModKey(mod);
    const index = indexes.get(key);
    if (index === undefined) { indexes.set(key, merged.length); merged.push(mod); continue; }
    const existing = merged[index];
    if (existing.dateModified && mod.dateModified && mod.dateModified < existing.dateModified) continue;
    merged[index] = { ...existing, ...Object.fromEntries(Object.entries(mod).filter(([, value]) => value !== undefined)) };
  }
  if (sort === 'default') return merged;
  const score = (mod: GameBananaMod) => sort === 'recent' ? mod.dateAdded ?? 0
    : sort === 'popular' ? mod.likeCount ?? 0 : sort === 'views' ? mod.viewCount ?? 0 : mod.dateModified ?? 0;
  return merged.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : score(b) - score(a))
    || b.id - a.id || browseModSection(a).localeCompare(browseModSection(b)));
}

export type BrowseSections = [string, ...string[]];

export function toggleBrowseSection(selected: BrowseSections, section: string): BrowseSections {
  if (!selected.includes(section)) return [...selected, section];
  const remaining = selected.filter((value) => value !== section);
  const [first, ...rest] = remaining;
  return first ? [first, ...rest] : selected;
}

export function browseModSection(mod: Pick<GameBananaMod, 'section' | 'profileUrl'>): string {
  if (mod.section) return mod.section;
  const path = mod.profileUrl.match(/\/(mods|sounds|wips)\//i)?.[1]?.toLowerCase();
  return path === 'sounds' ? 'Sound' : path === 'wips' ? 'Wip' : 'Mod';
}

export function browseModKey(mod: Pick<GameBananaMod, 'id' | 'section' | 'profileUrl'>): string {
  return `${browseModSection(mod)}:${mod.id}`;
}
