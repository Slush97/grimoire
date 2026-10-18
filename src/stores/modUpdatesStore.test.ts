import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModUpdateState } from '../types/modUpdates';
import { listenForModUpdates, useModUpdatesStore } from './modUpdatesStore';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  loadMods: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('../lib/api', () => ({ startModUpdates: mocks.start }));
vi.mock('../lib/updateCheckCache', () => ({ updateCheckCache: { invalidate: mocks.invalidate } }));
vi.mock('./appStore', () => ({ useAppStore: { getState: () => ({ loadMods: mocks.loadMods }) } }));

const empty = (): ModUpdateState => ({ busy: false, preparing: false, manualRequests: [], errors: [], revision: 0, affectedModIds: [], updatingModIds: [] });
const updating = (updatingModIds: string[]): ModUpdateState => ({
  ...empty(), busy: true, updatingModIds,
});
const request = { id: 'manual-1', modId: 10, modName: 'Example', section: 'Mod', sourceFileIds: [20, 21], sourceModIds: ['a', 'b'] };

describe('global mod update state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.start.mockResolvedValue(undefined);
    mocks.loadMods.mockResolvedValue(undefined);
    useModUpdatesStore.setState({ state: empty(), submittingModIds: new Set(), selectedRequestId: null, dismissedNotices: new Set() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('allows distinct submissions concurrently and guards their own pending IDs', async () => {
    const finishes: (() => void)[] = [];
    mocks.start.mockImplementation(() => new Promise<void>((resolve) => { finishes.push(resolve); }));
    const first = useModUpdatesStore.getState().start(['a', 'a']);
    expect(useModUpdatesStore.getState().submittingModIds).toEqual(new Set(['a']));
    const second = useModUpdatesStore.getState().start(['a', 'b']);
    await useModUpdatesStore.getState().start(['a', 'b']);
    expect(mocks.start).toHaveBeenNthCalledWith(1, { modIds: ['a'] });
    expect(mocks.start).toHaveBeenNthCalledWith(2, { modIds: ['b'] });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(useModUpdatesStore.getState().submittingModIds).toEqual(new Set(['a', 'b']));
    finishes[0]();
    await first;
    expect(useModUpdatesStore.getState().submittingModIds).toEqual(new Set(['b']));
    finishes[1]();
    await second;
    expect(useModUpdatesStore.getState().submittingModIds.size).toBe(0);
  });

  it('starts unrelated files while downloads or manual choices remain', async () => {
    useModUpdatesStore.setState({ state: { ...empty(), busy: true, manualRequests: [request], updatingModIds: ['a', 'b'] } });
    await useModUpdatesStore.getState().start(['a', 'b', 'c']);
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({ modIds: ['c'] });
  });

  it('clears the start guard after a failed request so retry is possible', async () => {
    mocks.start.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined);
    await expect(useModUpdatesStore.getState().start(['a'])).rejects.toThrow('failed');
    expect(useModUpdatesStore.getState().submittingModIds.size).toBe(0);
    await useModUpdatesStore.getState().start(['a']);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it('releases only a failed submission while an earlier submission remains in flight', async () => {
    let finish!: () => void;
    mocks.start.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('failed'));
    const first = useModUpdatesStore.getState().start(['a']);
    await expect(useModUpdatesStore.getState().start(['b'])).rejects.toThrow('failed');
    expect(useModUpdatesStore.getState().submittingModIds).toEqual(new Set(['a']));
    finish();
    await first;
    expect(useModUpdatesStore.getState().submittingModIds.size).toBe(0);
  });

  it('dismissing a notice or closing its dialog retains all unresolved file choices', () => {
    useModUpdatesStore.setState({ state: { ...empty(), busy: true, manualRequests: [request] } });
    useModUpdatesStore.getState().openRequest(request.id);
    useModUpdatesStore.getState().dismissNotice(request.id);
    useModUpdatesStore.getState().closeRequest();
    expect(useModUpdatesStore.getState().state.manualRequests).toEqual([request]);
    expect(useModUpdatesStore.getState().dismissedNotices.has(request.id)).toBe(true);
    useModUpdatesStore.getState().openRequest(request.id);
    expect(useModUpdatesStore.getState().selectedRequestId).toBe(request.id);
  });

  it('hydrates state and refreshes installed mods only when completion revision changes', async () => {
    let onUpdate!: (state: ModUpdateState) => void;
    const unsubscribe = vi.fn();
    vi.stubGlobal('window', { electronAPI: {
      getModUpdateState: vi.fn().mockResolvedValue({ ...updating(['a', 'b']), manualRequests: [request] }),
      onModUpdateStateUpdated: vi.fn((callback) => { onUpdate = callback; return unsubscribe; }),
    } });
    const stop = listenForModUpdates();
    await Promise.resolve();
    expect(useModUpdatesStore.getState().state.manualRequests).toEqual([request]);
    expect(useModUpdatesStore.getState().state.updatingModIds).toEqual(['a', 'b']);
    expect(mocks.loadMods).not.toHaveBeenCalled();
    await useModUpdatesStore.getState().start(['a', 'b', 'c']);
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({ modIds: ['c'] });
    useModUpdatesStore.getState().openRequest(request.id);
    onUpdate({ ...empty(), revision: 1, affectedModIds: [10] });
    expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith([10]);
    expect(mocks.loadMods).toHaveBeenCalledExactlyOnceWith({ silent: true, afterCurrent: true });
    expect(useModUpdatesStore.getState().selectedRequestId).toBeNull();
    onUpdate({ ...empty(), revision: 1, affectedModIds: [10] });
    expect(mocks.loadMods).toHaveBeenCalledTimes(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('preserves a newer event over stale hydration and ignores reads after unmount', async () => {
    let hydrate!: (state: ModUpdateState) => void;
    let onUpdate!: (state: ModUpdateState) => void;
    vi.stubGlobal('window', { electronAPI: {
      getModUpdateState: vi.fn(() => new Promise<ModUpdateState>((resolve) => { hydrate = resolve; })),
      onModUpdateStateUpdated: vi.fn((callback) => { onUpdate = callback; return vi.fn(); }),
    } });
    const stop = listenForModUpdates();
    onUpdate({ ...updating(['a', 'b']), manualRequests: [request] });
    hydrate(empty());
    await Promise.resolve();
    expect(useModUpdatesStore.getState().state.busy).toBe(true);
    stop();
    onUpdate(empty());
    expect(useModUpdatesStore.getState().state.busy).toBe(true);
  });

  it('refreshes completed installs but invalidates the full update cache only when the batch settles', async () => {
    let onUpdate!: (state: ModUpdateState) => void;
    vi.stubGlobal('window', { electronAPI: {
      getModUpdateState: vi.fn().mockResolvedValue(empty()),
      onModUpdateStateUpdated: vi.fn((callback) => { onUpdate = callback; return vi.fn(); }),
    } });
    const stop = listenForModUpdates();
    await Promise.resolve();
    onUpdate({ ...empty(), busy: true, revision: 1, affectedModIds: [10, 11] });
    onUpdate({ ...empty(), busy: true, revision: 2, affectedModIds: [10, 11] });
    expect(mocks.loadMods).toHaveBeenCalledTimes(2);
    expect(mocks.loadMods).toHaveBeenNthCalledWith(1, { silent: true, afterCurrent: true });
    expect(mocks.loadMods).toHaveBeenNthCalledWith(2, { silent: true, afterCurrent: true });
    expect(mocks.invalidate).not.toHaveBeenCalled();
    onUpdate({ ...empty(), revision: 2, affectedModIds: [10, 11] });
    expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith([10, 11]);
    expect(mocks.loadMods).toHaveBeenLastCalledWith({ silent: true, afterCurrent: true });
    stop();
  });
});
