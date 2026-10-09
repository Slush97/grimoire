import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const realExecPath = Object.getOwnPropertyDescriptor(process, 'execPath')!;

const h = vi.hoisted(() => ({
    version: '1.31.0',
    savedChannel: 'stable',
    handlers: new Map<string, (value?: unknown) => void>(),
    persist: vi.fn(),
    send: vi.fn(),
    updater: {
        on: vi.fn(),
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn(),
        channel: '',
        allowPrerelease: false,
        allowDowngrade: false,
        fullChangelog: false,
        autoInstallOnAppQuit: true,
    },
}));

vi.mock('electron-updater', () => ({ default: { autoUpdater: h.updater } }));
vi.mock('electron', () => ({ app: { getVersion: () => h.version } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), error: vi.fn(), transports: { file: {} } } }));
vi.mock('./settings', () => ({
    loadSettings: () => ({ updateChannel: h.savedChannel, language: 'ru' }),
    saveSettings: (settings: { updateChannel: string }) => {
        h.persist(settings);
        h.savedChannel = settings.updateChannel;
    },
}));

const nightly = { version: '1.31.1-nightly.20261009123000.42.gabcdef0', files: [], releaseDate: '2026-10-09' };
function emit(name: string, value?: unknown) { h.handlers.get(name)?.(value); }

beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.stubEnv('APPIMAGE', '/tmp/Grimoire.AppImage');
    vi.resetModules();
    vi.clearAllMocks();
    h.version = '1.31.0';
    h.savedChannel = 'stable';
    h.handlers.clear();
    h.persist.mockReset();
    h.updater.on.mockImplementation((name, handler) => { h.handlers.set(name, handler); });
    h.updater.checkForUpdates.mockReset();
    h.updater.checkForUpdates.mockImplementation(async () => {
        emit('checking-for-update');
        emit('update-available', nightly);
        return { updateInfo: nightly };
    });
    h.updater.downloadUpdate.mockReset();
    h.updater.downloadUpdate.mockImplementation(async () => { emit('update-downloaded', nightly); });
    h.updater.autoInstallOnAppQuit = true;
});

afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
    Object.defineProperty(process, 'execPath', realExecPath);
    vi.unstubAllEnvs();
});

async function init() {
    const service = await import('./updater');
    service.initUpdater({ isDestroyed: () => false, webContents: { send: h.send } } as never);
    return service;
}

