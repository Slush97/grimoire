import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import type { UpdateInfo } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log';
import { loadSettings, saveSettings } from './settings';
import type { AppSettings, UpdateChannel } from '../../../src/types/mod';

export type InstallSource = 'managed' | 'appimage' | 'standard' | 'manual';

// Detect installs owned by a system package manager (apt/AUR/snap/flatpak).
// In-app updates would fail on these because /opt and /usr are root-owned, so
// we route those users to their package manager instead.
export function getInstallSource(): InstallSource {
    // The macOS build is ad-hoc signed: there is no Developer ID certificate,
    // so the bundle carries no signing identity (`TeamIdentifier=not set`).
    // Squirrel.Mac refuses to swap in an update whose identity does not match
    // the running app's, so an in-app update would download and then fail at
    // the install step. Checking still works and is worth doing, so this is a
    // separate source from 'managed': we tell the user a version exists and
    // send them to the download page. See docs/macos.md.
    if (process.platform === 'darwin') return 'manual';
    if (process.platform === 'linux') {
        if (process.env.APPIMAGE) return 'appimage';
        const exec = process.execPath;
        if (
            exec.startsWith('/opt/') ||
            exec.startsWith('/usr/') ||
            exec.startsWith('/nix/store/') ||
            exec.startsWith('/snap/') ||
            exec.startsWith('/var/lib/flatpak/') ||
            exec.startsWith('/app/')
        ) {
            return 'managed';
        }
    }
    return 'standard';
}

const installSource = getInstallSource();
// 'managed' is fully hands-off: the package manager owns the whole lifecycle,
// so we do not even check. 'manual' can still check and report a new version,
// it just cannot apply one in place.
const updaterDisabled = installSource === 'managed';
const canInstallInPlace = installSource !== 'managed' && installSource !== 'manual';

/** Whether the in-app updater can actually apply an update on this install. */
export function canSelfInstall(): boolean {
    return canInstallInPlace;
}

// Configure logging
autoUpdater.logger = log;
log.transports.file.level = 'info';

// Disable auto-download - we want to show changelog first
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
// Aggregate release notes from every GitHub release between the installed
// version and the target version. Without this, electron-updater hands the
// renderer only the latest release's body — users who skipped a few versions
// would have no idea what changed in between. With fullChangelog = true,
// releaseNotes comes back as `{ version, note }[]`; UpdateModal already
// renders that shape per-version.
autoUpdater.fullChangelog = true;

let mainWindow: BrowserWindow | null = null;

export interface UpdateStatus {
    checked: boolean;
    returningToStable: boolean;
    errorCode: string | null;
    checking: boolean;
    available: boolean;
    downloading: boolean;
    downloaded: boolean;
    error: string | null;
    progress: number;
    updateInfo: UpdateInfo | null;
}

const emptyStatus = (): UpdateStatus => ({
    checked: false,
    returningToStable: false,
    errorCode: null,
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    progress: 0,
    updateInfo: null,
});
let currentStatus = emptyStatus();
let activeChannel: UpdateChannel = 'stable';
let checkPromise: Promise<UpdateInfo | null> | null = null;

function errorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object' || !('code' in error)) return null;
    return typeof error.code === 'string' ? error.code : null;
}

export function assertUpdateChannelChange(channel: unknown): asserts channel is UpdateChannel {
    if (channel !== 'stable' && channel !== 'nightly') throw new Error('Invalid update channel.');
    if (channel === activeChannel) return;
    if (updaterDisabled) throw new Error('Updates are managed by your package manager.');
    if (currentStatus.checking || currentStatus.downloading || checkPromise) {
        throw new Error('Wait for the current update check or download to finish.');
    }
}

export function syncUpdaterWithSettings(): void {
    const channel = loadSettings().updateChannel;
    const changed = channel !== activeChannel;
    if (changed) {
        // A previously downloaded installer belongs to the old channel. It must
        // not be installed on quit after the user chooses a different channel.
        autoUpdater.autoInstallOnAppQuit = false;
        currentStatus = emptyStatus();
        activeChannel = channel;
    }
    autoUpdater.channel = channel === 'nightly' ? 'nightly' : 'latest';
    autoUpdater.allowPrerelease = channel === 'nightly';
    // The channel setter enables downgrades implicitly. Restrict them to the
    // explicit return from an installed nightly to the current stable release.
    const installedNightly = app.getVersion().includes('-nightly.');
    autoUpdater.allowDowngrade = channel === 'stable' && installedNightly;
    autoUpdater.fullChangelog = channel === 'stable' && !installedNightly;
    currentStatus = { ...currentStatus, returningToStable: channel === 'stable' && installedNightly };
    if (changed) sendStatusToRenderer();
}

