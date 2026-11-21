import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Mod } from '../types/mod';
import * as api from '../lib/api';
import { DISABLED_FAVORITES_KEY } from '../lib/disabledModPrefs';
import { MOD_LISTS_KEY } from '../lib/modLists';
import { SHUFFLE_INCLUDED_KEY, SHUFFLE_VARIANT_KEY } from '../lib/lockerRandomizer';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({
  default: { t: (key: string) => key },
  applyLanguagePreference: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  getMods: vi.fn(async () => []),
  setLocalVariantGroup: vi.fn(),
  setLocalModGallery: vi.fn(),
  setModsNsfw: vi.fn(),
  getLockerModImages: vi.fn(async () => ({})),
  getLockerModImageFlags: vi.fn(async () => ({})),
  setLockerModImage: vi.fn(),
  setLockerModImageHideName: vi.fn(),
  removeLockerModImage: vi.fn(async () => undefined),
  getLockerModThumbnails: vi.fn(async () => ({})),
  getLockerModThumbnailFlags: vi.fn(async () => ({})),
  setLockerModThumbnail: vi.fn(),
  setLockerModThumbnailHideName: vi.fn(),
  removeLockerModThumbnail: vi.fn(async () => undefined),
  getLockerModBackgrounds: vi.fn(async () => ({})),
  getLockerModBackgroundFlags: vi.fn(async () => ({})),
  setLockerModBackground: vi.fn(),
  setLockerModBackgroundHideName: vi.fn(),
  removeLockerModBackground: vi.fn(async () => undefined),
  getLockerModImageEdit: vi.fn(),
  setLockerModImageEdit: vi.fn(),
}));

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id,
    name: id,
    fileName: `${id}.vpk`,
    path: `/addons/${id}.vpk`,
    metaKey: `${id}.vpk`,
    enabled: false,
    priority: 1,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

