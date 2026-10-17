import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModBackupSummary } from '../types/modBackup';

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../lib/api', () => ({ listModBackups: api.list }));

import { listenForModBackupChanges, useModBackupsStore } from './modBackupsStore';

const backup = { id: 'old-backup' } as ModBackupSummary;
const newer = { id: 'new-backup' } as ModBackupSummary;

beforeEach(() => {
  useModBackupsStore.setState({ backups: [] });
  api.list.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe('retained mod backup list', () => {
  it('keeps the newest response when a previous refresh finishes late', async () => {
    let resolveFirst!: (backups: ModBackupSummary[]) => void;
    api.list.mockImplementationOnce(() => new Promise<ModBackupSummary[]>((resolve) => { resolveFirst = resolve; }));
    api.list.mockResolvedValueOnce([newer]);
    const first = useModBackupsStore.getState().refresh();
    await useModBackupsStore.getState().refresh();
    resolveFirst([backup]);
    await first;
    expect(useModBackupsStore.getState().backups).toEqual([newer]);
  });

  it('loads backups and refreshes on changes and window focus without consulting the capture setting', async () => {
    let changed!: () => void;
    const unsubscribe = vi.fn();
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    vi.stubGlobal('window', Object.assign(target, {
      electronAPI: { onModBackupsChanged: (callback: () => void) => { changed = callback; return unsubscribe; } },
    }));
    api.list.mockResolvedValue([backup]);
    const stop = listenForModBackupChanges();
    await vi.waitFor(() => expect(useModBackupsStore.getState().backups).toEqual([backup]));
    api.list.mockResolvedValue([]);
    changed();
    await vi.waitFor(() => expect(useModBackupsStore.getState().backups).toEqual([]));
    target.dispatchEvent(new Event('focus'));
    expect(api.list).toHaveBeenCalledTimes(3);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('focus', add.mock.calls[0][1]);
  });
});
