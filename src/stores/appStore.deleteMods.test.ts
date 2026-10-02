import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import * as api from '../lib/api';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({
  applyLanguagePreference: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  deleteMods: vi.fn(),
  getMods: vi.fn(),
}));

function mod(id: string): Mod {
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
  };
}

const deleteMods = vi.mocked(api.deleteMods);
const getMods = vi.mocked(api.getMods);

describe('appStore deleteMods', () => {
  beforeEach(() => {
    deleteMods.mockReset();
    getMods.mockReset();
    useAppStore.setState({ mods: [mod('a'), mod('b'), mod('c')], modsLoaded: true, modsError: null });
  });

  it('drops the deleted ids and forwards progress', async () => {
    const onProgress = vi.fn();
    deleteMods.mockImplementationOnce(async (_ids, report) => {
      report?.({ done: 1, total: 2 });
      report?.({ done: 2, total: 2 });
    });

    await useAppStore.getState().deleteMods(['a', 'c'], onProgress);

    expect(deleteMods).toHaveBeenCalledWith(['a', 'c'], onProgress);
    expect(onProgress.mock.calls).toEqual([[{ done: 1, total: 2 }], [{ done: 2, total: 2 }]]);
    expect(useAppStore.getState().mods.map((m) => m.id)).toEqual(['b']);
    expect(getMods).not.toHaveBeenCalled();
  });

  it('resyncs and surfaces an unexpected failure', async () => {
    deleteMods.mockRejectedValueOnce(new Error('EBUSY'));
    getMods.mockResolvedValueOnce([mod('b'), mod('c')]);

    await useAppStore.getState().deleteMods(['a', 'c']);

    expect(useAppStore.getState().mods.map((m) => m.id)).toEqual(['b', 'c']);
    expect(useAppStore.getState().modsError).toBe('Error: EBUSY');
  });

  it('keeps the page up when the game refuses the batch', async () => {
    deleteMods.mockRejectedValueOnce(new Error('Game is running'));
    getMods.mockResolvedValueOnce([mod('a'), mod('b'), mod('c')]);

    await useAppStore.getState().deleteMods(['a']);

    expect(useAppStore.getState().mods.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(useAppStore.getState().modsError).toBeNull();
  });
});
