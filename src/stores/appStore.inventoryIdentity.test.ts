import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import * as api from '../lib/api';
import { modRestoreKey } from '../lib/soloRestore';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../lib/api', () => ({
  swapModPriority: vi.fn(), reorderMods: vi.fn(), applyModToggleBatch: vi.fn(),
  getMods: vi.fn(async () => []), getGamebananaCategories: vi.fn(async () => []),
}));

function mod(id: string, enabled = false): Mod {
  return {
    id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: `/addons/${id}.vpk`,
    sha256: id, enabled, priority: 1, size: 0, installedAt: '2026-01-01T00:00:00Z',
  };
}

describe('appStore inventory identity after mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      mods: [], modsLoaded: true, modsError: null, modsNotice: null, soloRestore: null,
      shuffleOnLaunch: false, shuffleIncluded: new Set(), shuffleVariants: new Map(),
    });
  });

  it.each(['swap', 'reorder'] as const)('retains untouched records after a priority %s', async (action) => {
    const before = [mod('one', true), mod('two', true), mod('untouched')];
    useAppStore.setState({ mods: before });
    const changed = { ...before[0], priority: 2 };
    const result = [changed, { ...before[1] }, { ...before[2] }];
    if (action === 'swap') {
      vi.mocked(api.swapModPriority).mockResolvedValueOnce(result);
      await useAppStore.getState().swapModPriority('one', 'two');
    } else {
      vi.mocked(api.reorderMods).mockResolvedValueOnce(result);
      await useAppStore.getState().reorderMods(['two', 'one']);
    }
    expect(useAppStore.getState().mods[0]).toBe(changed);
    expect(useAppStore.getState().mods[1]).toBe(before[1]);
    expect(useAppStore.getState().mods[2]).toBe(before[2]);
  });

  it.each(['swap', 'reorder'] as const)('avoids publishing an unchanged priority %s response', async (action) => {
    const before = [mod('one', true), mod('two')];
    useAppStore.setState({ mods: before });
    const publish = vi.fn();
    const unsubscribe = useAppStore.subscribe(publish);
    try {
      const response = before.map((entry) => ({ ...entry }));
      if (action === 'swap') {
        vi.mocked(api.swapModPriority).mockResolvedValueOnce(response);
        await useAppStore.getState().swapModPriority('one', 'two');
      } else {
        vi.mocked(api.reorderMods).mockResolvedValueOnce(response);
        await useAppStore.getState().reorderMods(['one']);
      }
      expect(useAppStore.getState().mods).toBe(before);
      expect(publish).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('reuses unaffected mods through solo and restore while keeping restore state correct', async () => {
    const one = mod('one', true);
    const two = mod('two', true);
    const untouched = mod('untouched');
    useAppStore.setState({ mods: [one, two, untouched] });
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({
      mods: [{ ...one }, { ...two, enabled: false }, { ...untouched }], failures: [],
    });

    await useAppStore.getState().soloMod([modRestoreKey(one)], 'One');
    expect(useAppStore.getState().mods[0]).toBe(one);
    expect(useAppStore.getState().mods[2]).toBe(untouched);
    expect(useAppStore.getState().soloRestore?.keys).toEqual([modRestoreKey(one), modRestoreKey(two)]);
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({
      mods: [{ ...one }, { ...two }, { ...untouched }], failures: [],
    });

    await useAppStore.getState().restoreSoloMods();
    expect(useAppStore.getState().mods[0]).toBe(one);
    expect(useAppStore.getState().mods[1].enabled).toBe(true);
    expect(useAppStore.getState().mods[2]).toBe(untouched);
    expect(useAppStore.getState().soloRestore).toBeNull();
  });

  it('reuses untouched records when launch shuffle enables a pooled mod', async () => {
    const picked: Mod = { ...mod('picked'), gameBananaId: 42, globalType: 'hud', sourceSection: 'Mod' };
    const untouched = mod('untouched');
    useAppStore.setState({
      mods: [picked, untouched], shuffleOnLaunch: true,
      shuffleIncluded: new Set(['bucket:hud:gamebanana:42']),
    });
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({
      mods: [{ ...picked, enabled: true }, { ...untouched }], failures: [],
    });

    expect(await useAppStore.getState().runLaunchShuffle()).toEqual({ failures: 0 });
    expect(api.applyModToggleBatch).toHaveBeenCalledWith(['picked'], []);
    expect(useAppStore.getState().mods[0].enabled).toBe(true);
    expect(useAppStore.getState().mods[1]).toBe(untouched);
  });
});
