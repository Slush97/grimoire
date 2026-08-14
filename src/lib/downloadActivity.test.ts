import { describe, expect, it } from 'vitest';
import {
  applyDownloadExtracting,
  applyDownloadProgress,
  cancelDownloadRequest,
  getVisibleDownloadQueue,
  isDownloadRequestPending,
  isModDownloadPending,
  requestDownload,
  selectFileDownloadActivity,
  type DownloadActivitySnapshot,
} from './downloadActivity';

const item = (modId: number, fileId: number) => ({ modId, fileId, fileName: `${fileId}.zip` });
const state = (over: Partial<DownloadActivitySnapshot> = {}): DownloadActivitySnapshot => ({
  current: null,
  queue: [],
  requested: [],
  progress: null,
  extracting: false,
  ...over,
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
