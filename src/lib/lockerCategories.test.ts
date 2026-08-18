import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCKER_CATEGORIES_KEY,
  type CategorizableMod,
  type LockerCategory,
  addCategoryMembership,
  buildCategoryMembershipIndex,
  countLiveCategoryMembers,
  createCategory,
  deleteCategory,
  groupCategoryMods,
  readStoredLockerCategories,
  renameCategory,
  toggleCategoryMembership,
  writeStoredLockerCategories,
} from './lockerCategories';

const installLocalStorage = (values: Record<string, string> = {}) => {
  const storage = new Map(Object.entries(values));
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  };
  vi.stubGlobal('localStorage', localStorage);
  return { storage, localStorage };
};

const category = (id: string, name: string, keys: string[] = []): LockerCategory => ({
  id,
  name,
  keys,
});

const mod = (
  id: string,
  name: string,
  extra: Partial<CategorizableMod> = {}
): CategorizableMod => ({
  id,
  name,
  enabled: true,
  gameBananaId: undefined,
  sha256: undefined,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage key', () => {
  it('is a frozen literal', () => {
    // Renaming this orphans every category already saved by a shipped build.
    // Treat the string as a wire format. It is also deliberately distinct from
    // the Installed page's `installedModLists`.
    expect(LOCKER_CATEGORIES_KEY).toBe('lockerCustomCategories');
  });
});

describe('readStoredLockerCategories', () => {
  it('returns an empty list when storage is absent or malformed', () => {
    installLocalStorage({ [LOCKER_CATEGORIES_KEY]: '{bad json' });
    expect(readStoredLockerCategories()).toEqual([]);

    installLocalStorage({ [LOCKER_CATEGORIES_KEY]: JSON.stringify({ not: 'an array' }) });
    expect(readStoredLockerCategories()).toEqual([]);

    installLocalStorage();
    expect(readStoredLockerCategories()).toEqual([]);
  });

  it('drops entries that are not usable categories', () => {
    installLocalStorage({
      [LOCKER_CATEGORIES_KEY]: JSON.stringify([
        null,
        'a string',
        { id: 'no-name' },
        { name: 'no id' },
        { id: '  ', name: 'blank id' },
        { id: 'blank-name', name: '   ' },
        category('keep', 'Keep'),
      ]),
    });

    expect(readStoredLockerCategories()).toEqual([category('keep', 'Keep')]);
  });

  it('drops duplicate ids, keeping the first', () => {
    installLocalStorage({
      [LOCKER_CATEGORIES_KEY]: JSON.stringify([
        category('dup', 'First', ['a']),
        category('dup', 'Second', ['b']),
      ]),
    });

    expect(readStoredLockerCategories()).toEqual([category('dup', 'First', ['a'])]);
  });

  it('repairs a missing or dirty keys array instead of dropping the category', () => {
    installLocalStorage({
      [LOCKER_CATEGORIES_KEY]: JSON.stringify([
        { id: 'a', name: 'No keys field' },
        { id: 'b', name: 'Dirty keys', keys: ['x', 1, null, 'x', '', 'y'] },
        { id: 'c', name: 'Keys not an array', keys: 'nope' },
      ]),
    });

    expect(readStoredLockerCategories()).toEqual([
      category('a', 'No keys field'),
      category('b', 'Dirty keys', ['x', 'y']),
      category('c', 'Keys not an array'),
    ]);
  });

  it('round-trips what writeStoredLockerCategories saved', () => {
    const { storage } = installLocalStorage();
    const categories = [category('ivy', 'Ivy', ['gamebanana:1']), category('hud', 'HUD', [])];

    writeStoredLockerCategories(categories);
    expect(JSON.parse(storage.get(LOCKER_CATEGORIES_KEY) ?? 'null')).toEqual(categories);
    expect(readStoredLockerCategories()).toEqual(categories);
  });
});

describe('createCategory', () => {
  it('appends a category with a slugified id', () => {
    const { categories, id } = createCategory([], '  Ivy Skins  ');

    expect(id).toBe('ivy-skins');
    expect(categories).toEqual([category('ivy-skins', 'Ivy Skins')]);
  });

  it('returns a null id and no new category for a blank name', () => {
    const { categories, id } = createCategory([category('a', 'A')], '   ');

    expect(id).toBeNull();
    expect(categories).toEqual([category('a', 'A')]);
  });

  it('reuses an existing category when the name matches case-insensitively', () => {
    // "New category: ivy" when an Ivy category exists should file the mod under
    // Ivy rather than creating a second tab with the same label.
    const existing = [category('ivy', 'Ivy', ['gamebanana:1'])];
    const { categories, id } = createCategory(existing, 'IVY');

    expect(id).toBe('ivy');
    expect(categories).toEqual(existing);
  });

  it('disambiguates ids that would collide after slugifying', () => {
    // Different names, same slug: the second must not steal the first's id, or
    // the active tab and every membership lookup would alias.
    const first = createCategory([], 'Ivy Skins');
    const second = createCategory(first.categories, 'Ivy/Skins');

    expect(first.id).toBe('ivy-skins');
    expect(second.id).toBe('ivy-skins-2');
    expect(second.categories.map((c) => c.id)).toEqual(['ivy-skins', 'ivy-skins-2']);
  });

  it('falls back to a seed id when the name has no latin characters', () => {
    const first = createCategory([], 'Русские моды');
    const second = createCategory(first.categories, '日本語');

    expect(first.id).toBe('category');
    expect(second.id).toBe('category-2');
  });

  it('clamps an overlong name', () => {
    const { categories } = createCategory([], 'x'.repeat(200));

    expect(categories[0].name).toHaveLength(80);
  });

  it('does not mutate its input', () => {
    const original = [category('a', 'A')];
    const { categories } = createCategory(original, 'B');

    expect(original).toEqual([category('a', 'A')]);
    expect(categories).not.toBe(original);
  });
});

