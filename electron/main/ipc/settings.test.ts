import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../services/settings';

const h = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    load: vi.fn(), save: vi.fn(), exclusive: vi.fn(),
    updater: vi.fn(), background: vi.fn(), bridge: vi.fn(), crosshair: vi.fn(), audit: vi.fn(), hydrate: vi.fn(),
    copy: vi.fn(), updateGuard: vi.fn(), copyGuard: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(name, handler) } }));
vi.mock('../services/settings', () => ({ loadSettings: h.load, saveSettings: h.save, getActiveDeadlockPath: () => 'game' }));
vi.mock('../services/mods', () => ({ runExclusiveModMutation: h.exclusive }));
vi.mock('../services/modSafetyAudit', () => ({ auditInstalledSafety: h.audit }));
vi.mock('../services/windowBackground', () => ({ syncWindowBackgroundWithSettings: h.background }));
vi.mock('../services/forgeBridge', () => ({ syncForgeBridgeWithSettings: h.bridge }));
vi.mock('../services/crosshairPresets', () => ({ syncCrosshairWithSettings: h.crosshair }));
vi.mock('../services/updater', () => ({ assertUpdateChannelChange: vi.fn(), syncUpdaterWithSettings: h.updater }));
vi.mock('../services/socialAuth', () => ({ hydrateOnBoot: h.hydrate }));
vi.mock('../services/deadlock', () => ({ detectDeadlockPath: vi.fn(), looksLikeDeadlockPath: vi.fn() }));
vi.mock('../services/dev', () => ({ ensureDevDeadlockPath: vi.fn() }));
vi.mock('../services/devMods', () => ({ copyModsToDev: h.copy }));
vi.mock('../services/modUpdates', () => ({ assertModUpdateSettingsChange: h.updateGuard, assertNoModUpdates: h.copyGuard }));
import './settings';

const current = {
    devMode: false, devDeadlockPath: 'sandbox', experimentalModSafety: false,
    experimentalSocial: false, lastDialogDirectory: 'remembered', updateChannel: 'stable',
} as AppSettings;
const setSettings = (patch: Partial<AppSettings>) => h.handlers.get('set-settings')!({}, patch) as Promise<AppSettings>;
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.load.mockReturnValue(current);
    h.save.mockImplementation((saved: AppSettings) => { h.load.mockReturnValue(saved); });
    h.exclusive.mockImplementation((operation: () => Promise<void>) => operation());
    h.audit.mockResolvedValue(undefined);
    h.updateGuard.mockReset();
    h.copyGuard.mockReset();
});

