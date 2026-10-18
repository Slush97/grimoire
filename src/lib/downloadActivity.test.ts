// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEventData, DownloadProgressData, DownloadQueueData, DownloadQueueItem, ElectronAPI } from '../types/electron';
import {
  applyDownloadExtracting,
  applyDownloadProgress,
  acknowledgeDownloadCompletions,
  cancelDownloadRequest,
  getVisibleDownloadQueue,
  getPendingDownloadCompletions,
  isDownloadRequestPending,
  isModDownloadPending,
  requestDownload,
  selectFileDownloadActivity,
  useDownloadActivity,
  useDownloadQueueActivity,
  usePendingDownloadCompletions,
  type DownloadActivitySnapshot,
} from './downloadActivity';

const item = (modId: number, fileId: number) => ({ modId, fileId, fileName: `${fileId}.zip` });
const state = (over: Partial<DownloadActivitySnapshot> = {}): DownloadActivitySnapshot => ({
  current: null,
  queue: [],
  requested: [],
  finishing: [],
  progress: null,
  extracting: false,
  ...over,
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('download progress subscriptions', () => {
  let root: Root;
  let host: HTMLDivElement;
  let now: number;
  let progress: (data: DownloadProgressData) => void;
  let queue: (data: DownloadQueueData) => void;
  let extracting: (data: DownloadEventData) => void;
  let complete: (data: DownloadEventData) => void;
  let fail: (data: DownloadEventData) => void;
  let latest: DownloadActivitySnapshot;
  let renders: number;
  let queueRenders: number;
  let previousApi: ElectronAPI;
  const active = item(7, 10);
  const sample = (downloaded: number, total = 1000) => ({ modId: 7, fileId: 10, downloaded, total });
  const showCurrent = (current: DownloadQueueItem = active) => queue({ queue: [], count: 0, currentDownload: current });

  function ActivityProbe() {
    latest = useDownloadActivity();
    renders++;
    return null;
  }
  function QueueProbe() {
    useDownloadQueueActivity();
    queueRenders++;
    return null;
  }

  beforeEach(async () => {
    acknowledgeDownloadCompletions(getPendingDownloadCompletions());
    now = 1000;
    renders = 0;
    queueRenders = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    previousApi = window.electronAPI;
    window.electronAPI = {
      getDownloadQueue: async () => [],
      getCurrentDownload: async () => null,
      onDownloadQueueUpdated: (callback: typeof queue) => { queue = callback; return vi.fn(); },
      onDownloadProgress: (callback: typeof progress) => { progress = callback; return vi.fn(); },
      onDownloadExtracting: (callback: typeof extracting) => { extracting = callback; return vi.fn(); },
      onDownloadComplete: (callback: typeof complete) => { complete = callback; return vi.fn(); },
      onDownloadError: (callback: typeof fail) => { fail = callback; return vi.fn(); },
    } as unknown as ElectronAPI;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement('div', null, createElement(ActivityProbe), createElement(QueueProbe))));
    act(() => showCurrent());
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.electronAPI = previousApi;
    vi.restoreAllMocks();
  });

  it('bounds chunk-driven renders to ten per second and preserves the queue snapshot', () => {
    const initial = renders;
    const initialQueue = queueRenders;
    for (let index = 0; index < 100; index++) {
      now = 1000 + index * 10;
      act(() => progress(sample(index + 1)));
    }
    expect(renders - initial).toBe(10);
    expect(latest.progress).toEqual({ downloaded: 91, total: 1000 });
    expect(queueRenders).toBe(initialQueue);
    act(() => progress(sample(1000)));
    expect(latest.progress).toEqual({ downloaded: 1000, total: 1000 });
    expect(renders - initial).toBe(11);
  });

  it('retains replacement sources until a fresh scan without redrawing on byte progress', async () => {
    let finishingRenders = 0;
    let finishing: readonly DownloadEventData[] = [];
    function FinishingProbe() {
      finishing = usePendingDownloadCompletions();
      finishingRenders++;
      return null;
    }
    await act(async () => root.render(createElement(FinishingProbe)));
    const initial = finishingRenders;
    act(() => progress(sample(100)));
    expect(finishingRenders).toBe(initial);
    const completed = { ...active, jobId: 'replacement', replacementModIds: ['old-a', 'old-b'] };
    act(() => complete(completed));
    expect(finishing).toEqual([completed]);
    expect(finishingRenders).toBe(initial + 1);
    const captured = getPendingDownloadCompletions();
    act(() => showCurrent(item(7, 11)));
    expect(finishing).toEqual([completed]);
    expect(finishingRenders).toBe(initial + 1);
    act(() => acknowledgeDownloadCompletions(captured));
    expect(finishing).toEqual([]);
  });

  it('does not treat an unknown total as a finished download', () => {
    act(() => progress(sample(1, 0)));
    now++;
    act(() => progress(sample(2, 0)));
    expect(latest.progress).toEqual({ downloaded: 1, total: 0 });
  });

  it('reports a new target immediately and ignores late events from the previous one', () => {
    act(() => progress(sample(1)));
    now++;
    act(() => showCurrent(item(7, 11)));
    act(() => progress(sample(2)));
    expect(latest.progress).toBeNull();
    act(() => progress({ ...sample(3), fileId: 11 }));
    expect(latest.progress?.downloaded).toBe(3);
  });

  it('hydrates retained progress when switching jobs and keeps paused queue snapshots', () => {
    const paused = { ...active, jobId: 'first', phase: 'paused' as const, progress: { downloaded: 350, total: 1000 } };
    act(() => queue({ queue: [paused], count: 1, currentDownload: { ...item(7, 11), jobId: 'second', phase: 'downloading', progress: { downloaded: 80, total: 200 } } }));
    expect(latest.progress).toEqual({ downloaded: 80, total: 200 });
    expect(latest.queue).toEqual([paused]);
    act(() => queue({ queue: [], count: 0, currentDownload: { ...paused, phase: 'downloading' } }));
    expect(latest.progress).toEqual(paused.progress);
  });

  it('resets presentation for a different job of the same target and ignores stale job samples', () => {
    act(() => showCurrent({ ...active, jobId: 'old', phase: 'installing' }));
    expect(latest.extracting).toBe(true);
    act(() => showCurrent({ ...active, jobId: 'new', phase: 'downloading', progress: { downloaded: 20, total: 100 } }));
    expect(latest.extracting).toBe(false);
    act(() => progress({ ...sample(900), jobId: 'old' }));
    expect(latest.progress).toEqual({ downloaded: 20, total: 100 });
    act(() => progress({ ...sample(30, 100), jobId: 'new' }));
    expect(latest.progress).toEqual({ downloaded: 30, total: 100 });
    act(() => complete({ ...active, jobId: 'old' }));
    expect(latest.progress).toEqual({ downloaded: 30, total: 100 });
  });

  it('publishes safe transfer restarts immediately rather than retaining stale paused progress', () => {
    act(() => progress(sample(700)));
    now++;
    act(() => progress(sample(0)));
    expect(latest.progress?.downloaded).toBe(0);
  });

  it('keeps a completed file busy after the FIFO advances until its library refresh is acknowledged', () => {
    const completed = { ...active, jobId: 'completed' };
    act(() => showCurrent(completed));
    act(() => complete(completed));
    const captured = getPendingDownloadCompletions();
    act(() => showCurrent(item(7, 11)));

    expect(selectFileDownloadActivity(latest, 7, 10)).toEqual({ phase: 'finishing' });
    expect(requestDownload(active)).toBe(false);
    expect(getVisibleDownloadQueue(latest)).toEqual({ current: item(7, 11), queue: [] });

    act(() => acknowledgeDownloadCompletions(captured));
    expect(selectFileDownloadActivity(latest, 7, 10)).toEqual({ phase: 'idle' });
  });

  it('acknowledges only the completions captured before a scan and preserves newer jobs of the same target', () => {
    const first = { ...active, jobId: 'first' };
    act(() => complete(first));
    const captured = getPendingDownloadCompletions();
    const later = { ...active, jobId: 'later' };
    act(() => complete(later));
    act(() => acknowledgeDownloadCompletions(captured));
    expect(getPendingDownloadCompletions()).toEqual([later]);
  });

  it('does not retain failed or canceled jobs as completed installs', () => {
    act(() => fail(active));
    act(() => queue({ queue: [], count: 0, currentDownload: null }));
    expect(selectFileDownloadActivity(latest, 7, 10)).toEqual({ phase: 'idle' });
    expect(getPendingDownloadCompletions()).toEqual([]);
  });

  it('hydrates phase and saved bytes after a UI subscription restarts', async () => {
    act(() => root.unmount());
    vi.spyOn(window.electronAPI, 'getCurrentDownload').mockResolvedValue({
      ...item(8, 12), jobId: 'restored', phase: 'finalizing', progress: { downloaded: 100, total: 100 },
    });
    root = createRoot(host);
    await act(async () => root.render(createElement(ActivityProbe)));
    expect(latest.current?.jobId).toBe('restored');
    expect(latest.progress).toEqual({ downloaded: 100, total: 100 });
    expect(latest.extracting).toBe(true);
  });

  it('refreshes saved bytes for the same job after resubscribing', async () => {
    act(() => showCurrent({ ...active, jobId: 'same', progress: { downloaded: 20, total: 100 } }));
    act(() => root.unmount());
    vi.spyOn(window.electronAPI, 'getCurrentDownload').mockResolvedValue({
      ...active, jobId: 'same', phase: 'downloading', progress: { downloaded: 70, total: 100 },
    });
    root = createRoot(host);
    await act(async () => root.render(createElement(ActivityProbe)));
    expect(latest.progress).toEqual({ downloaded: 70, total: 100 });
  });

  it('preserves distinct backend jobs sharing a synthetic one-click target during hydration', async () => {
    act(() => root.unmount());
    const queued = { ...item(-1, -1), jobId: 'waiting' };
    const current = { ...item(-1, -1), jobId: 'active' };
    vi.spyOn(window.electronAPI, 'getCurrentDownload').mockResolvedValue(current);
    vi.spyOn(window.electronAPI, 'getDownloadQueue').mockResolvedValue([current, queued]);
    root = createRoot(host);
    await act(async () => root.render(createElement(ActivityProbe)));
    expect(latest.current).toEqual(current);
    expect(latest.queue).toEqual([queued]);
  });

  it('ignores hydration from a subscription that has been removed', async () => {
    act(() => root.unmount());
    let hydrateQueue!: (items: ReturnType<typeof item>[]) => void;
    let hydrateCurrent!: (current: ReturnType<typeof item>) => void;
    vi.spyOn(window.electronAPI, 'getDownloadQueue')
      .mockImplementationOnce(() => new Promise((resolve) => { hydrateQueue = resolve; }))
      .mockResolvedValueOnce([]);
    vi.spyOn(window.electronAPI, 'getCurrentDownload')
      .mockImplementationOnce(() => new Promise((resolve) => { hydrateCurrent = resolve; }))
      .mockResolvedValueOnce(item(7, 11));
    root = createRoot(host);
    await act(async () => root.render(createElement(ActivityProbe)));
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(ActivityProbe)));
    expect(latest.current).toEqual(item(7, 11));

    await act(async () => {
      hydrateQueue([item(7, 10)]);
      hydrateCurrent(item(7, 9));
    });
    expect(latest.current).toEqual(item(7, 11));
    expect(latest.queue).toEqual([]);
  });

  it.each(['extracting', 'complete', 'cancel'] as const)('resets throttling after %s', (phase) => {
    act(() => progress(sample(1)));
    now++;
    act(() => {
      if (phase === 'extracting') extracting(active);
      else if (phase === 'complete') complete(active);
      else fail(active);
    });
    act(() => progress(sample(2)));
    expect(latest.progress?.downloaded).toBe(2);
    expect(latest.extracting).toBe(false);
  });
});