describe('appStore local variant preference migration', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      'CustomEvent',
      class {
        type: string;
        detail: unknown;
        constructor(type: string, init: { detail: unknown }) {
          this.type = type;
          this.detail = init.detail;
        }
      }
    );
    vi.clearAllMocks();
    useAppStore.setState({
      mods: [],
      modsLoaded: false,
      modsLoading: false,
      modsError: null,
      shuffleIncluded: new Set(),
      shuffleVariants: new Map(),
      lockerModImages: {},
      lockerModBackgrounds: {},
      lockerModThumbnails: {},
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('adopts the returned mods and migrates stored and in-memory shuffle state', async () => {
    const before = [mod('a', { sha256: 'a' }), mod('b', { sha256: 'b' })];
    const after = before.map((item) => ({ ...item, localGroupId: 'group-1' }));
    storage.set(DISABLED_FAVORITES_KEY, JSON.stringify(['sha256:a']));
    storage.set(
      MOD_LISTS_KEY,
      JSON.stringify([{ id: 'favorites', name: 'Favorites', keys: ['sha256:b'] }])
    );
    storage.set(SHUFFLE_INCLUDED_KEY, JSON.stringify(['sha256:a']));
    storage.set(SHUFFLE_VARIANT_KEY, JSON.stringify({ 'sha256:a': 'random' }));
    useAppStore.setState({
      mods: before,
      shuffleIncluded: new Set(['sha256:a']),
      shuffleVariants: new Map([['sha256:a', 'random']]),
    });
    vi.mocked(api.setLocalVariantGroup).mockResolvedValueOnce({
      groupId: 'group-1',
      mods: after,
    });

    const result = await useAppStore
      .getState()
      .setLocalVariantGroup(['a', 'b'], { mode: 'mint' });

    expect(result).toBe('group-1');
    expect(useAppStore.getState().mods).toEqual(after);
    expect(useAppStore.getState().shuffleIncluded).toEqual(new Set(['localgroup:group-1']));
    expect(useAppStore.getState().shuffleVariants).toEqual(
      new Map([['localgroup:group-1', 'random']])
    );
    expect(JSON.parse(storage.get(DISABLED_FAVORITES_KEY) ?? 'null')).toEqual([
      'localgroup:group-1',
    ]);
    expect(JSON.parse(storage.get(MOD_LISTS_KEY) ?? 'null')[0].keys).toEqual([
      'localgroup:group-1',
    ]);
  });

  it('gives standalone artwork an existing group identity and updates every card', async () => {
    const original = mod('solo', { sha256: 'solo', thumbnailUrl: 'old' });
    const grouped = { ...original, localGroupId: 'artwork' };
    const updated = { ...grouped, thumbnailUrl: 'new', hasLocalGallery: true };
    useAppStore.setState({ mods: [original] });
    vi.mocked(api.setLocalVariantGroup).mockResolvedValue({ groupId: 'artwork', mods: [grouped] });
    vi.mocked(api.setLocalModGallery).mockResolvedValue([updated]);
    await useAppStore.getState().setLocalModGallery(original.id, ['new', 'second']);
    expect(api.setLocalVariantGroup).toHaveBeenCalledExactlyOnceWith([original.id], { mode: 'mint' });
    expect(api.setLocalModGallery).toHaveBeenCalledExactlyOnceWith('artwork', ['new', 'second']);
    expect(useAppStore.getState().mods).toEqual([updated]);
    await useAppStore.getState().setLocalModGallery(updated.id, []);
    expect(api.setLocalVariantGroup).toHaveBeenCalledOnce();
  });

  it('does not apply an old grouping response or migrate preferences after an installation switch', async () => {
    let finish!: (value: { groupId: string; mods: Mod[] }) => void;
    vi.mocked(api.setLocalVariantGroup).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const original = mod('original'); const current = mod('current');
    storage.set(DISABLED_FAVORITES_KEY, JSON.stringify(['sha256:original']));
    useAppStore.setState({ settings: { deadlockPath: '/original' } as AppSettings, mods: [original] });
    const pending = useAppStore.getState().setLocalVariantGroup([original.id], { mode: 'mint' });
    useAppStore.setState({ settings: { deadlockPath: '/current' } as AppSettings, mods: [current] });
    finish({ groupId: 'old-group', mods: [{ ...original, localGroupId: 'old-group' }] }); await pending;
    expect(useAppStore.getState().mods).toEqual([current]);
    expect(JSON.parse(storage.get(DISABLED_FAVORITES_KEY)!)).toEqual(['sha256:original']);
  });

  it('undoes a newly minted group when saving its first artwork fails', async () => {
    const original = mod('solo', { sha256: 'solo' });
    const grouped = { ...original, localGroupId: 'temporary' };
    useAppStore.setState({ mods: [original] });
    vi.mocked(api.setLocalVariantGroup).mockResolvedValueOnce({ groupId: 'temporary', mods: [grouped] })
      .mockResolvedValueOnce({ groupId: null, mods: [original] });
    vi.mocked(api.setLocalModGallery).mockRejectedValueOnce(new Error('Disk full'));
    await expect(useAppStore.getState().setLocalModGallery(original.id, ['image'])).rejects.toThrow('Disk full');
    expect(api.setLocalVariantGroup).toHaveBeenLastCalledWith([original.id], { mode: 'clear' });
    expect(useAppStore.getState().mods).toEqual([original]);
  });

  it('adopts NSFW flags from main for every variant', async () => {
    const before = [mod('a'), mod('b')];
    const updated = before.map(item => ({ ...item, nsfw: true }));
    useAppStore.setState({ mods: before });
    vi.mocked(api.setModsNsfw).mockResolvedValue(updated);
    await useAppStore.getState().setModsNsfw(['a', 'b'], true);
    expect(api.setModsNsfw).toHaveBeenCalledExactlyOnceWith(['a', 'b'], true);
    expect(useAppStore.getState().mods).toEqual(updated);
  });

  it('keeps the active installation when an older NSFW write finishes', async () => {
    let finish!: (mods: Mod[]) => void;
    vi.mocked(api.setModsNsfw).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const original = mod('original'); const current = mod('current');
    useAppStore.setState({ settings: { deadlockPath: '/original' } as AppSettings, mods: [original] });
    const pending = useAppStore.getState().setModsNsfw([original.id], true);
    useAppStore.setState({ settings: { deadlockPath: '/current' } as AppSettings, mods: [current] });
    finish([{ ...original, nsfw: true }]);
    await pending;
    expect(useAppStore.getState().mods).toEqual([current]);
  });

  it('does not invalidate a new installation scan when an older NSFW write finishes', async () => {
    let finishWrite!: (mods: Mod[]) => void; let finishScan!: (mods: Mod[]) => void;
    vi.mocked(api.setModsNsfw).mockReturnValueOnce(new Promise(resolve => { finishWrite = resolve; }));
    vi.mocked(api.getMods).mockReturnValueOnce(new Promise(resolve => { finishScan = resolve; }));
    useAppStore.setState({ settings: { deadlockPath: '/old' } as AppSettings, mods: [mod('old')] });
    const write = useAppStore.getState().setModsNsfw(['old'], true);
    useAppStore.setState({ settings: { deadlockPath: '/new' } as AppSettings, mods: [], modsLoaded: false });
    const scan = useAppStore.getState().loadMods({ force: true });
    finishWrite([mod('old', { nsfw: true })]); await write;
    finishScan([mod('new')]); await scan;
    expect(useAppStore.getState().mods.map(mod => mod.id)).toEqual(['new']);
    expect(useAppStore.getState().modsLoading).toBe(false);
  });

  it('moves Locker art, editable crop sources, and flags to the new group key', async () => {
    const before = [mod('a', { sha256: 'a' }), mod('b', { sha256: 'b' })];
    const after = before.map((item) => ({ ...item, localGroupId: 'group-1' }));
    const crop = { sx: 0.1, sy: 0.2, sw: 0.7, sh: 0.6 };
    vi.mocked(api.setLocalVariantGroup).mockResolvedValueOnce({
      groupId: 'group-1',
      mods: after,
    });
    vi.mocked(api.getLockerModImages).mockResolvedValueOnce({ 'mod:a': 'data:image/png;base64,card' });
    vi.mocked(api.getLockerModImageFlags).mockResolvedValueOnce({ 'mod:a': true });
    vi.mocked(api.getLockerModThumbnails).mockResolvedValueOnce({ 'mod:a': 'data:image/png;base64,thumb' });
    vi.mocked(api.getLockerModThumbnailFlags).mockResolvedValueOnce({ 'mod:a': true });
    vi.mocked(api.getLockerModBackgrounds).mockResolvedValueOnce({ 'mod:a': 'data:image/png;base64,bg' });
    vi.mocked(api.getLockerModBackgroundFlags).mockResolvedValueOnce({ 'mod:a': true });
    vi.mocked(api.getLockerModImageEdit).mockResolvedValue({
      source: 'data:image/png;base64,original',
      crop,
    });
    useAppStore.setState({ mods: before });

    await useAppStore
      .getState()
      .setLocalVariantGroup(['a', 'b'], { mode: 'mint' });

    expect(api.setLockerModImage).toHaveBeenCalledWith(
      'localgroup:group-1',
      'data:image/png;base64,card'
    );
    expect(api.setLockerModThumbnail).toHaveBeenCalledWith(
      'localgroup:group-1',
      'data:image/png;base64,thumb'
    );
    expect(api.setLockerModBackground).toHaveBeenCalledWith(
      'localgroup:group-1',
      'data:image/png;base64,bg'
    );
    expect(api.setLockerModImageEdit).toHaveBeenCalledTimes(3);
    expect(api.setLockerModImageEdit).toHaveBeenCalledWith(
      'card',
      'localgroup:group-1',
      'data:image/png;base64,original',
      crop
    );
    expect(api.setLockerModImageHideName).toHaveBeenCalledWith('localgroup:group-1', true);
    expect(api.setLockerModThumbnailHideName).toHaveBeenCalledWith('localgroup:group-1', true);
    expect(api.setLockerModBackgroundHideName).toHaveBeenCalledWith('localgroup:group-1', true);
    expect(api.removeLockerModImage).toHaveBeenCalledWith('mod:a');
    // mod:b holds no image on any surface, so no removal round trip is spent
    // on it.
    expect(api.removeLockerModImage).not.toHaveBeenCalledWith('mod:b');
    expect(api.removeLockerModThumbnail).toHaveBeenCalledWith('mod:a');
    expect(api.removeLockerModBackground).toHaveBeenCalledWith('mod:a');
  });

  it('awaits the initial mod scan before migrating and publishing Locker image maps', async () => {
    const grouped = mod('a', { localGroupId: 'group-1' });
    const crop = { sx: 0.1, sy: 0.2, sw: 0.7, sh: 0.6 };
    vi.mocked(api.getMods).mockResolvedValueOnce([grouped]);
    vi.mocked(api.getLockerModImages)
      .mockResolvedValueOnce({ 'mod:a': 'data:image/png;base64,card' })
      .mockResolvedValueOnce({ 'localgroup:group-1': 'data:image/png;base64,card' });
    vi.mocked(api.getLockerModImageFlags)
      .mockResolvedValueOnce({ 'mod:a': true })
      .mockResolvedValueOnce({ 'localgroup:group-1': true });
    vi.mocked(api.getLockerModImageEdit).mockResolvedValueOnce({
      source: 'data:image/png;base64,original',
      crop,
    });

    await useAppStore.getState().loadLockerModImages();

    expect(api.getMods).toHaveBeenCalledOnce();
    expect(api.setLockerModImageEdit).toHaveBeenCalledWith(
      'card',
      'localgroup:group-1',
      'data:image/png;base64,original',
      crop
    );
    expect(api.setLockerModImageHideName).toHaveBeenCalledWith('localgroup:group-1', true);
    expect(api.setLockerModImage).toHaveBeenCalledWith(
      'localgroup:group-1',
      'data:image/png;base64,card'
    );
    expect(api.removeLockerModImage).toHaveBeenCalledWith('mod:a');
    expect(useAppStore.getState().mods).toEqual([grouped]);
    expect(useAppStore.getState().lockerModImages).toEqual({
      'localgroup:group-1': 'data:image/png;base64,card',
    });
    expect(useAppStore.getState().lockerHideHeroName).toEqual({
      'localgroup:group-1': true,
    });
  });
});
