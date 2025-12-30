import { ipcMain, dialog } from 'electron';
import { loadSettings } from '../services/settings';
import {
    getGameinfoStatus,
    fixGameinfo,
    cleanupAddons,
    GameinfoStatus,
    CleanupResult,
} from '../services/system';
import { listArchiveContents } from '../services/extract';
import { existsSync, readdirSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import { join, basename, extname } from 'path';
import { getAddonsPath, getDisabledPath } from '../services/deadlock';

interface OpenDialogOptions {
    directory?: boolean;
    title?: string;
    defaultPath?: string;
}

interface SetMinaPresetArgs {
    presetFileName: string;
}

interface ListMinaVariantsArgs {
    archivePath: string;
}

interface ApplyMinaVariantArgs {
    archivePath: string;
    archiveEntry: string;
    presetLabel: string;
    heroCategoryId?: number;
}

/**
 * Get the active deadlock path from settings
 */
function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

// show-open-dialog
ipcMain.handle(
    'show-open-dialog',
    async (_, options: OpenDialogOptions): Promise<string | null> => {
        const result = await dialog.showOpenDialog({
            properties: options.directory ? ['openDirectory'] : ['openFile'],
            title: options.title,
            defaultPath: options.defaultPath,
        });
        return result.canceled ? null : result.filePaths[0] || null;
    }
);

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
            message: 'No Deadlock path configured',
        };
    }
    return getGameinfoStatus(deadlockPath);
});

// fix-gameinfo
ipcMain.handle('fix-gameinfo', (): GameinfoStatus => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        return {
            configured: false,
            message: 'No Deadlock path configured',
        };
    }
    return fixGameinfo(deadlockPath);
});

// set-mina-preset
ipcMain.handle('set-mina-preset', async (_, args: SetMinaPresetArgs): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }

    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);
    const { presetFileName } = args;

    // Find the preset file in either folder
    let presetPath: string | null = null;
    let isEnabled = false;

    const addonsPreset = join(addonsPath, presetFileName);
    const disabledPreset = join(disabledPath, presetFileName);

    if (existsSync(addonsPreset)) {
        presetPath = addonsPreset;
        isEnabled = true;
    } else if (existsSync(disabledPreset)) {
        presetPath = disabledPreset;
        isEnabled = false;
    }

    if (!presetPath) {
        throw new Error(`Preset file not found: ${presetFileName}`);
    }

    // Move to addons if disabled
    if (!isEnabled) {
        const destPath = join(addonsPath, presetFileName);
        renameSync(presetPath, destPath);
    }
});

// list-mina-variants
ipcMain.handle(
    'list-mina-variants',
    async (_, args: ListMinaVariantsArgs): Promise<string[]> => {
        const { archivePath } = args;

        if (!existsSync(archivePath)) {
            throw new Error(`Archive not found: ${archivePath}`);
        }

        const contents = await listArchiveContents(archivePath);

        // Filter for texture files that represent variants
        return contents.filter((entry) => {
            const name = basename(entry).toLowerCase();
            return (
                name.endsWith('.vtex_c') ||
                name.endsWith('.vmat_c') ||
                name.includes('variant')
            );
        });
    }
);

// apply-mina-variant
ipcMain.handle(
    'apply-mina-variant',
    async (_, args: ApplyMinaVariantArgs): Promise<void> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }

        // TODO: Implement Mina variant extraction
        // This requires extracting a specific file from an archive
        // and placing it in the correct location
        console.log('apply-mina-variant', args);
    }
);
