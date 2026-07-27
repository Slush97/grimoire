import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOD_LISTS_KEY,
  type ModList,
  buildListMembershipIndex,
  countLiveMembers,
  createList,
  deleteList,
  readStoredModLists,
  renameList,
  toggleListMembership,
  writeStoredModLists,
} from './modLists';

const installLocalStorage = (values: Record<string, string> = {}) => {
  const storage = new Map(Object.entries(values));
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  };
  vi.stubGlobal('localStorage', localStorage);
  return { storage, localStorage };
};

const list = (id: string, name: string, keys: string[] = []): ModList => ({ id, name, keys });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage key', () => {
  it('is a frozen literal', () => {
    // Renaming this orphans every list already saved by a shipped build.
    // Treat the string as a wire format.
    expect(MOD_LISTS_KEY).toBe('installedModLists');
  });
});

describe('readStoredModLists', () => {
  it('returns an empty list when storage is absent or malformed', () => {
    installLocalStorage({ [MOD_LISTS_KEY]: '{bad json' });
    expect(readStoredModLists()).toEqual([]);

    installLocalStorage({ [MOD_LISTS_KEY]: JSON.stringify({ not: 'an array' }) });
    expect(readStoredModLists()).toEqual([]);

    installLocalStorage();
    expect(readStoredModLists()).toEqual([]);
  });

  it('drops entries that are not usable lists', () => {
    installLocalStorage({
      [MOD_LISTS_KEY]: JSON.stringify([
        null,
        'a string',
        { id: 'no-name' },
        { name: 'no id' },
        { id: '  ', name: 'blank id' },
        { id: 'blank-name', name: '   ' },
        list('keep', 'Keep'),
      ]),
    });

    expect(readStoredModLists()).toEqual([list('keep', 'Keep')]);
  });

  it('drops duplicate ids, keeping the first', () => {
    installLocalStorage({
      [MOD_LISTS_KEY]: JSON.stringify([list('dup', 'First', ['a']), list('dup', 'Second', ['b'])]),
    });

    expect(readStoredModLists()).toEqual([list('dup', 'First', ['a'])]);
  });

  it('repairs a missing or dirty keys array instead of dropping the list', () => {
    installLocalStorage({
      [MOD_LISTS_KEY]: JSON.stringify([
        { id: 'a', name: 'No keys field' },
        { id: 'b', name: 'Dirty keys', keys: ['x', 1, null, 'x', '', 'y'] },
        { id: 'c', name: 'Keys not an array', keys: 'nope' },
      ]),
    });

    expect(readStoredModLists()).toEqual([
      list('a', 'No keys field'),
      list('b', 'Dirty keys', ['x', 'y']),
      list('c', 'Keys not an array'),
    ]);
  });

  it('round-trips what writeStoredModLists saved', () => {
    const { storage } = installLocalStorage();
    const lists = [list('ivy', 'Ivy', ['gamebanana:1']), list('ui', 'UI', [])];

    writeStoredModLists(lists);
    expect(JSON.parse(storage.get(MOD_LISTS_KEY) ?? 'null')).toEqual(lists);
    expect(readStoredModLists()).toEqual(lists);
  });
});

describe('createList', () => {
  it('appends a list with a slugified id', () => {
    const { lists, id } = createList([], '  Ivy Skins  ');

    expect(id).toBe('ivy-skins');
    expect(lists).toEqual([list('ivy-skins', 'Ivy Skins')]);
  });

  it('returns a null id and no new list for a blank name', () => {
    const { lists, id } = createList([list('a', 'A')], '   ');

    expect(id).toBeNull();
    expect(lists).toEqual([list('a', 'A')]);
  });

  it('reuses an existing list when the name matches case-insensitively', () => {
    // "New list: ivy" when an Ivy list exists should file the mod under Ivy
    // rather than creating a confusing second list with the same label.
    const existing = [list('ivy', 'Ivy', ['gamebanana:1'])];
    const { lists, id } = createList(existing, 'IVY');

    expect(id).toBe('ivy');
    expect(lists).toEqual(existing);
  });

  it('disambiguates ids that would collide after slugifying', () => {
    // Different names, same slug: the second must not steal the first's id, or
    // every filter selection and membership lookup would alias.
    const first = createList([], 'Ivy Skins');
    const second = createList(first.lists, 'Ivy/Skins');

    expect(first.id).toBe('ivy-skins');
    expect(second.id).toBe('ivy-skins-2');
    expect(second.lists.map((l) => l.id)).toEqual(['ivy-skins', 'ivy-skins-2']);
  });

  it('falls back to a seed id when the name has no latin characters', () => {
    const first = createList([], 'Русские моды');
    const second = createList(first.lists, '日本語');

    expect(first.id).toBe('list');
    expect(second.id).toBe('list-2');
  });

  it('clamps an overlong name', () => {
    const { lists } = createList([], 'x'.repeat(200));

    expect(lists[0].name).toHaveLength(80);
  });

  it('does not mutate its input', () => {
    const original = [list('a', 'A')];
    const { lists } = createList(original, 'B');

    expect(original).toEqual([list('a', 'A')]);
    expect(lists).not.toBe(original);
  });
});

