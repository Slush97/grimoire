import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Mod } from '../types/mod';
import { getInstallationScope } from '../lib/appSettings';
import { customTagMemberKey, customTagsForMods, useInstalledTagsStore } from './installedTagsStore';

const settings = { deadlockPath: 'C:\\Games\\Deadlock', devDeadlockPath: 'C:\\Games\\Deadlock', devMode: false } as AppSettings;
const normal = getInstallationScope(settings)!;
const developer = getInstallationScope({ ...settings, devMode: true })!;
const other = getInstallationScope({ ...settings, deadlockPath: 'D:\\Deadlock' })!;
const mod = (id: string, patch: Partial<Mod> = {}): Mod => ({
  id, name: id, metaKey: `${id}.vpk`, path: `/game/${id}.vpk`, fileName: `${id}.vpk`,
  enabled: true, priority: 1, size: 10, installedAt: '2026-10-27T00:00:00.000Z', sha256: id, ...patch,
});
const tags = (scope = normal) => useInstalledTagsStore.getState().byScope[scope] ?? [];
const store = () => useInstalledTagsStore.getState();
let storage: Map<string, string>;
let getItem: ReturnType<typeof vi.fn>;
let setItem: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = new Map();
  getItem = vi.fn((key: string) => storage.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => storage.set(key, value));
  vi.stubGlobal('localStorage', { getItem, setItem });
  useInstalledTagsStore.setState({ byScope: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('Installed custom tags', () => {
  it('persists independent catalogues for installation paths and normal/developer mode', () => {
    expect(normal).not.toBe(developer);
    expect(normal).toBe(getInstallationScope({ ...settings, deadlockPath: 'c:/GAMES/Deadlock/' }));
    expect(store().create(normal, 'Normal tag')).toBe(true);
    expect(store().create(developer, 'Dev tag')).toBe(true);
    expect(store().create(other, 'Other installation')).toBe(true);
    expect(storage.size).toBe(3);
    useInstalledTagsStore.setState({ byScope: {} });
    for (const scope of [normal, developer, other]) store().load(scope);
    expect(tags().map(tag => tag.name)).toEqual(['Normal tag']);
    expect(tags(developer).map(tag => tag.name)).toEqual(['Dev tag']);
    expect(tags(other).map(tag => tag.name)).toEqual(['Other installation']);
    getItem.mockClear();
    store().load(normal);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('rejects empty/duplicate names and preserves membership while renaming or deleting tags', () => {
    expect(store().create(normal, '  Favorites  ')).toBe(true);
    expect(store().create(normal, 'favorites')).toBe(false);
    expect(store().create(normal, '   ')).toBe(false);
    const favoriteId = tags()[0].id;
    store().toggle(normal, favoriteId, mod('a'));
    expect(store().create(normal, 'Other')).toBe(true);
    const otherId = tags()[1].id;
    expect(store().rename(normal, favoriteId, 'other')).toBe(false);
    expect(store().rename(normal, favoriteId, ' ')).toBe(false);
    expect(store().rename(normal, 'missing-id', 'Missing')).toBe(false);
    expect(store().rename(normal, favoriteId, '  Saved mods  ')).toBe(true);
    expect(tags()[0]).toEqual({ id: favoriteId, name: 'Saved mods', keys: ['sha256:a'] });
    store().remove(normal, otherId);
    expect(tags()).toHaveLength(1);
    useInstalledTagsStore.setState({ byScope: {} });
    store().load(normal);
    expect(tags()).toEqual([{ id: favoriteId, name: 'Saved mods', keys: ['sha256:a'] }]);
  });

  it('uses section-aware GameBanana identities and stable payload/local-group keys', () => {
    const linked = mod('a', { gameBananaId: 17 });
    expect(customTagMemberKey(linked)).toBe('Mod:gamebanana:17');
    const updated = { ...linked, id: 'new-slot', gameBananaFileId: 99, sourceSection: 'Mod' };
    expect(customTagMemberKey(updated))
      .toBe(customTagMemberKey(linked));
    expect(customTagMemberKey({ ...linked, sourceSection: 'Sound' })).toBe('Sound:gamebanana:17');
    expect(customTagMemberKey({ ...linked, sourceSection: 'Wip' })).toBe('Wip:gamebanana:17');
    expect(customTagMemberKey({ ...linked, localGroupId: 'local-choice' })).toBe('localgroup:local-choice');
    expect(customTagMemberKey(mod('renamed', { sha256: 'a' }))).toBe(customTagMemberKey(mod('a')));
  });

  it('toggles an entire submission without mixing sections and unions grouped tag labels once', () => {
    const modFile = mod('skin', { gameBananaId: 17 });
    const soundFile = mod('sound', { gameBananaId: 17, sourceSection: 'Sound' });
    store().create(normal, 'Favorites');
    const id = tags()[0].id;
    store().toggle(normal, id, modFile);
    expect(customTagsForMods(tags(), [modFile, { ...modFile, id: 'other-variant' }])).toHaveLength(1);
    expect(customTagsForMods(tags(), [soundFile])).toEqual([]);
    store().toggle(normal, id, soundFile);
    expect(customTagsForMods(tags(), [modFile, soundFile])).toHaveLength(1);
    store().toggle(normal, id, { ...modFile, id: 'different-slot' });
    expect(customTagsForMods(tags(), [modFile])).toEqual([]);
    expect(customTagsForMods(tags(), [soundFile])).toHaveLength(1);
    expect(tags()[0].keys).toEqual(['Sound:gamebanana:17']);
  });

  it('moves membership into local groups and copies it back to split files while keeping orphans', () => {
    const before = [mod('a'), mod('b', { enabled: false, priority: 2 })];
    const grouped = before.map(file => ({ ...file, localGroupId: 'group' }));
    store().create(normal, 'Favorites');
    const id = tags()[0].id;
    store().toggle(normal, id, before[0]);
    store().toggle(normal, id, mod('temporarily-absent'));
    store().regroup(normal, before, grouped);
    expect(tags()[0].keys).toEqual(['localgroup:group', 'sha256:temporarily-absent']);
    expect(customTagsForMods(tags(), [grouped[1]])).toHaveLength(1);
    store().regroup(normal, grouped, before);
    expect(tags()[0].keys).toEqual(['sha256:a', 'sha256:b', 'sha256:temporarily-absent']);
    setItem.mockClear();
    store().regroup(normal, before, before);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('retains a surviving group membership when one file is detached', () => {
    const before = [mod('a', { localGroupId: 'group' }), mod('b', { localGroupId: 'group' })];
    const after = [before[0], { ...before[1], localGroupId: undefined }];
    store().create(normal, 'Favorites');
    const id = tags()[0].id;
    store().toggle(normal, id, before[0]);
    store().regroup(normal, before, after);
    expect(tags()[0].keys).toEqual(['localgroup:group', 'sha256:b']);
  });

  it('reuses defensive list storage loading and keeps changes usable when storage fails', () => {
    getItem.mockReturnValue('{broken json');
    store().load(normal);
    expect(tags()).toEqual([]);
    getItem.mockImplementation(() => { throw new Error('storage unavailable'); });
    setItem.mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(store().create(developer, 'Dev tag')).toBe(true);
    expect(tags(developer).map(tag => tag.name)).toEqual(['Dev tag']);
  });
});
