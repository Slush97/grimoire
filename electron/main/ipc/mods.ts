import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import {
    scanMods,
    enableMod,
    disableMod,
    deleteMod,
    setModPriority,
    Mod,
} from '../services/mods';
import { getModMetadata, loadMetadata } from '../services/metadata';

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

/**
 * Enrich mod with metadata
 */
function enrichMod(mod: Mod): Mod {
    const metadata = getModMetadata(mod.fileName);
    if (metadata) {
        return {
            ...mod,
            // Use the stored mod name from GameBanana if available
            name: metadata.modName || mod.name,
            thumbnailUrl: metadata.thumbnailUrl,
            gameBananaId: metadata.gameBananaId,
            gameBananaFileId: metadata.gameBananaFileId,
            categoryId: metadata.categoryId,
            categoryName: metadata.categoryName,
            sourceSection: metadata.sourceSection,
            nsfw: metadata.nsfw,
        };
    }
    return mod;
}

// get-mods
ipcMain.handle('get-mods', async (): Promise<Mod[]> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        return [];
    }
    const mods = await scanMods(deadlockPath);
    return mods.map(enrichMod);
});

// enable-mod
ipcMain.handle('enable-mod', async (_, modId: string): Promise<Mod> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mod = await enableMod(deadlockPath, modId);
    return enrichMod(mod);
});

// disable-mod
ipcMain.handle('disable-mod', async (_, modId: string): Promise<Mod> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mod = await disableMod(deadlockPath, modId);
    return enrichMod(mod);
});

// delete-mod
ipcMain.handle('delete-mod', async (_, modId: string): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    await deleteMod(deadlockPath, modId);
});

// set-mod-priority
ipcMain.handle(
    'set-mod-priority',
    async (_, modId: string, priority: number): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const mod = await setModPriority(deadlockPath, modId, priority);
        return enrichMod(mod);
    }
);