describe('developer metadata switching', () => {
    it('merges a delayed mode change with newer preferences and returns the saved settings', async () => {
        const lock = deferred();
        h.exclusive.mockImplementation(async (operation: () => Promise<AppSettings>) => {
            await lock.promise;
            return operation();
        });

        const switching = setSettings({ devMode: true });
        const preference = await setSettings({ keepModBackups: true });
        expect(preference).toEqual({ ...current, keepModBackups: true });
        expect(h.save).toHaveBeenCalledOnce();

        lock.resolve();
        await expect(switching).resolves.toEqual({ ...current, devMode: true, keepModBackups: true });
        expect(h.load()).toEqual({ ...current, devMode: true, keepModBackups: true });
    });

    it('keeps activation side effects tied to the actual previous settings after a delayed save', async () => {
        const lock = deferred();
        h.exclusive.mockImplementation(async (operation: () => Promise<AppSettings>) => {
            await lock.promise;
            return operation();
        });
        const switching = setSettings({ devMode: true });
        await setSettings({ experimentalModSafety: true, experimentalSocial: true });

        lock.resolve();
        await switching;

        expect(h.load()).toMatchObject({ devMode: true, experimentalModSafety: true, experimentalSocial: true });
        expect(h.audit).toHaveBeenCalledOnce();
        expect(h.hydrate).toHaveBeenCalledOnce();
    });

    it('preserves the current settings for an empty patch', async () => {
        await expect(setSettings({})).resolves.toEqual(current);
        expect(h.save).toHaveBeenCalledWith(current);
        expect(h.exclusive).not.toHaveBeenCalled();
    });

    it('refuses installation changes while update work remains', async () => {
        h.updateGuard.mockImplementation(() => { throw new Error('Finish or cancel mod updates'); });
        await expect(setSettings({ ...current, devMode: true })).rejects.toThrow('Finish or cancel mod updates');
        expect(h.save).not.toHaveBeenCalled();
    });

    it('checks the update guard again after waiting for other mod mutations', async () => {
        h.updateGuard.mockImplementationOnce(() => {});
        h.updateGuard.mockImplementationOnce(() => { throw new Error('Updates started while waiting'); });
        await expect(setSettings({ ...current, devMode: true })).rejects.toThrow('Updates started while waiting');
        expect(h.save).not.toHaveBeenCalled();
    });

    it('waits for in-flight mod writes before enabling developer mode', async () => {
        const lock = deferred();
        h.exclusive.mockImplementation(async (operation: () => Promise<void>) => {
            await lock.promise;
            return operation();
        });

        const pending = setSettings({ ...current, devMode: true });
        expect(h.exclusive).toHaveBeenCalledOnce();
        expect(h.save).not.toHaveBeenCalled();
        expect(h.updater).not.toHaveBeenCalled();

        h.load.mockReturnValue({ ...current, lastDialogDirectory: 'newly-remembered' });
        lock.resolve();
        await pending;
        expect(h.save).toHaveBeenCalledWith({ ...current, devMode: true, lastDialogDirectory: 'newly-remembered' });
        expect(h.updater).toHaveBeenCalledOnce();
    });

    it('leaves settings and runtime services unchanged when the mutation lock refuses a switch', async () => {
        h.exclusive.mockRejectedValueOnce(new Error('Mod mutation refused'));
        await expect(setSettings({ ...current, devMode: true })).rejects.toThrow('Mod mutation refused');
        expect(h.save).not.toHaveBeenCalled();
        expect(h.updater).not.toHaveBeenCalled();
        expect(h.background).not.toHaveBeenCalled();
        expect(h.bridge).not.toHaveBeenCalled();
    });

    it('switches back to normal mode under the mutation lock', async () => {
        h.load.mockReturnValue({ ...current, devMode: true });
        await setSettings(current);
        expect(h.exclusive).toHaveBeenCalledOnce();
        expect(h.save).toHaveBeenCalledWith(current);
    });

    it('locks a developer install path change', async () => {
        h.load.mockReturnValue({ ...current, devMode: true });
        await setSettings({ ...current, devMode: true, devDeadlockPath: 'another-sandbox' });
        expect(h.exclusive).toHaveBeenCalledOnce();
        expect(h.save).toHaveBeenCalledWith({ ...current, devMode: true, devDeadlockPath: 'another-sandbox' });
    });

    it('preserves ordinary settings updates and activation side effects without taking the mod lock', async () => {
        await setSettings({
            ...current, lastDialogDirectory: 'stale-renderer-value',
            experimentalModSafety: true, experimentalSocial: true,
        });
        expect(h.exclusive).not.toHaveBeenCalled();
        expect(h.save).toHaveBeenCalledWith({ ...current, experimentalModSafety: true, experimentalSocial: true });
        expect(h.updater).toHaveBeenCalledOnce();
        expect(h.background).toHaveBeenCalledOnce();
        expect(h.bridge).toHaveBeenCalledOnce();
        expect(h.audit).toHaveBeenCalledWith('game');
        expect(h.hydrate).toHaveBeenCalledOnce();
    });
});

describe('developer library copy progress', () => {
    it.each([false, true])('only sends progress to an open requesting window (closed: %s)', async (closed) => {
        const sender = { isDestroyed: () => closed, send: vi.fn() };
        h.copy.mockImplementation(async (onProgress: (percent: number) => void) => {
            onProgress(35);
        });

        await h.handlers.get('copy-mods-to-dev')!({ sender });

        expect(h.copy).toHaveBeenCalledOnce();
        if (closed) expect(sender.send).not.toHaveBeenCalled();
        else expect(sender.send).toHaveBeenCalledExactlyOnceWith('copy-mods-to-dev-progress', 35);
    });
});
