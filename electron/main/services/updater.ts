import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import type { UpdateInfo } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log';

// Configure logging
autoUpdater.logger = log;
log.transports.file.level = 'info';

// Disable auto-download - we want to show changelog first
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow: BrowserWindow | null = null;

export interface UpdateStatus {
    checking: boolean;
    available: boolean;
    downloading: boolean;
    downloaded: boolean;
    error: string | null;
    progress: number;
    updateInfo: UpdateInfo | null;
}

let currentStatus: UpdateStatus = {
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    progress: 0,
    updateInfo: null,
};

function sendStatusToRenderer() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:status', currentStatus);
    }
}

export function initUpdater(window: BrowserWindow) {
    mainWindow = window;

    autoUpdater.on('checking-for-update', () => {
        currentStatus = { ...currentStatus, checking: true, error: null };
        sendStatusToRenderer();
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
        currentStatus = {
            ...currentStatus,
            checking: false,
            available: true,
            updateInfo: info,
        };
        sendStatusToRenderer();
    });

    autoUpdater.on('update-not-available', () => {
        currentStatus = {
            ...currentStatus,
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
        currentStatus = {
            ...currentStatus,
            downloading: false,
            downloaded: true,
            progress: 100,
            updateInfo: info,
        };
        sendStatusToRenderer();
    });

    autoUpdater.on('error', (error) => {
        currentStatus = {
            ...currentStatus,
            checking: false,
            downloading: false,
            error: error.message,
        };
        sendStatusToRenderer();
    });
}

export function getAppVersion(): string {
    return app.getVersion();
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
    try {
        const result = await autoUpdater.checkForUpdates();
        return result?.updateInfo ?? null;
    } catch (error) {
        log.error('Error checking for updates:', error);
        throw error;
    }
}

export async function downloadUpdate(): Promise<void> {
    try {
        await autoUpdater.downloadUpdate();
    } catch (error) {
        log.error('Error downloading update:', error);
        throw error;
    }
}

export function quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
}

export function getUpdateStatus(): UpdateStatus {
    return currentStatus;
}
