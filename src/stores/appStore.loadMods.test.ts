import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import * as api from '../lib/api';
import { useAppStore } from './appStore';

const completions = vi.hoisted(() => ({ pending: vi.fn(), acknowledge: vi.fn() }));
vi.mock('../lib/downloadActivity', () => ({
  getPendingDownloadCompletions: completions.pending,
  acknowledgeDownloadCompletions: completions.acknowledge,
}));

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
    completions.pending.mockReset().mockReturnValue([]);
    completions.acknowledge.mockReset();
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

  it('starts a fresh generation when a post-mutation reload is forced', async () => {
    let resolveFirst!: (mods: Mod[]) => void;
    let resolveSecond!: (mods: Mod[]) => void;
    getMods
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    const first = useAppStore.getState().loadMods();
    const forced = useAppStore.getState().loadMods({ force: true });
    expect(getMods).toHaveBeenCalledTimes(2);

    resolveSecond([mod('after-mutation')]);
    await forced;
    resolveFirst([mod('stale')]);
    await first;

    expect(useAppStore.getState().mods.map((entry) => entry.id)).toEqual(['after-mutation']);
  });

  it('coalesces completed updates into a fresh scan after an older read finishes', async () => {
    let resolveFirst!: (mods: Mod[]) => void;
    let resolveFresh!: (mods: Mod[]) => void;
    getMods
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveFresh = resolve; }));

    const first = useAppStore.getState().loadMods();
    const completion = useAppStore.getState().loadMods({ silent: true, afterCurrent: true });
    const nextCompletion = useAppStore.getState().loadMods({ silent: true, afterCurrent: true });
    expect(getMods).toHaveBeenCalledTimes(1);

    resolveFirst([mod('old')]);
    await first;
    expect(getMods).toHaveBeenCalledTimes(2);
    resolveFresh([mod('updated')]);
    await Promise.all([completion, nextCompletion]);
    expect(getMods).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().mods.map((entry) => entry.id)).toEqual(['updated']);
    expect(useAppStore.getState().modsLoading).toBe(false);
  });

  it('refreshes again when another update completes during a follow-up scan', async () => {
    let resolveFirst!: (mods: Mod[]) => void;
    let resolveFresh!: (mods: Mod[]) => void;
    getMods
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveFresh = resolve; }))
      .mockResolvedValueOnce([mod('last-update')]);

    const first = useAppStore.getState().loadMods();
    const completion = useAppStore.getState().loadMods({ silent: true, afterCurrent: true });
    resolveFirst([mod('old')]);
    await first;
    const nextCompletion = useAppStore.getState().loadMods({ silent: true, afterCurrent: true });
    expect(getMods).toHaveBeenCalledTimes(2);

    resolveFresh([mod('first-update')]);
    await Promise.all([completion, nextCompletion]);
    expect(getMods).toHaveBeenCalledTimes(3);
    expect(useAppStore.getState().mods.map((entry) => entry.id)).toEqual(['last-update']);
  });

  it('starts a completion refresh immediately when no scan is in flight', async () => {
    getMods.mockResolvedValueOnce([mod('updated')]);
    await useAppStore.getState().loadMods({ silent: true, afterCurrent: true });
    expect(getMods).toHaveBeenCalledOnce();
    expect(useAppStore.getState().mods.map((entry) => entry.id)).toEqual(['updated']);
  });

  it('releases completed file actions only after publishing the refreshed installed mods', async () => {
    const captured = [{ modId: 7, fileId: 10, jobId: 'completed' }];
    completions.pending.mockReturnValue(captured);
    getMods.mockResolvedValueOnce([mod('updated')]);
    completions.acknowledge.mockImplementation(() => {
      expect(useAppStore.getState().mods.map(entry => entry.id)).toEqual(['updated']);
    });
    await useAppStore.getState().loadMods({ silent: true });
    expect(completions.acknowledge).toHaveBeenCalledExactlyOnceWith(captured);
  });

  it('does not release completions that arrive after a scan starts or from a superseded scan', async () => {
    let resolveOld!: (mods: Mod[]) => void;
    let resolveFresh!: (mods: Mod[]) => void;
    const oldCompletion = [{ modId: 7, fileId: 10, jobId: 'old' }];
    const laterCompletions = [...oldCompletion, { modId: 7, fileId: 11, jobId: 'later' }];
    completions.pending.mockReturnValueOnce(oldCompletion).mockReturnValueOnce(laterCompletions);
    getMods
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveFresh = resolve; }));
    const old = useAppStore.getState().loadMods({ silent: true });
    const fresh = useAppStore.getState().loadMods({ silent: true, force: true });
    resolveOld([mod('stale')]);
    await old;
    expect(completions.acknowledge).not.toHaveBeenCalled();
    resolveFresh([mod('updated')]);
    await fresh;
    expect(completions.acknowledge).toHaveBeenCalledExactlyOnceWith(laterCompletions);
  });

  it('retains completed actions when the refresh fails so stale update actions stay unavailable', async () => {
    const captured = [{ modId: 7, fileId: 10 }];
    completions.pending.mockReturnValue(captured);
    getMods.mockRejectedValueOnce(new Error('scan failed')).mockResolvedValueOnce([mod('updated')]);
    await useAppStore.getState().loadMods({ silent: true });
    expect(completions.acknowledge).not.toHaveBeenCalled();
    await useAppStore.getState().loadMods({ silent: true });
    expect(completions.acknowledge).toHaveBeenCalledExactlyOnceWith(captured);
  });
});
