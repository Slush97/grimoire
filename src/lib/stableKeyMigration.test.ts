import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import { DISABLED_FAVORITES_KEY, DISABLED_ORDER_KEY, modPreferenceKey } from './disabledModPrefs';
import { LOCKER_CATEGORIES_KEY } from './lockerCategories';
import {
  SHUFFLE_INCLUDED_KEY,
  SHUFFLE_VARIANT_KEY,
  shuffleSkinKey,
} from './lockerRandomizer';
import { MOD_LISTS_KEY } from './modLists';
import {
  STABLE_KEY_PREFERENCES_MIGRATED_EVENT,
  createStableKeyMigrationPlan,
  migrateKeyOrder,
  migrateKeySet,
  migrateKeyedValues,
  migrateStoredStableKeyPreferences,
} from './stableKeyMigration';

function mod(
  id: string,
  options: Partial<Mod> & { sha256?: string; localGroupId?: string } = {}
): Mod {
  return {
    id,
    name: id,
    fileName: `${id}.vpk`,
    path: `/mods/${id}.vpk`,
    metaKey: `${id}.vpk`,
    enabled: false,
    priority: 10,
    size: 1,
    installedAt: '2026-01-01T00:00:00Z',
    ...options,
  };
}

function plan(before: Mod[], after: Mod[]) {
  return createStableKeyMigrationPlan({ before, after, keyOf: modPreferenceKey });
}

function installLocalStorage(values: Record<string, unknown>) {
  const storage = new Map(
    Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)])
  );
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  return storage;
}

afterEach(() => vi.unstubAllGlobals());