describe('download activity selectors', () => {
  it('distinguishes active, queued, and unrelated variants of one mod', () => {
    const snapshot = state({
      current: item(7, 10),
      queue: [item(7, 11)],
      progress: { downloaded: 25, total: 100 },
    });

    expect(selectFileDownloadActivity(snapshot, 7, 10)).toEqual({
      phase: 'downloading',
      progress: { downloaded: 25, total: 100 },
    });
    expect(selectFileDownloadActivity(snapshot, 7, 11)).toEqual({ phase: 'queued', position: 1 });
    expect(selectFileDownloadActivity(snapshot, 7, 12)).toEqual({ phase: 'idle' });
  });

  it('shows an optimistic first click as starting and later clicks as queued', () => {
    const snapshot = state({ requested: [item(7, 10), item(7, 11)] });
    expect(selectFileDownloadActivity(snapshot, 7, 10).phase).toBe('starting');
    expect(selectFileDownloadActivity(snapshot, 7, 11)).toEqual({ phase: 'queued', position: 2 });
    expect(getVisibleDownloadQueue(snapshot)).toEqual({
      current: item(7, 10),
      queue: [item(7, 11)],
    });
  });

  it('tracks pending state by mod without confusing identical file ids from another mod', () => {
    const snapshot = state({ current: item(7, 10) });
    expect(isModDownloadPending(snapshot, 7)).toBe(true);
    expect(isModDownloadPending(snapshot, 8)).toBe(false);
    expect(selectFileDownloadActivity(snapshot, 8, 10).phase).toBe('idle');
  });

  it('ignores progress and extracting events until the current target is known', () => {
    const unknown = state();
    expect(applyDownloadProgress(unknown, {
      modId: 7,
      fileId: 10,
      downloaded: 25,
      total: 100,
    })).toBe(unknown);
    expect(applyDownloadExtracting(unknown, { modId: 7, fileId: 10 })).toBe(unknown);

    const active = state({ current: item(7, 10) });
    expect(applyDownloadProgress(active, {
      modId: 8,
      fileId: 10,
      downloaded: 50,
      total: 100,
    })).toBe(active);
    expect(applyDownloadProgress(active, {
      modId: 7,
      fileId: 10,
      downloaded: 50,
      total: 100,
    }).progress).toEqual({ downloaded: 50, total: 100 });
  });

  it('cancels an optimistic request before it crosses IPC', () => {
    expect(requestDownload(item(9, 20))).toBe(true);
    expect(isDownloadRequestPending(9, 20)).toBe(true);
    expect(cancelDownloadRequest(9, 20)).toBe(true);
    expect(isDownloadRequestPending(9, 20)).toBe(false);
    expect(cancelDownloadRequest(9, 20)).toBe(false);
  });
});
