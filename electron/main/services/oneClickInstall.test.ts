import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../src/types/mod';
import type { GameBananaModDetails } from '../../../src/types/gamebanana';

const h = vi.hoisted(() => ({ settings: {} as AppSettings, download: vi.fn(), details: vi.fn(), send: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '' } }));
vi.mock('./download', () => ({ downloadModFromUrl: h.download }));
vi.mock('./gamebanana', () => ({ fetchModDetails: h.details }));
vi.mock('./settings', async importOriginal => ({
    ...(await importOriginal<typeof import('./settings')>()),
    loadSettings: () => h.settings,
}));
vi.mock('./security', () => ({ validateDownloadUrl: vi.fn() }));

import { handleOneClickInstall } from './oneClickInstall';

const window = { webContents: { send: h.send } } as unknown as BrowserWindow;
const parsed = { archiveUrl: 'https://files.gamebanana.com/fixture.zip', modId: 10, modType: 'Mod' };
const details = { id: 10, name: 'Fixture', nsfw: false, files: [] } satisfies GameBananaModDetails;

beforeEach(() => {
    vi.clearAllMocks();
    h.settings = { deadlockPath: 'normal', devDeadlockPath: 'developer', devMode: false } as AppSettings;
    h.download.mockResolvedValue({ installedVpks: [] });
});

describe('one-click installation context', () => {
    it.each([
        { devMode: true },
        { deadlockPath: 'another-install' },
    ])('does not enqueue into the old installation after a lookup and settings change: %j', async patch => {
        let finish!: (details: GameBananaModDetails) => void;
        h.details.mockReturnValueOnce(new Promise<GameBananaModDetails>(resolve => { finish = resolve; }));
        const installing = handleOneClickInstall(parsed, window);
        h.settings = { ...h.settings, ...patch };
        finish(details);
        await installing;
        expect(h.download).not.toHaveBeenCalled();
        expect(h.send).toHaveBeenCalledExactlyOnceWith('one-click-install', {
            ...parsed, error: 'The active mod installation changed. Try the install again.',
        });
    });

    it('allows unrelated preferences to change during lookup and retains its fetched details', async () => {
        let finish!: (details: GameBananaModDetails) => void;
        h.details.mockReturnValueOnce(new Promise<GameBananaModDetails>(resolve => { finish = resolve; }));
        const installing = handleOneClickInstall(parsed, window);
        h.settings = { ...h.settings, keepModBackups: true };
        finish(details);
        await installing;
        expect(h.download).toHaveBeenCalledExactlyOnceWith('normal', {
            ...parsed, enrichedDetails: details,
        }, window);
        expect(h.send).toHaveBeenCalledExactlyOnceWith('one-click-install', { ...parsed, modName: 'Fixture' });
    });
});
