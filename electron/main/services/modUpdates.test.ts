import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../src/types/mod';

const h = vi.hoisted(() => ({
    busy: vi.fn(), create: vi.fn(), copying: vi.fn(), settings: vi.fn(),
    currentDownload: vi.fn(), downloadQueue: vi.fn(),
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('./modUpdateController', () => ({ createModUpdateController: h.create }));
vi.mock('./settings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./settings')>();
    return {
        loadSettings: h.settings,
        getActiveDeadlockPath: (settings: AppSettings = h.settings()) => actual.getActiveDeadlockPath(settings),
    };
});
vi.mock('./gamebanana', () => ({ fetchModDetails: vi.fn() }));
vi.mock('./download', () => ({
    isDownloadCancelled: vi.fn(), isDownloadTargetQueued: vi.fn(),
    getCurrentDownload: h.currentDownload, getDownloadQueue: h.downloadQueue,
}));
vi.mock('./modReplacement', () => ({ queueModReplacement: vi.fn(), readReplacementMods: vi.fn() }));
vi.mock('./snapshots', () => ({ writeSnapshot: vi.fn() }));
vi.mock('./devMods', () => ({ isCopyingModsToDev: h.copying }));
h.create.mockReturnValue({ isBusy: h.busy });
const { assertModUpdateSettingsChange, assertNoModUpdates } = await import('./modUpdates');
const updateContext = h.create.mock.calls[0][0].context;

const settings = { deadlockPath: 'normal', devMode: false, devDeadlockPath: 'sandbox' } as AppSettings;
beforeEach(() => {
    h.busy.mockReturnValue(true);
    h.copying.mockReturnValue(false);
    h.settings.mockReturnValue(settings);
    h.currentDownload.mockReturnValue(null);
    h.downloadQueue.mockReturnValue([]);
});

describe('update installation guards', () => {
    it('blocks switching metadata mode or the active normal path while work remains', () => {
        expect(() => assertModUpdateSettingsChange(settings, { ...settings, devMode: true })).toThrow('Finish or cancel');
        expect(() => assertModUpdateSettingsChange(settings, { ...settings, deadlockPath: 'different' })).toThrow('Finish or cancel');
    });

    it('blocks switching the active developer path and replacing its library', () => {
        const dev = { ...settings, devMode: true };
        expect(() => assertModUpdateSettingsChange(dev, { ...dev, devDeadlockPath: 'different' })).toThrow('Finish or cancel');
        expect(assertNoModUpdates).toThrow('Finish or cancel');
    });

    it('allows unrelated preferences and inactive installation paths to change', () => {
        expect(() => assertModUpdateSettingsChange(settings, { ...settings, accentColor: 'changed', devDeadlockPath: 'inactive' })).not.toThrow();
        const dev = { ...settings, devMode: true };
        expect(() => assertModUpdateSettingsChange(dev, { ...dev, deadlockPath: 'inactive' })).not.toThrow();
    });

    it('allows installation and mode changes after the batch settles', () => {
        h.busy.mockReturnValue(false);
        expect(() => assertModUpdateSettingsChange(settings, { ...settings, devMode: true })).not.toThrow();
        expect(assertNoModUpdates).not.toThrow();
    });

    it.each(['active', 'queued'])('blocks mode and installation changes for %s ordinary downloads', (phase) => {
        h.busy.mockReturnValue(false);
        if (phase === 'active') h.currentDownload.mockReturnValue({ jobId: 'ordinary' });
        else h.downloadQueue.mockReturnValue([{ jobId: 'one-click' }]);

        expect(() => assertModUpdateSettingsChange(settings, { ...settings, devMode: true })).toThrow('Finish or cancel');
        expect(() => assertModUpdateSettingsChange(settings, { ...settings, deadlockPath: 'different' })).toThrow('Finish or cancel');
        expect(assertNoModUpdates).toThrow('Finish or cancel');
        expect(() => assertModUpdateSettingsChange(settings, { ...settings, accentColor: 'changed' })).not.toThrow();
        expect(() => assertModUpdateSettingsChange(settings, { ...settings, devDeadlockPath: 'inactive' })).not.toThrow();
    });

    it('refuses starting updates while a developer-library copy is queued or running', () => {
        h.copying.mockReturnValue(true);
        expect(updateContext).toThrow('developer library copy');
    });
});
