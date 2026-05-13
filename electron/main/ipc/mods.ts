import { ipcMain } from 'electron';
import { promises as fs, existsSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { loadSettings, saveSettings } from '../services/settings';
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
import { migrateIgnoredConflictKeysForMods } from '../services/conflicts';

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
            isArchived: metadata.isArchived,
            variantLabel: metadata.variantLabel,
            fileDescription: metadata.fileDescription,
            sourceFileName: metadata.sourceFileName,
        };
    }
    return mod;
}

function sameKeys(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((key, index) => key === b[index]);
}

function migrateIgnoredConflictKeysBeforeRenames(mods: Mod[]): void {
    const settings = loadSettings();
    const current = settings.ignoredConflicts ?? [];
    if (current.length === 0) return;

    const migrated = migrateIgnoredConflictKeysForMods(current, mods);
    if (!sameKeys(migrated, current)) {
        saveSettings({ ...settings, ignoredConflicts: migrated });
    }
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

// set-variant-label — user-facing rename of a single VPK (the "variant"
// inside a grouped mod). Stored alongside the mod's other metadata so it
// survives priority renames via migrateModMetadata. An empty string clears
// the label and falls back to the filename-derived display.
ipcMain.handle(
    'set-variant-label',
    async (_, modId: string, label: string): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const trimmed = label.trim();
        setModMetadata(target.fileName, {
            variantLabel: trimmed.length > 0 ? trimmed : undefined,
        });
        return enrichMod(target);
    }
);

// backfill-gamebanana-file-id — heal legacy 1-click installs that were saved
// before we recovered the file id from the archive URL. The renderer matches
// a local variant to a GameBanana file row (by sourceFileName/fileName or by
// sole-file fallback) and asks us to persist the resolved id plus the file's
// canonical label fields, so both the per-file install state in
// ModDetailsModal and the variant picker's title flip to the right values on
// the next render. Label fields are only written when no existing value is
// present so a user's variantLabel rename never gets clobbered (the picker
// already prefers variantLabel over fileDescription, but we belt-and-brace
// against fileDescription/sourceFileName too).
interface BackfillPayload {
    gameBananaFileId: number;
    fileDescription?: string;
    sourceFileName?: string;
}
ipcMain.handle(
    'backfill-gamebanana-file-id',
    async (_, modId: string, payload: BackfillPayload): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const existing = getModMetadata(target.fileName) ?? {};
        const patch: Record<string, unknown> = { gameBananaFileId: payload.gameBananaFileId };
        if (payload.fileDescription && !existing.fileDescription) {
            patch.fileDescription = payload.fileDescription;
        }
        // Overwrite sourceFileName only when missing or when it's the old
        // placeholder (gamebanana-mod-{timestamp}) — a real GB stem from a
        // working enrichment path is kept as-is.
        const placeholderName = existing.sourceFileName?.match(/^gamebanana-mod-\d+$/);
        if (payload.sourceFileName && (!existing.sourceFileName || placeholderName)) {
            patch.sourceFileName = payload.sourceFileName;
        }
        setModMetadata(target.fileName, patch);
        return enrichMod(target);
    }
);

// set-mod-priority
ipcMain.handle(
    'set-mod-priority',
    async (_, modId: string, priority: number): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        migrateIgnoredConflictKeysBeforeRenames(await scanMods(deadlockPath));
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
        migrateIgnoredConflictKeysBeforeRenames(await scanMods(deadlockPath));
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
        migrateIgnoredConflictKeysBeforeRenames(await scanMods(deadlockPath));
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

