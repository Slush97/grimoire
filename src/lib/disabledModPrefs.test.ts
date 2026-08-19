import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISABLED_FAVORITES_KEY,
  DISABLED_ORDER_KEY,
  createDisabledEntryComparator,
  modPreferenceKey,
  readStoredDisabledFavorites,
  readStoredDisabledOrder,
  toggleFavoriteKey,
  writeStoredDisabledFavorites,
  writeStoredDisabledOrder,
} from './disabledModPrefs';

type Item = { key: string; defaultRank: number };

const installLocalStorage = (values: Record<string, string> = {}) => {
  const storage = new Map(Object.entries(values));
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  };
  vi.stubGlobal('localStorage', localStorage);
  return { storage, localStorage };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('modPreferenceKey', () => {
  it('prefers GameBanana id, then sha256, then the current mod id', () => {
    expect(modPreferenceKey({ id: 'a', gameBananaId: 42, sha256: 'hash' })).toBe('gamebanana:42');
    expect(modPreferenceKey({ id: 'b', sha256: 'hash' })).toBe('sha256:hash');
    expect(modPreferenceKey({ id: 'c' })).toBe('mod:c');
  });

  it('is stable across the enabled/disabled boundary', () => {
    // mod.id is derived from the pakNN filename, so enabling or disabling a mod
    // changes it. A favorite set while enabled has to survive that rename, which
    // it does because both of the preferred key forms are rename-independent.
    expect(modPreferenceKey({ id: 'pak01_skin', gameBananaId: 42 })).toBe(
      modPreferenceKey({ id: 'skin.vpk.disabled', gameBananaId: 42 })
    );
    expect(modPreferenceKey({ id: 'pak01_local', sha256: 'abc' })).toBe(
      modPreferenceKey({ id: 'local.vpk.disabled', sha256: 'abc' })
    );
    // The volatile fallback is only reached when both stable ids are absent.
    expect(modPreferenceKey({ id: 'pak01_local', gameBananaId: 0, sha256: '' })).toBe(
      'mod:pak01_local'
    );
  });

  // The Installed page derives a group entry's key from its PRIMARY, which is
  // whichever member is currently enabled. A local variant group therefore has
  // to key off the group id: the per-file sha would move the key every time the
  // user switched variants, losing the card's star and list membership.
  it('shares one key across the variants of a local group', () => {
    const red = { id: 'pak04_dir', localGroupId: 'uuid-1', sha256: 'aaa' };
    const blue = { id: 'pak05_dir', localGroupId: 'uuid-1', sha256: 'bbb' };
    expect(modPreferenceKey(red)).toBe('localgroup:uuid-1');
    expect(modPreferenceKey(blue)).toBe(modPreferenceKey(red));
  });

  it('prefers an explicit local group over adopted GameBanana identity', () => {
    expect(modPreferenceKey({ id: 'a', gameBananaId: 42, localGroupId: 'uuid-1' })).toBe(
      'localgroup:uuid-1'
    );
  });
});

describe('storage keys', () => {
  it('are frozen literals', () => {
    // Renaming either key orphans every favorite and every manual disabled order
    // already saved by a shipped build. Treat these strings as a wire format.
    expect(DISABLED_FAVORITES_KEY).toBe('installedDisabledFavorites');
    expect(DISABLED_ORDER_KEY).toBe('installedDisabledOrder');
  });
});

describe('disabled preference loaders', () => {
  it('returns empty preferences when storage is absent or malformed', () => {
    installLocalStorage({
      [DISABLED_FAVORITES_KEY]: '{bad json',
      [DISABLED_ORDER_KEY]: JSON.stringify({ not: 'an array' }),
    });

    expect(readStoredDisabledFavorites()).toEqual(new Set());
    expect(readStoredDisabledOrder()).toEqual([]);
  });

  it('filters invalid values and removes duplicates', () => {
    installLocalStorage({
      [DISABLED_FAVORITES_KEY]: JSON.stringify(['a', 1, 'a', null, 'b']),
      [DISABLED_ORDER_KEY]: JSON.stringify(['b', false, 'a', 'b']),
    });

    expect(readStoredDisabledFavorites()).toEqual(new Set(['a', 'b']));
    expect(readStoredDisabledOrder()).toEqual(['b', 'a']);
  });

  it('writes normalized arrays to the expected keys', () => {
    const { storage } = installLocalStorage();

    writeStoredDisabledFavorites(['a', 'a', 'b']);
    writeStoredDisabledOrder(['b', 'a', 'b']);

    expect(JSON.parse(storage.get(DISABLED_FAVORITES_KEY) ?? 'null')).toEqual(['a', 'b']);
    expect(JSON.parse(storage.get(DISABLED_ORDER_KEY) ?? 'null')).toEqual(['b', 'a']);
  });
});

describe('toggleFavoriteKey', () => {
  it('adds the key when absent and removes it when present', () => {
    expect(toggleFavoriteKey(new Set(['a']), 'b')).toEqual(new Set(['a', 'b']));
    expect(toggleFavoriteKey(new Set(['a', 'b']), 'b')).toEqual(new Set(['a']));
  });

  it('does not mutate its input', () => {
    const current = new Set(['a']);
    const next = toggleFavoriteKey(current, 'b');

    expect(current).toEqual(new Set(['a']));
    expect(next).not.toBe(current);
  });
});

describe('createDisabledEntryComparator', () => {
  it('sorts favorites first, then manual order, then the existing default', () => {
    const items: Item[] = [
      { key: 'plain-first', defaultRank: 0 },
      { key: 'favorite-later', defaultRank: 3 },
      { key: 'ordered-later', defaultRank: 2 },
      { key: 'favorite-first', defaultRank: 1 },
    ];
    const comparator = createDisabledEntryComparator<Item>({
      favorites: new Set(['favorite-first', 'favorite-later']),
      manualOrder: ['favorite-later', 'ordered-later', 'favorite-first'],
      keyOf: (item) => item.key,
      fallback: (left, right) => left.defaultRank - right.defaultRank,
    });

    expect([...items].sort(comparator).map((item) => item.key)).toEqual([
      'favorite-later',
      'favorite-first',
      'ordered-later',
      'plain-first',
    ]);
  });

  it('keeps a favorite with no saved drag index in the favorite band', () => {
    // The case starring an enabled mod creates: the favorite is recorded while
    // the entry is not in the disabled section, so it has no manualOrder entry
    // when it later shows up there. It must still band above non-favorites, and
    // sort after favorites that do have a saved index.
    const items: Item[] = [
      { key: 'plain-ordered', defaultRank: 0 },
      { key: 'favorite-unordered', defaultRank: 3 },
      { key: 'favorite-ordered', defaultRank: 2 },
    ];
    const comparator = createDisabledEntryComparator<Item>({
      favorites: new Set(['favorite-unordered', 'favorite-ordered']),
      manualOrder: ['plain-ordered', 'favorite-ordered'],
      keyOf: (item) => item.key,
      fallback: (left, right) => left.defaultRank - right.defaultRank,
    });

    expect([...items].sort(comparator).map((item) => item.key)).toEqual([
      'favorite-ordered',
      'favorite-unordered',
      'plain-ordered',
    ]);
  });
});
