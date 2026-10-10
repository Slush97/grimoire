import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeUpdateFlags } from './updateCheck';
import { listenForModUpdateChanges, UpdateCheckCache } from './updateCheckCache';
import type { DownloadEventData } from '../types/electron';
import type { UpdateFileRow } from './updateFileMatch';

const rows = (id: number): UpdateFileRow[] => [{
  id, fileName: `skin_v${id}.zip`, isArchived: false, description: 'Skin', dateAdded: id * 10000,
}];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('mod update cache refreshes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('shares a file-list request across variants and page remounts', async () => {
    const cache = new UpdateCheckCache();
    const response = deferred<UpdateFileRow[]>();
    const fetch = vi.fn(() => response.promise);
    const first = cache.load(7, fetch);
    const second = cache.load(7, fetch);
    response.resolve(rows(2));
    await Promise.all([first, second]);
    await cache.load(7, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('clears a false update flag after invalidation without changing the installed list', async () => {
    const cache = new UpdateCheckCache();
    const installed = [{ id: 'pak01', gameBananaId: 7, gameBananaFileId: 2, sourceFileName: 'skin_v2' }];
    await cache.load(7, async () => rows(1));
    expect(computeUpdateFlags(installed, cache.rows).updatesAvailable.has('pak01')).toBe(true);
    const notify = vi.fn();
    cache.subscribe(notify);
    const before = cache.getRevision();

    cache.invalidate([7]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(cache.getRevision()).toBeGreaterThan(before);
    await cache.load(7, async () => rows(2));
    expect(computeUpdateFlags(installed, cache.rows).updatesAvailable.size).toBe(0);
  });

  it('notifies an explicit refresh even if the cache was already empty', () => {
    const cache = new UpdateCheckCache();
    const notify = vi.fn();
    const unsubscribe = cache.subscribe(notify);
    cache.invalidate([7, 8]);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
    cache.invalidate([7]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('never lets a pre-download response overwrite the refreshed file list', async () => {
    const cache = new UpdateCheckCache();
    const old = deferred<UpdateFileRow[]>();
    const stale = cache.load(7, () => old.promise);
    cache.invalidate([7]);
    await cache.load(7, async () => rows(2));
    old.resolve(rows(1));
    await stale;
    expect(cache.rows.get(7)).toEqual(rows(2));
  });

  it('does not let an obsolete failure evict a successful refresh', async () => {
    const cache = new UpdateCheckCache();
    const old = deferred<UpdateFileRow[]>();
    const stale = cache.load(7, () => old.promise);
    const rejected = expect(stale).rejects.toThrow('offline');
    cache.invalidate([7]);
    await cache.load(7, async () => rows(2));
    old.reject(new Error('offline'));
    await rejected;
    expect(cache.rows.get(7)).toEqual(rows(2));
  });

  it('retries a failed fetch without treating missing data as an update', async () => {
    const cache = new UpdateCheckCache();
    await expect(cache.load(7, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(computeUpdateFlags([{ id: 'pak01', gameBananaId: 7, gameBananaFileId: 2 }], cache.rows).updatesAvailable.size).toBe(0);
    await cache.load(7, async () => rows(2));
    expect(cache.rows.get(7)).toEqual(rows(2));
  });

  it('retries on focus after an offline check with an unchanged mod list', async () => {
    const cache = new UpdateCheckCache();
    const focusTarget = new EventTarget();
    const stop = listenForModUpdateChanges({ onDownloadComplete: () => () => {} }, focusTarget, cache);
    await expect(cache.load(7, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    const installed = [{ id: 'pak01', gameBananaId: 7, gameBananaFileId: 2 }];
    const refresh = vi.fn(async () => {
      await cache.load(7, async () => rows(2));
      return computeUpdateFlags(installed, cache.rows);
    });
    const unsubscribe = cache.subscribe(() => { void refresh(); });

    focusTarget.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);
    const flags = await refresh.mock.results[0].value;
    expect(flags.updatesAvailable.size).toBe(0);
    expect(cache.rows.get(7)).toEqual(rows(2));
    unsubscribe();
    stop();
  });

  it('refetches expired rows when returning to the page', async () => {
    const cache = new UpdateCheckCache();
    await cache.load(7, async () => rows(1));
    vi.advanceTimersByTime(5 * 60 * 1000);
    await cache.load(7, async () => rows(2));
    expect(cache.rows.get(7)).toEqual(rows(2));
  });

  it('invalidates downloads app-wide, expires on focus, and removes listeners on cleanup', async () => {
    const cache = new UpdateCheckCache();
    await cache.load(7, async () => rows(1));
    await cache.load(8, async () => rows(3));
    let complete!: (event: DownloadEventData) => void;
    const unsubscribe = vi.fn();
    const api = { onDownloadComplete: (callback: typeof complete) => { complete = callback; return unsubscribe; } };
    const focusTarget = new EventTarget();
    const stop = listenForModUpdateChanges(api, focusTarget, cache);
    const notify = vi.fn();
    cache.subscribe(notify);

    complete({ modId: 7, fileId: 2 });
    expect(cache.rows.has(7)).toBe(false);
    expect(cache.rows.get(8)).toEqual(rows(3));
    expect(notify).toHaveBeenCalledTimes(1);
    focusTarget.dispatchEvent(new Event('focus'));
    expect(notify).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60 * 1000);
    focusTarget.dispatchEvent(new Event('focus'));
    expect(cache.rows.size).toBe(0);
    expect(notify).toHaveBeenCalledTimes(2);

    await cache.load(8, async () => rows(4));
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60 * 1000);
    focusTarget.dispatchEvent(new Event('focus'));
    expect(cache.rows.get(8)).toEqual(rows(4));
  });
});