describe.each(['win32', 'linux'] as const)('Stable / Nightly updates (%s)', platform => {
    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    });

    it('starts on stable without claiming an update check succeeded', async () => {
        const service = await init();
        expect(h.updater.channel).toBe('latest');
        expect(h.updater.allowPrerelease).toBe(false);
        expect(h.updater.allowDowngrade).toBe(false);
        expect(service.getUpdateStatus().checked).toBe(false);
    });

    it('persists nightly without overwriting unrelated settings and restores it on launch', async () => {
        const service = await init();
        expect(service.setUpdateChannel('nightly')).toEqual({ updateChannel: 'nightly', language: 'ru' });
        expect(h.updater.channel).toBe('nightly');
        expect(h.updater.allowPrerelease).toBe(true);
        expect(h.updater.allowDowngrade).toBe(false);
        expect(h.updater.fullChangelog).toBe(false);
        vi.resetModules();
        await init();
        expect(h.updater.channel).toBe('nightly');
    });

    it('allows returning to an older stable release only from an installed nightly', async () => {
        h.version = nightly.version;
        h.savedChannel = 'nightly';
        const service = await init();
        service.setUpdateChannel('stable');
        expect(h.updater.channel).toBe('latest');
        expect(h.updater.allowPrerelease).toBe(false);
        expect(h.updater.allowDowngrade).toBe(true);
        expect(h.updater.fullChangelog).toBe(false);
        h.version = '1.31.0';
        expect(service.getUpdateStatus().returningToStable).toBe(true);
        service.syncUpdaterWithSettings();
        expect(h.updater.allowDowngrade).toBe(false);
        expect(service.getUpdateStatus().returningToStable).toBe(false);
    });

    it('rejects invalid channels and preserves the old channel when persistence fails', async () => {
        const service = await init();
        expect(() => service.setUpdateChannel('beta')).toThrow('Invalid update channel');
        expect(h.persist).not.toHaveBeenCalled();
        h.persist.mockImplementation(() => { throw new Error('disk full'); });
        expect(() => service.setUpdateChannel('nightly')).toThrow('disk full');
        expect(h.savedChannel).toBe('stable');
        expect(h.updater.channel).toBe('latest');
    });

    it('deduplicates checks and blocks channel changes throughout an in-flight check', async () => {
        let finish!: (value: null) => void;
        h.updater.checkForUpdates.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const service = await init();
        const first = service.checkForUpdates();
        const second = service.checkForUpdates();
        expect(h.updater.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(() => service.setUpdateChannel('nightly')).toThrow('Wait for');
        finish(null);
        await Promise.all([first, second]);
        expect(() => service.setUpdateChannel('nightly')).not.toThrow();
    });

    it('reports a missing nightly and releases the channel lock when a check fails', async () => {
        const service = await init();
        service.setUpdateChannel('nightly');
        h.updater.checkForUpdates.mockImplementation(async () => {
            emit('checking-for-update');
            throw Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' });
        });
        await expect(service.checkForUpdates()).rejects.toThrow('No published versions');
        expect(service.getUpdateStatus()).toMatchObject({ checking: false, available: false, errorCode: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' });
        expect(() => service.setUpdateChannel('stable')).not.toThrow();
        expect(service.getUpdateStatus().errorCode).toBeNull();
    });

    it('blocks switching before the first download-progress event', async () => {
        let finish!: () => void;
        h.updater.downloadUpdate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
        const service = await init();
        service.setUpdateChannel('nightly');
        await service.checkForUpdates();
        const downloading = service.downloadUpdate();
        expect(() => service.setUpdateChannel('stable')).toThrow('Wait for');
        emit('update-downloaded', nightly);
        finish();
        await downloading;
        expect(() => service.setUpdateChannel('stable')).not.toThrow();
    });

    it('discards an old-channel download and prevents stale download/install actions', async () => {
        const service = await init();
        service.setUpdateChannel('nightly');
        await service.checkForUpdates();
        await service.downloadUpdate();
        expect(service.getUpdateStatus().downloaded).toBe(true);
        expect(h.updater.autoInstallOnAppQuit).toBe(true);
        service.setUpdateChannel('stable');
        expect(service.getUpdateStatus()).toMatchObject({ checked: false, downloaded: false, available: false, updateInfo: null });
        expect(h.updater.autoInstallOnAppQuit).toBe(false);
        service.quitAndInstall();
        await service.downloadUpdate();
        expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
        expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
        await service.checkForUpdates();
        await service.downloadUpdate();
        service.quitAndInstall();
        expect(h.updater.autoInstallOnAppQuit).toBe(true);
        expect(h.updater.quitAndInstall).toHaveBeenCalledOnce();
    });

    it('allows channel selection again after a rejected download', async () => {
        const service = await init();
        await service.checkForUpdates();
        h.updater.downloadUpdate.mockRejectedValue(new Error('connection failed'));
        await expect(service.downloadUpdate()).rejects.toThrow('connection failed');
        expect(service.getUpdateStatus().downloading).toBe(false);
        expect(() => service.setUpdateChannel('nightly')).not.toThrow();
    });

    it('does not recheck while a verified installer is waiting to be installed', async () => {
        const service = await init();
        await service.checkForUpdates();
        await service.downloadUpdate();
        await service.checkForUpdates();
        expect(h.updater.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(service.getUpdateStatus().downloaded).toBe(true);
    });

    it('keeps nightly release notes out of the stable changelog', async () => {
        const service = await init();
        emit('update-available', { ...nightly, version: '1.32.0', releaseNotes: [{ version: nightly.version, note: 'test build' }, { version: '1.32.0', note: 'official release' }] });
        expect(service.getUpdateStatus().updateInfo?.releaseNotes).toEqual([{ version: '1.32.0', note: 'official release' }]);
    });
});

describe('installation sources', () => {
    it('keeps package-managed Linux installs out of the in-app updater', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        Object.defineProperty(process, 'execPath', { value: '/usr/bin/grimoire', configurable: true });
        vi.stubEnv('APPIMAGE', '');
        const service = await init();
        expect(service.getInstallSource()).toBe('managed');
        expect(service.canSelfInstall()).toBe(false);
        expect(() => service.setUpdateChannel('nightly')).toThrow('package manager');
        await service.checkForUpdates();
        expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('allows macOS to select and check channels without installing in place', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        const service = await init();
        expect(service.getInstallSource()).toBe('manual');
        expect(service.canSelfInstall()).toBe(false);
        service.setUpdateChannel('nightly');
        await service.checkForUpdates();
        expect(service.getUpdateStatus().available).toBe(true);
        await service.downloadUpdate();
        expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
    });
});
