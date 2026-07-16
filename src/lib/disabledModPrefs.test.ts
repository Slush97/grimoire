import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISABLED_FAVORITES_KEY,
  DISABLED_ORDER_KEY,
  createDisabledEntryComparator,
  disabledModPreferenceKey,
  readStoredDisabledFavorites,
  readStoredDisabledOrder,
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

describe('disabledModPreferenceKey', () => {
  it('prefers GameBanana id, then sha256, then the current mod id', () => {
    expect(disabledModPreferenceKey({ id: 'a', gameBananaId: 42, sha256: 'hash' })).toBe('gamebanana:42');
    expect(disabledModPreferenceKey({ id: 'b', sha256: 'hash' })).toBe('sha256:hash');
    expect(disabledModPreferenceKey({ id: 'c' })).toBe('mod:c');
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
});