describe('renameCategory', () => {
  it('renames in place, preserving id and membership', () => {
    // The id is what the active tab references, so a rename must not change it.
    const { categories, applied } = renameCategory(
      [category('ivy', 'Ivy', ['gamebanana:1'])],
      'ivy',
      'Ivy Skins'
    );

    expect(applied).toBe(true);
    expect(categories).toEqual([category('ivy', 'Ivy Skins', ['gamebanana:1'])]);
  });

  it('no-ops on a blank name or an unknown id', () => {
    const original = [category('a', 'A')];

    expect(renameCategory(original, 'a', '  ')).toEqual({ categories: original, applied: false });
    expect(renameCategory(original, 'missing', 'B')).toEqual({
      categories: original,
      applied: false,
    });
  });

  it('no-ops when another category already uses the name', () => {
    const original = [category('a', 'A'), category('b', 'B')];

    expect(renameCategory(original, 'b', 'a')).toEqual({ categories: original, applied: false });
  });

  it('allows a category to re-case its own name', () => {
    expect(renameCategory([category('a', 'ivy')], 'a', 'Ivy')).toEqual({
      categories: [category('a', 'Ivy')],
      applied: true,
    });
  });

  it('reports applied for a name that survives trimming and clamping', () => {
    // The manage dialog keys its rejection message off `applied`, so it must not
    // be re-derived from a normalization rule duplicated outside this module.
    const { categories, applied } = renameCategory(
      [category('a', 'A')],
      'a',
      `  ${'x'.repeat(200)}  `
    );

    expect(applied).toBe(true);
    expect(categories[0].name).toHaveLength(80);
  });
});

describe('deleteCategory', () => {
  it('removes only the named category', () => {
    expect(deleteCategory([category('a', 'A'), category('b', 'B')], 'a')).toEqual([
      category('b', 'B'),
    ]);
  });

  it('no-ops on an unknown id', () => {
    const original = [category('a', 'A')];
    expect(deleteCategory(original, 'missing')).toEqual(original);
  });
});

describe('addCategoryMembership', () => {
  it('adds the key when absent and is a no-op when already present', () => {
    const added = addCategoryMembership([category('a', 'A')], 'a', 'gamebanana:1');
    expect(added).toEqual([category('a', 'A', ['gamebanana:1'])]);

    expect(addCategoryMembership(added, 'a', 'gamebanana:1')).toEqual(added);
  });

  it('no-ops on an unknown id or a blank key', () => {
    const original = [category('a', 'A')];

    expect(addCategoryMembership(original, 'missing', 'k')).toEqual(original);
    expect(addCategoryMembership(original, 'a', '')).toEqual(original);
  });

  it('does not mutate the input list or its keys array', () => {
    const keys: string[] = [];
    const original = [category('a', 'A', keys)];

    addCategoryMembership(original, 'a', 'k');

    expect(keys).toEqual([]);
    expect(original[0].keys).toBe(keys);
  });
});

describe('create-then-file (the "New category..." dialog flow)', () => {
  // Mirrors createCategoryForMod in Locker.tsx. createCategory reuses a
  // category whose name already matches, so this composition has to be
  // add-only: toggling here un-files a mod that is already in the category
  // whose name the user typed.
  const createAndFile = (categories: readonly LockerCategory[], name: string, prefKey: string) => {
    const created = createCategory(categories, name);
    return created.id
      ? addCategoryMembership(created.categories, created.id, prefKey)
      : created.categories;
  };

  it('files the mod into a newly created category', () => {
    expect(createAndFile([], 'Ivy', 'gamebanana:1')).toEqual([
      category('ivy', 'Ivy', ['gamebanana:1']),
    ]);
  });

  it('keeps the mod filed when the typed name matches a category it is already in', () => {
    const existing = [category('ivy', 'Ivy', ['gamebanana:1'])];

    expect(createAndFile(existing, 'IVY', 'gamebanana:1')).toEqual(existing);
  });

  it('files into the matched category rather than duplicating it', () => {
    const existing = [category('ivy', 'Ivy', ['gamebanana:1'])];

    expect(createAndFile(existing, 'ivy', 'gamebanana:2')).toEqual([
      category('ivy', 'Ivy', ['gamebanana:1', 'gamebanana:2']),
    ]);
  });
});

