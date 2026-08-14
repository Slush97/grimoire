import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import * as api from '../lib/api';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({
  default: { t: (key: string) => key },
  applyLanguagePreference: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  getMods: vi.fn(),
}));

const getMods = vi.mocked(api.getMods);

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

describe('appStore loadMods refreshes', () => {
  beforeEach(() => {
    getMods.mockReset();
    useAppStore.setState({
      mods: [],
      modsLoaded: false,
      modsLoading: false,
      modsError: null,
    });
  });

  it('shares overlapping scans requested for the same generation', async () => {
    let resolveScan!: (mods: Mod[]) => void;
    getMods.mockReturnValueOnce(new Promise((resolve) => { resolveScan = resolve; }));

    const first = useAppStore.getState().loadMods();
    const second = useAppStore.getState().loadMods();
    expect(getMods).toHaveBeenCalledTimes(1);

    resolveScan([mod('one')]);
    await Promise.all([first, second]);
    expect(useAppStore.getState().mods.map((entry) => entry.id)).toEqual(['one']);
  });

  it('does not publish or enter loading state for an unchanged loaded library', async () => {
    const existing = mod('one');
    useAppStore.setState({ mods: [existing], modsLoaded: true });
    getMods.mockResolvedValueOnce([{ ...existing }]);
    let publications = 0;
    const unsubscribe = useAppStore.subscribe(() => { publications += 1; });

    await useAppStore.getState().loadMods();

    unsubscribe();
    expect(useAppStore.getState().mods).toEqual([existing]);
    expect(useAppStore.getState().modsLoading).toBe(false);
    expect(publications).toBe(0);
  });
});
