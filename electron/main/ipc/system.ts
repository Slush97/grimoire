import { ipcMain, dialog, BrowserWindow } from 'electron';
import { getMainWindow } from '../index';
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

// download-mina-variations
// Downloads the Midnight Mina variations archive from GameBanana
ipcMain.handle('download-mina-variations', async (_, mainWindow): Promise<string> => {
    const { getUserDataPath } = require('../utils/paths');
    const https = require('https');
    const http = require('http');
    const fs = require('fs');
    const { spawn } = require('child_process');

    const userDataPath = getUserDataPath();
    const minaAssetsDir = join(userDataPath, 'mina-assets');
    const archivePath = join(minaAssetsDir, 'sts_midnight_mina_10.7z');
    const variationsPath = join(minaAssetsDir, 'variations.7z');

    // If variations.7z already exists, return its path
    if (existsSync(variationsPath)) {
        console.log('[downloadMinaVariations] Variations archive already exists:', variationsPath);
        return variationsPath;
    }

    // Create the assets directory
    if (!existsSync(minaAssetsDir)) {
        fs.mkdirSync(minaAssetsDir, { recursive: true });
    }

    console.log('[downloadMinaVariations] Downloading from GameBanana...');

    // Download the archive (File ID: 1530209 - the one with variations)
    const downloadUrl = 'https://gamebanana.com/dl/1530209';

    await new Promise<void>((resolve, reject) => {
        const followRedirects = (url: string) => {
            const protocol = url.startsWith('https') ? https : http;
            protocol.get(url, (response: { statusCode: number; headers: { location?: string }; pipe: (arg: NodeJS.WritableStream) => void }) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        followRedirects(redirectUrl);
                        return;
                    }
                }
                if (response.statusCode !== 200) {
                    reject(new Error(`Download failed with status ${response.statusCode}`));
                    return;
                }
                const fileStream = fs.createWriteStream(archivePath);
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
                fileStream.on('error', (err: Error) => {
                    fs.unlinkSync(archivePath);
                    reject(err);
                });
            }).on('error', reject);
        };
        followRedirects(downloadUrl);
    });

    console.log('[downloadMinaVariations] Download complete, extracting variations.7z...');

    // Extract variations.7z from the archive
    await new Promise<void>((resolve, reject) => {
        const proc = spawn('7z', ['e', '-y', `-o${minaAssetsDir}`, archivePath, 'variations.7z'], { stdio: 'pipe' });
        proc.on('close', (code: number) => {
            if (code === 0) resolve();
            else reject(new Error(`7z extraction failed with code ${code}`));
        });
        proc.on('error', reject);
    });

    // Clean up the large archive to save space
    if (existsSync(archivePath)) {
        console.log('[downloadMinaVariations] Cleaning up large archive...');
        fs.unlinkSync(archivePath);
    }

    if (!existsSync(variationsPath)) {
        throw new Error('Failed to extract variations.7z from archive');
    }

    console.log('[downloadMinaVariations] Success! Path:', variationsPath);
    return variationsPath;
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

        // Filter for VPK files that represent presets
        return contents.filter((entry) => {
            const name = basename(entry).toLowerCase();
            return name.endsWith('.vpk') && name.includes('sts_midnight_mina');
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

        const { archivePath, archiveEntry, presetLabel, heroCategoryId } = args;
        const addonsPath = getAddonsPath(deadlockPath);
        const disabledPath = getDisabledPath(deadlockPath);

        console.log('[applyMinaVariant] Applying variant:', { archivePath, archiveEntry, presetLabel });

        // Extract the VPK from the archive to a temp location
        const { spawn } = require('child_process');
        const os = require('os');
        const fs = require('fs');
        const path = require('path');

        const tempDir = join(os.tmpdir(), `mina-variant-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        try {
            // Extract specific file from 7z
            await new Promise<void>((resolve, reject) => {
                const proc = spawn('7z', ['e', '-y', `-o${tempDir}`, archivePath, archiveEntry], { stdio: 'pipe' });
                proc.on('close', (code: number) => {
                    if (code === 0) resolve();
                    else reject(new Error(`7z extraction failed with code ${code}`));
                });
                proc.on('error', reject);
            });

            // Find the extracted VPK
            const extractedFiles = fs.readdirSync(tempDir);
            const vpkFile = extractedFiles.find((f: string) => f.toLowerCase().endsWith('.vpk'));

            if (!vpkFile) {
                throw new Error('No VPK file found in extracted content');
            }

            const extractedPath = join(tempDir, vpkFile);

            // Find used priorities to avoid conflicts
            const usedPriorities = new Set<number>();

            // Check both addons and disabled folders
            for (const folder of [addonsPath, disabledPath]) {
                if (existsSync(folder)) {
                    const entries = readdirSync(folder);
                    for (const entry of entries) {
                        const match = entry.match(/^pak(\d{2})_/);
                        if (match) {
                            usedPriorities.add(parseInt(match[1], 10));
                        }
                    }
                }
            }

            // Find next available priority (start from 10 to leave room)
            let priority = 10;
            while (usedPriorities.has(priority) && priority < 99) {
                priority++;
            }

            // Use strict pakXX_dir.vpk naming (Deadlock engine requirement)
            const destFileName = `pak${String(priority).padStart(2, '0')}_dir.vpk`;
            const destPath = join(disabledPath, destFileName);

            // Remove any existing Mina preset VPKs that we created (identified via metadata)
            const { getModMetadata, deleteModMetadata } = require('../services/metadata');
            const disabledEntries = existsSync(disabledPath) ? readdirSync(disabledPath) : [];
            const addonsEntries = existsSync(addonsPath) ? readdirSync(addonsPath) : [];

            for (const entry of [...disabledEntries, ...addonsEntries]) {
                const meta = getModMetadata(entry);
                // Check if this is a Mina preset we created (has isMinaPreset flag)
                if (meta?.isMinaPreset) {
                    const pathToDelete = existsSync(join(addonsPath, entry))
                        ? join(addonsPath, entry)
                        : join(disabledPath, entry);
                    if (existsSync(pathToDelete)) {
                        console.log('[applyMinaVariant] Removing old preset:', entry);
                        unlinkSync(pathToDelete);
                        deleteModMetadata(entry);
                    }
                }
            }

            // Copy to disabled folder
            copyFileSync(extractedPath, destPath);
            console.log('[applyMinaVariant] Installed preset to:', destPath);

            // Save metadata with isMinaPreset flag so we can identify it later
            const { setModMetadata } = require('../services/metadata');
            setModMetadata(destFileName, {
                modName: `Midnight Mina — ${presetLabel}`,
                categoryId: heroCategoryId,
                categoryName: 'Mina',
                sourceSection: 'Mod',
                nsfw: true,
                isMinaPreset: true,  // Flag to identify this as a Mina preset we created
            });

        } finally {
            // Cleanup temp directory
            try {
                const entries = fs.readdirSync(tempDir);
                for (const entry of entries) {
                    fs.unlinkSync(join(tempDir, entry));
                }
                fs.rmdirSync(tempDir);
            } catch {
                // Ignore cleanup errors
            }
        }
    }
);
