import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import * as api from '../lib/api';
import { modRestoreKey } from '../lib/soloRestore';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../lib/api', () => ({
  getMods: vi.fn(), reorderMods: vi.fn(), swapModPriority: vi.fn(),
  enableMod: vi.fn(), disableMod: vi.fn(), applyModToggleBatch: vi.fn(),
  getGamebananaCategories: vi.fn(async () => []), deleteMod: vi.fn(), editLocalMod: vi.fn(),
}));

function mod(id: string, enabled = true): Mod {
  return { id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: `/addons/${id}.vpk`,
    sha256: id, enabled, priority: 1, size: 1, installedAt: '' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    mods: [], modsLoaded: true, modsLoading: false, modsError: null, modsNotice: null,
    soloRestore: null, shuffleOnLaunch: false, shuffleIncluded: new Set(), shuffleVariants: new Map(),
  });
});

describe.each([true, false])('mutation results versus older scans (silent=%s)', silent => {
  it.each(['reorder', 'swap', 'toggle', 'solo', 'restore', 'shuffle'] as const)('keeps a completed %s when an older scan returns stale slot occupants', async operation => {
    let first = mod('slot-1');
    let second = mod('slot-2');
    if (operation === 'restore') second = { ...second, enabled: false };
    if (operation === 'shuffle') {
      first = { ...first, globalType: 'hud', gameBananaId: 41, sourceSection: 'Mod' };
      second = { ...second, enabled: false, globalType: 'hud', gameBananaId: 42, sourceSection: 'Mod' };
    }
    const before = [first, second];
    const swapped = [{ ...first, name: second.name, sha256: second.sha256 }, { ...second, name: first.name, sha256: first.sha256 }];
    const disabled = { ...first, id: 'disabled-first', enabled: false };
    const solo = [{ ...first }, { ...second, id: 'disabled-second', enabled: false }];
    const restored = [{ ...first }, { ...second, enabled: true }];
    const shuffled = [{ ...first, enabled: false }, { ...second, enabled: true }];
    const scan = deferred<Mod[]>();
    vi.mocked(api.getMods).mockReturnValueOnce(scan.promise);
    useAppStore.setState({ mods: before });
    const loading = useAppStore.getState().loadMods({ silent });
    if (!silent) expect(useAppStore.getState().modsLoading).toBe(true);
    let expected: Mod[];
    if (operation === 'reorder') {
      expected = swapped;
      vi.mocked(api.reorderMods).mockResolvedValueOnce(swapped);
      await useAppStore.getState().reorderMods(['slot-2', 'slot-1']);
    } else if (operation === 'swap') {
      expected = swapped;
      vi.mocked(api.swapModPriority).mockResolvedValueOnce(swapped);
      await useAppStore.getState().swapModPriority('slot-1', 'slot-2');
    } else if (operation === 'toggle') {
      expected = [disabled, second];
      vi.mocked(api.disableMod).mockResolvedValueOnce(disabled);
      expect(await useAppStore.getState().toggleMod('slot-1')).toBe(true);
    } else if (operation === 'solo') {
      expected = solo;
      vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: solo, failures: [] });
      expect(await useAppStore.getState().soloMod([modRestoreKey(first)], 'First')).toMatchObject({ applied: true });
    } else if (operation === 'restore') {
      expected = restored;
      useAppStore.setState({ soloRestore: { keys: before.map(modRestoreKey), label: 'Original' } });
      vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: restored, failures: [] });
      await useAppStore.getState().restoreSoloMods();
    } else {
      expected = shuffled;
      useAppStore.setState({ shuffleOnLaunch: true, shuffleIncluded: new Set(['bucket:hud:gamebanana:41', 'bucket:hud:gamebanana:42']) });
      vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: shuffled, failures: [] });
      await useAppStore.getState().runLaunchShuffle();
      expect(api.applyModToggleBatch).toHaveBeenCalledWith(['slot-2'], ['slot-1']);
    }
    expect(useAppStore.getState().mods).toEqual(expected);
    scan.resolve(before.map(entry => ({ ...entry })));
    await loading;
    expect(useAppStore.getState().mods).toEqual(expected);
    expect(useAppStore.getState().modsLoading).toBe(false);
    expect(useAppStore.getState().modsError).toBeNull();
  });
});

it('does not resurrect a deleted mod or lose an edit when an earlier scan finishes', async () => {
  const before = [mod('first'), mod('second')];
  useAppStore.setState({ mods: before });
  const scan = deferred<Mod[]>();
  vi.mocked(api.getMods).mockReturnValueOnce(scan.promise);
  const loading = useAppStore.getState().loadMods({ silent: true });
  vi.mocked(api.deleteMod).mockResolvedValueOnce({ skipped: [] });
  await useAppStore.getState().deleteMod(before[0]);
  const edited = { ...before[1], name: 'Edited second' };
  vi.mocked(api.editLocalMod).mockResolvedValueOnce(edited);
  await useAppStore.getState().editLocalMod(edited.id, { name: edited.name });
  scan.resolve(before);
  await loading;
  expect(useAppStore.getState().mods).toEqual([edited]);
});

it('ignores an older failed non-silent scan after a successful mutation and clears its spinner', async () => {
  const before = [mod('first'), mod('second')];
  useAppStore.setState({ mods: before });
  const scan = deferred<Mod[]>();
  vi.mocked(api.getMods).mockReturnValueOnce(scan.promise);
  const loading = useAppStore.getState().loadMods({ silent: false });
  const after = [...before].reverse();
  vi.mocked(api.reorderMods).mockResolvedValueOnce(after);
  await useAppStore.getState().reorderMods(['second', 'first']);
  scan.reject(new Error('late scan failure'));
  await loading;
  expect(useAppStore.getState().mods).toEqual(after);
  expect(useAppStore.getState().modsLoading).toBe(false);
  expect(useAppStore.getState().modsError).toBeNull();
});