export function setUpdateChannel(channel: unknown): AppSettings {
    assertUpdateChannelChange(channel);
    const settings = { ...loadSettings(), updateChannel: channel };
    saveSettings(settings);
    syncUpdaterWithSettings();
    return settings;
}

// fullChangelog aggregates every release in the feed between the installed
// and target versions, nightlies included. Both the available and the
// downloaded event carry electron-updater's unfiltered info.
function forActiveChannel(info: UpdateInfo): UpdateInfo {
    if (activeChannel !== 'stable' || !Array.isArray(info.releaseNotes)) return info;
    return { ...info, releaseNotes: info.releaseNotes.filter(note => !note.version.includes('-')) };
}

function sendStatusToRenderer() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:status', currentStatus);
    }
}

export function initUpdater(window: BrowserWindow) {
    mainWindow = window;
    syncUpdaterWithSettings();
    if (updaterDisabled) {
        log.info('[Updater] System package install detected; in-app updater disabled.');
        return;
    }

    autoUpdater.on('checking-for-update', () => {
        currentStatus = { ...currentStatus, checking: true, error: null, errorCode: null };
        sendStatusToRenderer();
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
        currentStatus = {
            ...currentStatus,
            checked: true,
            checking: false,
            available: true,
            updateInfo: forActiveChannel(info),
        };
        sendStatusToRenderer();
    });

    autoUpdater.on('update-not-available', () => {
        currentStatus = {
            ...currentStatus,
            checked: true,
            checking: false,
            available: false,
            updateInfo: null,
        };
        sendStatusToRenderer();
    });

    autoUpdater.on('download-progress', (progress) => {
        currentStatus = {
            ...currentStatus,
            downloading: true,
            progress: progress.percent,
        };
        sendStatusToRenderer();
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
        autoUpdater.autoInstallOnAppQuit = true;
        currentStatus = {
            ...currentStatus,
            downloading: false,
            downloaded: true,
            progress: 100,
            updateInfo: forActiveChannel(info),
        };
        sendStatusToRenderer();
    });

    autoUpdater.on('error', (error) => {
        currentStatus = {
            ...currentStatus,
            checking: false,
            downloading: false,
            error: error.message,
            errorCode: errorCode(error),
        };
        sendStatusToRenderer();
    });
}

export function getAppVersion(): string {
    return app.getVersion();
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
    if (updaterDisabled) return null;
    if (checkPromise) return checkPromise;
    if (currentStatus.downloading || currentStatus.downloaded) return currentStatus.updateInfo;
    syncUpdaterWithSettings();
    checkPromise = performUpdateCheck();
    try {
        return await checkPromise;
    } finally {
        checkPromise = null;
    }
}

async function performUpdateCheck(): Promise<UpdateInfo | null> {
    try {
        const result = await autoUpdater.checkForUpdates();
        return result?.updateInfo ?? null;
    } catch (error) {
        log.error('Error checking for updates:', error);
        currentStatus = { ...currentStatus, checking: false, error: error instanceof Error ? error.message : String(error), errorCode: errorCode(error) };
        sendStatusToRenderer();
        throw error;
    }
}

export async function downloadUpdate(): Promise<void> {
    // Not just updaterDisabled: downloading on a 'manual' install would hand
    // Squirrel.Mac a payload it will refuse to install, so stop earlier and
    // let the UI point at the download page instead.
    if (!canInstallInPlace || !currentStatus.available || currentStatus.checking || currentStatus.downloading || currentStatus.downloaded) return;
    currentStatus = { ...currentStatus, downloading: true, error: null, progress: 0 };
    sendStatusToRenderer();
    try {
        await autoUpdater.downloadUpdate();
    } catch (error) {
        log.error('Error downloading update:', error);
        currentStatus = { ...currentStatus, downloading: false, error: error instanceof Error ? error.message : String(error) };
        sendStatusToRenderer();
        throw error;
    }
}

export function quitAndInstall(): void {
    if (!canInstallInPlace || !currentStatus.downloaded) return;
    autoUpdater.quitAndInstall(false, true);
}

export function getUpdateStatus(): UpdateStatus {
    return currentStatus;
}
