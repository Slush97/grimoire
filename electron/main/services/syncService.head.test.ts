import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), upsert: vi.fn(), updateState: vi.fn(), send: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] } }));
vi.mock('./gamebanana', () => ({ fetchSubmissions: mocks.fetch }));
vi.mock('./modDatabase', () => ({ upsertMods: mocks.upsert, getSyncState: vi.fn(), updateSyncState: mocks.updateState, getModCount: () => 0 }));
import { isSyncInProgress, syncCatalogHead } from './syncService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset().mockResolvedValue({ records: [], totalCount: 5000, perPage: 50 });
});

describe('catalog head refresh', () => {
  it('fetches only page one of the selected sections without claiming a full sync', async () => {
    await syncCatalogHead(['Sound', 'Sound', 'Wip']);
    expect(mocks.fetch.mock.calls.map(args => args.slice(0, 3))).toEqual([['Sound', 1, 50], ['Wip', 1, 50]]);
    expect(mocks.fetch.mock.calls.every(args => args[5] === 'updated')).toBe(true);
    expect(mocks.updateState).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('shares a pending section refresh and waits for it before completing', async () => {
    let resolve!: (response: { records: []; totalCount: number }) => void;
    mocks.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const first = syncCatalogHead(['Mod']); const second = syncCatalogHead(['Mod']);
    expect(mocks.fetch).toHaveBeenCalledOnce(); expect(isSyncInProgress()).toBe(true);
    resolve({ records: [], totalCount: 0 }); await Promise.all([first, second]);
    expect(mocks.upsert).toHaveBeenCalledOnce(); expect(isSyncInProgress()).toBe(false);
  });

  it('retains other sections on failure, reports the error and releases the request for retry', async () => {
    const failure = new Error('offline'); mocks.fetch.mockRejectedValueOnce(failure);
    await expect(syncCatalogHead(['Mod', 'Sound'])).rejects.toBe(failure);
    expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(isSyncInProgress()).toBe(false);
    await syncCatalogHead(['Mod']); expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid sections before issuing requests', async () => {
    await expect(syncCatalogHead(['Gui'])).rejects.toThrow('Invalid catalog section');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