describe('renameList', () => {
  it('renames in place, preserving id and membership', () => {
    // The id is what an active filter selection references, so a rename must
    // not change it.
    const lists = renameList([list('ivy', 'Ivy', ['gamebanana:1'])], 'ivy', 'Ivy Skins');

    expect(lists).toEqual([list('ivy', 'Ivy Skins', ['gamebanana:1'])]);
  });

  it('no-ops on a blank name or an unknown id', () => {
    const original = [list('a', 'A')];

    expect(renameList(original, 'a', '  ')).toEqual(original);
    expect(renameList(original, 'missing', 'B')).toEqual(original);
  });

  it('no-ops when another list already uses the name', () => {
    const original = [list('a', 'A'), list('b', 'B')];

    expect(renameList(original, 'b', 'a')).toEqual(original);
  });

  it('allows a list to re-case its own name', () => {
    expect(renameList([list('a', 'ivy')], 'a', 'Ivy')).toEqual([list('a', 'Ivy')]);
  });
});

describe('deleteList', () => {
  it('removes only the named list', () => {
    expect(deleteList([list('a', 'A'), list('b', 'B')], 'a')).toEqual([list('b', 'B')]);
  });

  it('no-ops on an unknown id', () => {
    const original = [list('a', 'A')];
    expect(deleteList(original, 'missing')).toEqual(original);
  });
});

describe('toggleListMembership', () => {
  it('adds the key when absent and removes it when present', () => {
    const added = toggleListMembership([list('a', 'A')], 'a', 'gamebanana:1');
    expect(added).toEqual([list('a', 'A', ['gamebanana:1'])]);

    expect(toggleListMembership(added, 'a', 'gamebanana:1')).toEqual([list('a', 'A')]);
  });

  it('leaves other lists untouched', () => {
    const lists = toggleListMembership([list('a', 'A'), list('b', 'B')], 'a', 'k');

    expect(lists[1]).toEqual(list('b', 'B'));
  });

  it('no-ops on an unknown id or a blank key', () => {
    const original = [list('a', 'A')];

    expect(toggleListMembership(original, 'missing', 'k')).toEqual(original);
    expect(toggleListMembership(original, 'a', '')).toEqual(original);
  });

  it('does not mutate the input list or its keys array', () => {
    const keys: string[] = [];
    const original = [list('a', 'A', keys)];

    toggleListMembership(original, 'a', 'k');

    expect(keys).toEqual([]);
    expect(original[0].keys).toBe(keys);
  });
});

describe('buildListMembershipIndex', () => {
  it('maps each key to every list containing it, in list order', () => {
    const index = buildListMembershipIndex([
      list('a', 'A', ['k1', 'k2']),
      list('b', 'B', ['k2']),
    ]);

    expect(index.get('k1')).toEqual(['a']);
    expect(index.get('k2')).toEqual(['a', 'b']);
    expect(index.get('missing')).toBeUndefined();
  });

  it('is empty for lists with no members', () => {
    expect(buildListMembershipIndex([list('a', 'A')]).size).toBe(0);
  });
});

describe('countLiveMembers', () => {
  it('counts only keys present in the library', () => {
    // Orphaned keys are kept in storage (a reinstalled GameBanana mod produces
    // the same key) but must not inflate the count shown next to the list.
    const counts = countLiveMembers(
      [list('a', 'A', ['live1', 'orphan', 'live2'])],
      new Set(['live1', 'live2'])
    );

    expect(counts.get('a')).toBe(2);
  });

  it('reports zero for an empty list rather than omitting it', () => {
    // A freshly created list has to stay visible in the filter popover, which
    // means it needs an entry here even with nothing in it.
    const counts = countLiveMembers([list('a', 'A')], new Set(['anything']));

    expect(counts.get('a')).toBe(0);
    expect(counts.has('a')).toBe(true);
  });
});