describe('toggleCategoryMembership', () => {
  it('adds the key when absent and removes it when present', () => {
    const added = toggleCategoryMembership([category('a', 'A')], 'a', 'gamebanana:1');
    expect(added).toEqual([category('a', 'A', ['gamebanana:1'])]);

    expect(toggleCategoryMembership(added, 'a', 'gamebanana:1')).toEqual([category('a', 'A')]);
  });

  it('leaves other categories untouched', () => {
    const categories = toggleCategoryMembership([category('a', 'A'), category('b', 'B')], 'a', 'k');

    expect(categories[1]).toEqual(category('b', 'B'));
  });

  it('no-ops on an unknown id or a blank key', () => {
    const original = [category('a', 'A')];

    expect(toggleCategoryMembership(original, 'missing', 'k')).toEqual(original);
    expect(toggleCategoryMembership(original, 'a', '')).toEqual(original);
  });

  it('does not mutate the input list or its keys array', () => {
    const keys: string[] = [];
    const original = [category('a', 'A', keys)];

    toggleCategoryMembership(original, 'a', 'k');

    expect(keys).toEqual([]);
    expect(original[0].keys).toBe(keys);
  });
});

describe('buildCategoryMembershipIndex', () => {
  it('maps each key to every category containing it, in category order', () => {
    const index = buildCategoryMembershipIndex([
      category('a', 'A', ['k1', 'k2']),
      category('b', 'B', ['k2']),
    ]);

    expect(index.get('k1')).toEqual(['a']);
    expect(index.get('k2')).toEqual(['a', 'b']);
    expect(index.get('missing')).toBeUndefined();
  });

  it('is empty for categories with no members', () => {
    expect(buildCategoryMembershipIndex([category('a', 'A')]).size).toBe(0);
  });
});

describe('countLiveCategoryMembers', () => {
  it('counts only keys present in the library', () => {
    // Orphaned keys are kept in storage (a reinstalled GameBanana mod produces
    // the same key) but must not inflate the count shown next to the tab.
    const counts = countLiveCategoryMembers(
      [category('a', 'A', ['live1', 'orphan', 'live2'])],
      new Set(['live1', 'live2'])
    );

    expect(counts.get('a')).toBe(2);
  });

  it('reports zero for an empty category rather than omitting it', () => {
    // A freshly created category has to stay visible in the tab rail, which
    // means it needs an entry here even with nothing in it.
    const counts = countLiveCategoryMembers([category('a', 'A')], new Set(['anything']));

    expect(counts.get('a')).toBe(0);
    expect(counts.has('a')).toBe(true);
  });
});

describe('groupCategoryMods', () => {
  it('resolves members through modPreferenceKey', () => {
    const gb = mod('pak01', 'GameBanana mod', { gameBananaId: 7 });
    const hashed = mod('pak02', 'Local mod', { sha256: 'abc' });
    const bare = mod('pak03', 'Bare mod');

    const groups = groupCategoryMods(
      [category('a', 'A', ['gamebanana:7', 'sha256:abc', 'mod:pak03'])],
      [gb, hashed, bare]
    );

    expect(groups.get('a')).toEqual([bare, gb, hashed]);
  });

  it('sorts enabled first, then by name', () => {
    const offA = mod('1', 'Alpha', { sha256: 'off-a', enabled: false });
    const onB = mod('2', 'Bravo', { sha256: 'on-b' });
    const onA = mod('3', 'Able', { sha256: 'on-a' });

    const groups = groupCategoryMods(
      [category('a', 'A', ['sha256:off-a', 'sha256:on-b', 'sha256:on-a'])],
      [offA, onB, onA]
    );

    expect(groups.get('a')).toEqual([onA, onB, offA]);
  });

  it('ignores orphaned keys and gives an empty category an empty array', () => {
    const live = mod('1', 'Live', { sha256: 'live' });

    const groups = groupCategoryMods(
      [category('a', 'A', ['sha256:live', 'gamebanana:404']), category('b', 'B')],
      [live]
    );

    expect(groups.get('a')).toEqual([live]);
    expect(groups.get('b')).toEqual([]);
  });

  it('yields both cards when two installs share one content key', () => {
    // The same local VPK installed twice is two real cards the user can act on,
    // even though filing one files both.
    const first = mod('pak01', 'Twin', { sha256: 'same' });
    const second = mod('pak02', 'Twin', { sha256: 'same' });

    const groups = groupCategoryMods([category('a', 'A', ['sha256:same'])], [first, second]);

    expect(groups.get('a')).toEqual([first, second]);
  });

  it('leaves mods filed nowhere out of every group', () => {
    const filed = mod('1', 'Filed', { sha256: 'filed' });
    const loose = mod('2', 'Loose', { sha256: 'loose' });

    const groups = groupCategoryMods([category('a', 'A', ['sha256:filed'])], [filed, loose]);

    expect(groups.get('a')).toEqual([filed]);
    expect(groups.size).toBe(1);
  });
});