describe('stable-key migration topology', () => {
  it('unions presence state and places a merge at the earliest old order slot', () => {
    const before = [mod('a', { sha256: 'a' }), mod('b', { sha256: 'b' })];
    const after = before.map((item) => ({ ...item, localGroupId: 'g' }));
    const migration = plan(before, after);

    expect(migrateKeySet(new Set(['sha256:b', 'unrelated']), migration)).toEqual(
      new Set(['localgroup:g', 'unrelated'])
    );
    expect(
      migrateKeyOrder(['unrelated-1', 'sha256:b', 'unrelated-2', 'sha256:a'], migration)
    ).toEqual(['unrelated-1', 'localgroup:g', 'unrelated-2']);
  });

  it('duplicates membership on a split, removes the retired group key, and orders primary first', () => {
    const before = [
      mod('a', { sha256: 'a', localGroupId: 'g', enabled: false, priority: 1 }),
      mod('b', { sha256: 'b', localGroupId: 'g', enabled: true, priority: 8 }),
    ];
    const after = before.map((item) => ({ ...item, localGroupId: undefined }));
    const migration = plan(before, after);

    expect(migrateKeySet(new Set(['localgroup:g']), migration)).toEqual(
      new Set(['sha256:b', 'sha256:a'])
    );
    expect(migrateKeyOrder(['x', 'localgroup:g', 'y'], migration)).toEqual([
      'x',
      'sha256:b',
      'sha256:a',
      'y',
    ]);
  });

  it('retains a source key still owned by survivors while copying state to a detached member', () => {
    const before = [
      mod('a', { sha256: 'a', localGroupId: 'g' }),
      mod('b', { sha256: 'b', localGroupId: 'g' }),
      mod('c', { sha256: 'c', localGroupId: 'g' }),
    ];
    const after = before.map((item) =>
      item.id === 'c' ? { ...item, localGroupId: undefined } : item
    );
    const migration = plan(before, after);

    expect(migrateKeySet(new Set(['localgroup:g']), migration)).toEqual(
      new Set(['localgroup:g', 'sha256:c'])
    );
  });

  it('lets existing destination values win a merge and removes retired sources', () => {
    const before = [mod('a', { sha256: 'a' }), mod('b', { localGroupId: 'g' })];
    const after = before.map((item) => ({ ...item, localGroupId: 'g' }));
    const migration = plan(before, after);
    const migrated = migrateKeyedValues(
      new Map([
        ['sha256:a', 'source'],
        ['localgroup:g', 'destination'],
      ]),
      migration
    );

    expect(migrated.values).toEqual(new Map([['localgroup:g', 'destination']]));
    expect(migrated.sourceForDestination).toEqual(new Map());
  });

  it('overwrites an orphaned destination during a split instead of resurrecting stale state', () => {
    const before = [
      mod('a', { sha256: 'a', localGroupId: 'g', enabled: true }),
      mod('b', { sha256: 'b', localGroupId: 'g' }),
    ];
    const after = before.map((item) => ({ ...item, localGroupId: undefined }));
    const migrated = migrateKeyedValues(
      new Map([
        ['localgroup:g', 'current-group-image'],
        ['sha256:a', 'stale-old-image'],
      ]),
      plan(before, after),
      { exclusiveSource: true }
    );

    expect(migrated.values).toEqual(new Map([['sha256:a', 'current-group-image']]));
  });

  it('moves singular state only to the old primary when a group splits', () => {
    const before = [
      mod('a', { sha256: 'a', localGroupId: 'g', enabled: true, priority: 7 }),
      mod('b', { sha256: 'b', localGroupId: 'g', enabled: false, priority: 1 }),
    ];
    const after = before.map((item) => ({ ...item, localGroupId: undefined }));
    const migrated = migrateKeyedValues(
      new Map([['localgroup:g', 'image']]),
      plan(before, after),
      { exclusiveSource: true }
    );

    expect(migrated.values).toEqual(new Map([['sha256:a', 'image']]));
    expect(migrated.sourceForDestination).toEqual(
      new Map([['sha256:a', 'localgroup:g']])
    );
  });

  it('does not clone singular state when the source group still has survivors', () => {
    const before = [
      mod('a', { sha256: 'a', localGroupId: 'g', enabled: false }),
      mod('b', { sha256: 'b', localGroupId: 'g', enabled: true }),
      mod('c', { sha256: 'c', localGroupId: 'g', enabled: false }),
    ];
    const after = before.map((item) =>
      item.id === 'b' ? { ...item, localGroupId: undefined } : item
    );
    const migrated = migrateKeyedValues(
      new Map([['localgroup:g', 'image']]),
      plan(before, after),
      { exclusiveSource: true }
    );

    expect(migrated.values).toEqual(new Map([['localgroup:g', 'image']]));
    expect(migrated.sourceForDestination).toEqual(new Map());
  });

  it('copies a legacy alias to its canonical key but retains it when another live entry owns it', () => {
    const grouped = mod('grouped', {
      gameBananaId: 42,
      localGroupId: 'g',
      sha256: 'a',
    });
    const standalone = mod('standalone', { gameBananaId: 42, sha256: 'b' });
    const migration = createStableKeyMigrationPlan({
      before: [],
      after: [grouped, standalone],
      keyOf: modPreferenceKey,
      legacyKeysOf: (item) => (item.localGroupId ? [`gamebanana:${item.gameBananaId}`] : []),
    });

    expect(migrateKeySet(new Set(['gamebanana:42']), migration)).toEqual(
      new Set(['gamebanana:42', 'localgroup:g'])
    );
  });

  it('recovers the former standalone sha key for groups created by the buggy build', () => {
    const grouped = mod('grouped', { localGroupId: 'g', sha256: 'old-sha' });
    const migration = createStableKeyMigrationPlan({
      before: [],
      after: [grouped],
      keyOf: modPreferenceKey,
      legacyKeysOf: (item) => [
        modPreferenceKey({ ...item, localGroupId: undefined }),
      ],
    });

    expect(migrateKeySet(new Set(['sha256:old-sha']), migration)).toEqual(
      new Set(['localgroup:g'])
    );
  });
});

