import { ipcMain, dialog, shell, clipboard, nativeImage } from 'electron';
import { getMainWindow } from '../index';
import { getActiveDeadlockPath } from '../services/settings';
import {
    getGameinfoStatus,
    fixGameinfo,
    cleanupAddons,
    type GameinfoStatus,
    type CleanupResult,
} from '../services/system';
import { healLockerVpks } from '../services/lockerVpk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { getAddonsPath, getCitadelPath } from '../services/deadlock';
import type { OpenDialogOptions, SaveDialogOptions } from '../../../src/types/electron';

async function loadClipboardImage(source: string): Promise<Electron.NativeImage> {
    if (!source) {
        throw new Error('Image source is required');
    }

    if (source.startsWith('data:image/')) {
        return nativeImage.createFromDataURL(source);
    }

    const url = new URL(source);
    if (url.protocol === 'file:') {
        return nativeImage.createFromBuffer(readFileSync(fileURLToPath(url)));
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Image request failed with status ${response.status}`);
        }
        return nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    }

    throw new Error(`Unsupported image source: ${url.protocol}`);
}

// show-open-dialog
ipcMain.handle(
    'show-open-dialog',
    async (_, options: OpenDialogOptions): Promise<string | null> => {
        const result = await dialog.showOpenDialog({
            properties: options.directory ? ['openDirectory'] : ['openFile'],
            title: options.title,
            defaultPath: options.defaultPath,
            filters: options.filters,
        });
        return result.canceled ? null : result.filePaths[0] || null;
    }
);

// show-save-dialog
ipcMain.handle(
    'show-save-dialog',
    async (_, options: SaveDialogOptions): Promise<string | null> => {
        const result = await dialog.showSaveDialog({
            title: options.title,
            defaultPath: options.defaultPath,
            filters: options.filters,
        });
        return result.canceled ? null : result.filePath || null;
    }
);

// reveal-path: open the OS file browser with the given file selected.
ipcMain.handle('reveal-path', async (_, targetPath: string): Promise<void> => {
    if (targetPath) shell.showItemInFolder(targetPath);
});

// copy-image-to-clipboard
// Writes actual image pixels to the system clipboard, not just the image URL.
ipcMain.handle('copy-image-to-clipboard', async (_, source: string): Promise<void> => {
    const image = await loadClipboardImage(source);
    if (image.isEmpty()) {
        throw new Error('Image could not be decoded');
    }
    clipboard.writeImage(image);
});

// open-mods-folder
ipcMain.handle('open-mods-folder', async (): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const addonsPath = getAddonsPath(deadlockPath);
    const error = await shell.openPath(addonsPath);
    if (error) {
        throw new Error(error);
    }
});

// cleanup-addons
ipcMain.handle('cleanup-addons', (): CleanupResult => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    return cleanupAddons(deadlockPath);
});

// get-gameinfo-status
ipcMain.handle('get-gameinfo-status', (): GameinfoStatus => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        return {
            configured: false,
            missing: false,
            message: 'No Deadlock path configured',
            candidates: [],
        };
    }
    return getGameinfoStatus(deadlockPath);
});

// open-game-folder (opens the citadel/ directory so the user can inspect
// gameinfo.gi siblings when it's missing)
ipcMain.handle('open-game-folder', async (): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const error = await shell.openPath(getCitadelPath(deadlockPath));
    if (error) {
        throw new Error(error);
    }
});

// Always on top
ipcMain.handle('set-always-on-top', (_, enabled: boolean): boolean => {
    const win = getMainWindow();
    if (win) {
        win.setAlwaysOnTop(enabled, 'floating');
        return win.isAlwaysOnTop();
    }
    return false;
});

ipcMain.handle('get-always-on-top', (): boolean => {
    const win = getMainWindow();
    return win ? win.isAlwaysOnTop() : false;
});

// fix-gameinfo
ipcMain.handle('fix-gameinfo', async (): Promise<GameinfoStatus> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        return {
            configured: false,
            missing: false,
            message: 'No Deadlock path configured',
            candidates: [],
        };
    }
    const status = fixGameinfo(deadlockPath);
    // Now that the grimoire search path is in place, migrate any Locker-managed
    // VPKs out of addons into citadel/grimoire immediately, so applied cards /
    // sounds relocate without needing an app restart.
    if (status.configured) {
        try {
            await healLockerVpks(deadlockPath);
        } catch (err) {
            console.error('[system] Locker migration after fix-gameinfo failed:', err);
        }
    }
    return status;
});
