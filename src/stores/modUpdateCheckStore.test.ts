import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Mod } from '../types/mod';
import type { UpdateFileRow } from '../lib/updateFileMatch';
import { listenForModUpdateChanges, updateCheckCache } from '../lib/updateCheckCache';
import { useAppStore } from './appStore';
import { listenForModUpdateChecks, useModUpdateCheckStore } from './modUpdateCheckStore';

const mocks = vi.hoisted(() => ({ files: vi.fn() }));
vi.mock('../lib/api', () => ({ getModFileList: mocks.files }));
vi.mock('./appStore', async () => {
  const { createStore } = await import('zustand/vanilla');
  return { useAppStore: createStore(() => ({ mods: [], settings: null })) };
});

const settings = (extra: Partial<AppSettings> = {}): AppSettings => ({
  deadlockPath: 'normal', devDeadlockPath: 'dev', devMode: false,
  autoMatchRemainingFiles: true, ...extra,
} as AppSettings);
const mod = (id: string, extra: Partial<Mod> = {}): Mod => ({
  id, name: id, fileName: `${id}.vpk`, path: id, metaKey: id,
  enabled: false, priority: 1, size: 0, installedAt: '2026-01-01',
  gameBananaId: 7, gameBananaFileId: 1, fileDescription: 'Skin', ...extra,
});
const rows = (id = 2): UpdateFileRow[] => [{ id, fileName: `skin_v${id}.zip`, description: 'Skin', isArchived: false }];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe('app-wide mod update checks', () => {
  let stop = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.clearAllMocks();
    updateCheckCache.invalidate(Array.from({ length: 12 }, (_, i) => i + 1));
    useAppStore.setState({ settings: settings(), mods: [mod('old')] });
    useModUpdateCheckStore.setState({ updatesAvailable: new Set(), staleMergeSources: new Map() });
    mocks.files.mockReset().mockResolvedValue({ files: rows() });
  });
  afterEach(() => { stop(); vi.useRealTimers(); });

  it('checks without Installed mounted and retains results when page subscribers leave', async () => {
    const response = deferred<{ files: UpdateFileRow[] }>();
    mocks.files.mockReturnValue(response.promise);
    useAppStore.setState({ mods: [mod('a'), mod('b')] });
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledExactlyOnceWith(7, 'Mod'));

    const unsubscribePage = useModUpdateCheckStore.subscribe(() => {});
    unsubscribePage();
    response.resolve({ files: rows() });
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable).toEqual(new Set(['a', 'b'])));
    useAppStore.setState({ modsLoading: true });
    expect(mocks.files).toHaveBeenCalledTimes(1);
    expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(2);
  });

  it('refreshes invalidated files without any page subscribing', async () => {
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.has('old')).toBe(true));
    mocks.files.mockResolvedValue({ files: rows(1) });
    updateCheckCache.invalidate([7]);
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0));
    expect(mocks.files).toHaveBeenCalledTimes(2);
  });

  it('drops a completed predecessor flag immediately when its local ID is reused', async () => {
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.has('old')).toBe(true));
    const response = deferred<{ files: UpdateFileRow[] }>();
    mocks.files.mockReturnValue(response.promise);
    updateCheckCache.invalidate([7]);
    await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledTimes(2));
    useAppStore.setState({ mods: [mod('old', { gameBananaFileId: 2 })] });
    expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0);
    response.resolve({ files: rows() });
    await vi.waitFor(() => expect(updateCheckCache.rows.get(7)).toEqual(rows()));
    expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0);
  });

  it('does not publish obsolete flags when the installed library changes mid-check', async () => {
    const response = deferred<{ files: UpdateFileRow[] }>();
    mocks.files.mockReturnValue(response.promise);
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledOnce());
    const publish = vi.fn();
    const unsubscribe = useModUpdateCheckStore.subscribe(publish);

    useAppStore.setState({
      settings: settings({ devMode: true }),
      mods: [mod('dev-current', { gameBananaFileId: 2 })],
    });
    response.resolve({ files: rows() });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0);
    expect(mocks.files).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('reclassifies preference changes without downloading the same file list again', async () => {
    const renamed = [
      { id: 1, fileName: 'old_name.zip', isArchived: true },
      { id: 2, fileName: 'new_name.zip', isArchived: false },
    ];
    useAppStore.setState({ mods: [mod('renamed', { fileDescription: undefined, sourceFileName: 'old_name' })] });
    mocks.files.mockResolvedValue({ files: renamed });
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.has('renamed')).toBe(true));
    useAppStore.setState({ settings: settings({ autoMatchRemainingFiles: false }) });
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0));
    expect(mocks.files).toHaveBeenCalledOnce();
  });

  it('keeps merge ingredients informational and excludes ignored and Locker files', async () => {
    useAppStore.setState({ mods: [
      mod('ignored', { ignoreUpdates: true }),
      mod('locker', { gameBananaId: 9, lockerCosmetics: { cards: [], rebuiltAt: '' } }),
      mod('absorbed', { gameBananaId: 8, fileName: 'part.vpk' }),
      mod('merged', {
        gameBananaId: undefined, gameBananaFileId: undefined,
        merged: { id: 'merge', createdAt: '', shareCode: '', sources: [{
          fileName: 'part.vpk', modName: 'Part', gameBananaId: 8, gameBananaFileId: 1,
          section: 'Sound', enabledAtMergeTime: false, priorityAtMergeTime: 1,
        }] },
      }),
    ] });
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().staleMergeSources).toEqual(new Map([['merged', new Set(['part.vpk'])]])));
    expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0);
    expect(mocks.files).toHaveBeenCalledExactlyOnceWith(8, 'Sound');
  });

  it('never exceeds five in-flight requests when library changes restart a pass', async () => {
    const responses = Array.from({ length: 7 }, () => deferred<{ files: UpdateFileRow[] }>());
    let inFlight = 0;
    let peak = 0;
    mocks.files.mockImplementation((id: number) => {
      peak = Math.max(peak, ++inFlight);
      return responses[id - 1].promise.finally(() => { inFlight -= 1; });
    });
    const mods = responses.map((_, i) => mod(`m${i + 1}`, { gameBananaId: i + 1 }));
    useAppStore.setState({ mods });
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledTimes(5));
    useAppStore.setState({ mods: mods.map(item => item.gameBananaId === 7 ? { ...item, ignoreUpdates: true } : item) });
    for (const response of responses.slice(0, 5)) response.resolve({ files: rows() });
    await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledTimes(6));
    responses[5].resolve({ files: rows() });
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(6));
    expect(peak).toBe(5);
    expect(mocks.files).not.toHaveBeenCalledWith(7, expect.anything());
  });

  it('retries failed checks on focus and refetches only expired cached rows', async () => {
    const focus = new EventTarget();
    const stopEvents = listenForModUpdateChanges({ onDownloadComplete: () => () => {} }, focus);
    mocks.files.mockRejectedValueOnce(new Error('offline'));
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledOnce());
    focus.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.has('old')).toBe(true));
    focus.dispatchEvent(new Event('focus'));
    expect(mocks.files).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30 * 60 * 1000);
    mocks.files.mockResolvedValue({ files: rows(1) });
    focus.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0));
    expect(mocks.files).toHaveBeenCalledTimes(3);
    stopEvents();
  });

  it('clears results when the installation is removed and stops reacting after cleanup', async () => {
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.has('old')).toBe(true));
    useAppStore.setState({ settings: settings({ deadlockPath: null }) });
    await vi.waitFor(() => expect(useModUpdateCheckStore.getState().updatesAvailable.size).toBe(0));
    stop();
    useAppStore.setState({ settings: settings(), mods: [mod('other', { gameBananaId: 8 })] });
    updateCheckCache.invalidate([7]);
    expect(mocks.files).toHaveBeenCalledOnce();
  });

  it('shares in-flight requests across listener restarts and discards the stopped pass', async () => {
    const response = deferred<{ files: UpdateFileRow[] }>();
    mocks.files.mockReturnValue(response.promise);
    stop = listenForModUpdateChecks();
    await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledOnce());
    stop();
    stop = listenForModUpdateChecks();
    const publish = vi.fn();
    const unsubscribe = useModUpdateCheckStore.subscribe(publish);
    response.resolve({ files: rows() });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    expect(useModUpdateCheckStore.getState().updatesAvailable).toEqual(new Set(['old']));
    expect(mocks.files).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