describe('persisted preference migration', () => {
  it('migrates every stable-keyed store and dispatches the Installed refresh event', () => {
    const before = [mod('a', { sha256: 'a' }), mod('b', { sha256: 'b' })];
    const after = before.map((item) => ({ ...item, localGroupId: 'g' }));
    const preferencePlan = plan(before, after);
    const shufflePlan = createStableKeyMigrationPlan({
      before,
      after,
      keyOf: shuffleSkinKey,
    });
    const storage = installLocalStorage({
      [DISABLED_FAVORITES_KEY]: ['sha256:a'],
      [DISABLED_ORDER_KEY]: ['x', 'sha256:b', 'sha256:a'],
      [MOD_LISTS_KEY]: [{ id: 'skins', name: 'Skins', keys: ['sha256:a', 'sha256:b'] }],
      [LOCKER_CATEGORIES_KEY]: [{ id: 'ivy', name: 'Ivy', keys: ['sha256:b'] }],
      [SHUFFLE_INCLUDED_KEY]: ['sha256:a'],
      [SHUFFLE_VARIANT_KEY]: { 'sha256:a': 'random', 'sha256:b': { fileId: 2 } },
    });
    const dispatchEvent = vi.fn();
    class FakeCustomEvent<T> {
      type: string;
      detail: T;
      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    }
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', FakeCustomEvent);

    const migrated = migrateStoredStableKeyPreferences(preferencePlan, shufflePlan);

    expect(migrated.changed).toBe(true);
    expect(JSON.parse(storage.get(DISABLED_FAVORITES_KEY) ?? 'null')).toEqual(['localgroup:g']);
    expect(JSON.parse(storage.get(DISABLED_ORDER_KEY) ?? 'null')).toEqual(['x', 'localgroup:g']);
    expect(JSON.parse(storage.get(MOD_LISTS_KEY) ?? 'null')[0].keys).toEqual(['localgroup:g']);
    expect(JSON.parse(storage.get(LOCKER_CATEGORIES_KEY) ?? 'null')[0].keys).toEqual([
      'localgroup:g',
    ]);
    expect(JSON.parse(storage.get(SHUFFLE_INCLUDED_KEY) ?? 'null')).toEqual(['localgroup:g']);
    // New primary `a` wins the collision; b's policy cannot unexpectedly
    // resurrect if that file is detached again later.
    expect(JSON.parse(storage.get(SHUFFLE_VARIANT_KEY) ?? 'null')).toEqual({
      'localgroup:g': 'random',
    });
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0].type).toBe(STABLE_KEY_PREFERENCES_MIGRATED_EVENT);
    expect(dispatchEvent.mock.calls[0][0].detail.disabledFavorites).toEqual(
      new Set(['localgroup:g'])
    );
    expect(dispatchEvent.mock.calls[0][0].detail.lockerCategories).toEqual([
      { id: 'ivy', name: 'Ivy', keys: ['localgroup:g'] },
    ]);

    const eventCategories = dispatchEvent.mock.calls[0][0].detail.lockerCategories;
    eventCategories[0].keys.push('mutated-by-listener');
    expect(migrated.detail.lockerCategories[0].keys).toEqual([
      'localgroup:g',
      'mutated-by-listener',
    ]);
    expect(JSON.parse(storage.get(LOCKER_CATEGORIES_KEY) ?? 'null')[0].keys).toEqual([
      'localgroup:g',
    ]);
  });

  it('does not rewrite storage or dispatch when only identity edges are present', () => {
    const only = mod('a', { sha256: 'a' });
    const storage = installLocalStorage({ [DISABLED_FAVORITES_KEY]: ['sha256:a'] });
    const setItem = localStorage.setItem as ReturnType<typeof vi.fn>;
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });

    const result = migrateStoredStableKeyPreferences(plan([only], [only]));

    expect(result.changed).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(JSON.parse(storage.get(DISABLED_FAVORITES_KEY) ?? 'null')).toEqual(['sha256:a']);
  });
});
