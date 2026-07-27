/**
 * User-authored lists for the Installed page: named buckets a mod can belong
 * to, used purely to organize and filter the library.
 *
 * Lists are deliberately a *view* concept. They never enable, disable, or
 * reorder anything: that is what Mod Profiles are for, and a list that also
 * toggled mods would be a profile with a worse name. The only thing a list
 * does is narrow which cards the Installed grid shows.
 *
 * Membership is keyed by `modPreferenceKey` (see disabledModPrefs.ts), so it
 * survives the pakNN rename that enabling/disabling performs, and a GameBanana
 * group shares a key with singletons from the same submission.
 *
 * Orphans are kept, never pruned, including when a mod is deleted. A key with no
 * matching installed mod can come back: reinstalling a GameBanana mod produces
 * the same `gamebanana:<id>` key, and a temporarily unreadable game folder must
 * not silently destroy the user's organization. Pruning on delete would also be
 * wrong for groups, which share one key across every variant of a submission:
 * deleting a single variant would unfile the whole group. Counts shown in the UI
 * come from live entries only, so a stale key costs nothing but a few bytes.
 *
 * The localStorage key string is frozen: changing it orphans every list already
 * saved by a shipped build.
 */

export const MOD_LISTS_KEY = 'installedModLists';

/** Defensive clamp so pathological stored data can't blow out the filter UI. */
const MAX_NAME_LENGTH = 80;

export interface ModList {
  /** Opaque, stable across renames. Filter selections reference this. */
  id: string;
  name: string;
  /** modPreferenceKey values. */
  keys: string[];
}

function normalizeName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

/** Case-insensitive name identity, so "Ivy" and "ivy" are the same list. */
function nameToken(name: string): string {
  return name.trim().toLowerCase();
}

function slugifyListName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A readable id derived from the name, disambiguated against existing ids.
 * Derived rather than random so the store stays pure and unit-testable without
 * stubbing Date.now or Math.random. Ids are opaque: a non-latin name slugifies
 * to empty and falls back to the `list` seed, which is fine.
 */
function uniqueListId(name: string, taken: ReadonlySet<string>): string {
  const seed = slugifyListName(name) || 'list';
  if (!taken.has(seed)) return seed;
  // At most taken.size ids can collide, so this always terminates with a hit.
  for (let suffix = 2; suffix <= taken.size + 2; suffix += 1) {
    const candidate = `${seed}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return seed;
}

function normalizeList(value: unknown, taken: Set<string>): ModList | null {
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

export function readStoredModLists(): ModList[] {
  try {
    const stored = localStorage.getItem(MOD_LISTS_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const taken = new Set<string>();
    return parsed
      .map((value) => normalizeList(value, taken))
      .filter((list): list is ModList => list !== null);
  } catch {
    return [];
  }
}

export function writeStoredModLists(lists: readonly ModList[]): void {
  try {
    localStorage.setItem(MOD_LISTS_KEY, JSON.stringify(lists));
  } catch {
    // Lists remain usable for this session when storage is unavailable.
  }
}

/**
 * Add a list, or return the existing one when the name is already taken.
 * Reusing the match is deliberate: "New list: Ivy" when an Ivy list exists
 * should put the mod in Ivy, not create a confusing second Ivy.
 *
 * Returns a null id for an empty name so the caller can no-op without having to
 * pre-validate.
 */
export function createList(
  lists: readonly ModList[],
  rawName: string
): { lists: ModList[]; id: string | null } {
  const name = normalizeName(rawName);
  if (!name) return { lists: [...lists], id: null };

  const token = nameToken(name);
  const existing = lists.find((list) => nameToken(list.name) === token);
  if (existing) return { lists: [...lists], id: existing.id };

  const id = uniqueListId(name, new Set(lists.map((list) => list.id)));
  return { lists: [...lists, { id, name, keys: [] }], id };
}

/**
 * Rename in place. A blank name, an unknown id, or a name already used by a
 * *different* list all no-op, so the caller can bind this straight to an input
 * without validating first. Re-casing a list's own name is allowed.
 */
export function renameList(lists: readonly ModList[], id: string, rawName: string): ModList[] {
  const name = normalizeName(rawName);
  if (!name) return [...lists];
  if (!lists.some((list) => list.id === id)) return [...lists];

  const token = nameToken(name);
  if (lists.some((list) => list.id !== id && nameToken(list.name) === token)) return [...lists];

  return lists.map((list) => (list.id === id ? { ...list, name } : list));
}

export function deleteList(lists: readonly ModList[], id: string): ModList[] {
  return lists.filter((list) => list.id !== id);
}

/** Add or remove one mod from one list. Unknown ids no-op. */
export function toggleListMembership(
  lists: readonly ModList[],
  id: string,
  prefKey: string
): ModList[] {
  if (!prefKey) return [...lists];
  return lists.map((list) => {
    if (list.id !== id) return list;
    const has = list.keys.includes(prefKey);
    return {
      ...list,
      keys: has ? list.keys.filter((key) => key !== prefKey) : [...list.keys, prefKey],
    };
  });
}

/**
 * prefKey -> list ids. Built once per lists change so the per-entry filter and
 * card-prop passes stay cheap Map lookups instead of scanning every list.
 */
export function buildListMembershipIndex(lists: readonly ModList[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const list of lists) {
    for (const key of list.keys) {
      const ids = byKey.get(key);
      if (ids) ids.push(list.id);
      else byKey.set(key, [list.id]);
    }
  }
  return byKey;
}

/**
 * Live member count per list id, counted from the keys actually present in the
 * library. Orphaned keys are excluded so a list that reads "3" always has three
 * cards behind it. Lists with no live members are still present with a 0, which
 * is what keeps a freshly created (empty) list visible in the filter popover.
 */
export function countLiveMembers(
  lists: readonly ModList[],
  liveKeys: ReadonlySet<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of lists) {
    let count = 0;
    for (const key of list.keys) {
      if (liveKeys.has(key)) count += 1;
    }
    counts.set(list.id, count);
  }
  return counts;
}
