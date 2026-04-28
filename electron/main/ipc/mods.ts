import { ipcMain } from 'electron';
import { promises as fs, existsSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { loadSettings } from '../services/settings';
import {
    scanMods,
    enableMod,
    disableMod,
    deleteMod,
    setModPriority,
    reorderMods,
    swapModPriority,
    findNextAvailablePriority,
    Mod,
} from '../services/mods';
import { getAddonsPath } from '../services/deadlock';
import { getModMetadata, setModMetadata } from '../services/metadata';

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
            audioUrl: metadata.audioUrl,
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

// reorder-mods
ipcMain.handle(
    'reorder-mods',
    async (_, orderedFileNames: string[]): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        await reorderMods(deadlockPath, orderedFileNames);
        const mods = await scanMods(deadlockPath);
        return mods.map(enrichMod);
    }
);

// swap-mod-priority
ipcMain.handle(
    'swap-mod-priority',
    async (_, modIdA: string, modIdB: string): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        await swapModPriority(deadlockPath, modIdA, modIdB);
        const mods = await scanMods(deadlockPath);
        return mods.map(enrichMod);
    }
);

interface ImportCustomModArgs {
    vpkPath: string;
    name: string;
    thumbnailDataUrl?: string;
    nsfw?: boolean;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

async function readImageAsDataUrl(imagePath: string): Promise<string> {
    const ext = extname(imagePath).toLowerCase();
    const mime = IMAGE_MIME_BY_EXT[ext];
    if (!mime) {
        throw new Error(`Unsupported image type: ${ext}`);
    }
    const buf = await fs.readFile(imagePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
}

// read-image-data-url
// Used by the custom-mod import modal to preview a local image file. The renderer can't
// fetch file:// URLs under webSecurity; main reads and hands back a base64 data URL.
ipcMain.handle('read-image-data-url', async (_, imagePath: string): Promise<string> => {
    if (!imagePath || !existsSync(imagePath)) {
        throw new Error('Image file not found');
    }
    return readImageAsDataUrl(imagePath);
});

// import-custom-mod
// The Deadlock engine requires strict `pakXX_dir.vpk` naming (see apply-mina-variant),
// so custom imports always get a naked `pakNN_dir.vpk` filename — no slug. The
// human-readable name lives in metadata.modName and is shown in the UI instead.
// Multi-file VPKs keep their numbered siblings, remapped as `pakNN_000.vpk` etc.
ipcMain.handle(
    'import-custom-mod',
    async (_, args: ImportCustomModArgs): Promise<Mod[]> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }

        const { vpkPath, name, thumbnailDataUrl, nsfw } = args;

        if (!vpkPath || !existsSync(vpkPath)) {
            throw new Error('VPK file not found');
        }
        if (!vpkPath.toLowerCase().endsWith('.vpk')) {
            throw new Error('Selected file is not a .vpk');
        }
        if (!name?.trim()) {
            throw new Error('A name is required');
        }

        const addonsPath = getAddonsPath(deadlockPath);
        if (!existsSync(addonsPath)) {
            await fs.mkdir(addonsPath, { recursive: true });
        }

        const priority = await findNextAvailablePriority(deadlockPath);
        const priorityStr = String(priority).padStart(2, '0');
        const newDirFileName = `pak${priorityStr}_dir.vpk`;

        const srcDir = dirname(vpkPath);
        const srcName = basename(vpkPath);

        if (srcName.toLowerCase().endsWith('_dir.vpk')) {
            const srcBase = srcName.slice(0, -'_dir.vpk'.length);
            const entries = await fs.readdir(srcDir);
            const siblings = entries.filter(
                (e) => e.startsWith(`${srcBase}_`) && e.toLowerCase().endsWith('.vpk')
            );
            if (siblings.length === 0) {
                await fs.copyFile(vpkPath, join(addonsPath, newDirFileName));
            } else {
                for (const s of siblings) {
                    const dstName = s === srcName
                        ? newDirFileName
                        : `pak${priorityStr}${s.slice(srcBase.length)}`;
                    await fs.copyFile(join(srcDir, s), join(addonsPath, dstName));
                }
            }
        } else {
            await fs.copyFile(vpkPath, join(addonsPath, newDirFileName));
        }

        setModMetadata(newDirFileName, {
            modName: name.trim(),
            thumbnailUrl: thumbnailDataUrl,
            nsfw: !!nsfw,
        });

        const mods = await scanMods(deadlockPath);
        return mods.map(enrichMod);
    }
);

