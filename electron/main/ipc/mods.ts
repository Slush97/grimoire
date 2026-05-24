import { ipcMain } from 'electron';
import { promises as fs, existsSync } from 'fs';
import { extname, join } from 'path';
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
import { getModMetadata, setModMetadata, setModMetadataWithHash, removeModMetadata, pruneOrphanMetadata } from '../services/metadata';
import { inferHeroFromTitle } from '@grimoire/social-types/heroes';
import { inferHeroFromVpk, classifyGlobalModFromVpk } from '../services/vpk';
import { migrateIgnoredConflictKeysForMods } from '../services/conflicts';
import { detectUnknownModFilters, type UnknownModFilterGuess } from '../services/unknownModDetection';
import { downloadMod } from '../services/download';
import { mergeMods, unmergeMod } from '../services/modMerger';
import { getMainWindow } from '../index';
import type { ApplyUnknownCustomModArgs, ApplyUnknownModMatchArgs, EditLocalModArgs, GlobalModType, MergeModsArgs, UnmergeModResult } from '../../../src/types/mod';

const unknownDetectionControllers = new Map<string, AbortController>();

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
 * Enrich mod with metadata.
 *
 * For Sound mods without a stored lockerHero, lazily infer one from the mod
 * name and persist it. The infer call is cheap (substring + a few regexes per
 * hero) but writing back means follow-up scans skip the work and the manual
 * override path has a stable field to overwrite.
 */
function enrichMod(mod: Mod): Mod {
    const metadata = getModMetadata(mod.fileName);
    const isUnknown =
        !metadata?.gameBananaId &&
        !(typeof metadata?.modName === 'string' && metadata.modName.trim().length > 0);
    if (metadata) {
        let lockerHero = metadata.lockerHero;
        let lockerHeroSource = metadata.lockerHeroSource;
        if (!lockerHero && metadata.sourceSection === 'Sound') {
            // Title match first because it's O(1) regex; only crack open the
            // VPK if the title gave us nothing. The VPK path is authoritative
            // (parses real Source 2 codenames like `ghost` → Lady Geist) but
            // costs a disk read + directory tree parse per call.
            let inferred = inferHeroFromTitle(metadata.modName || mod.name);
            let inferredSource: typeof lockerHeroSource = inferred ? 'title' : undefined;
            if (!inferred) {
                try {
                    inferred = inferHeroFromVpk(mod.path);
                    inferredSource = inferred ? 'vpk' : undefined;
                } catch (err) {
                    console.warn(`[enrichMod] VPK hero inference failed for ${mod.fileName}:`, err);
                }
            }
            if (inferred) {
                setModMetadata(mod.fileName, { lockerHero: inferred, lockerHeroSource: inferredSource });
                lockerHero = inferred;
                lockerHeroSource = inferredSource;
            }
        }
        // Global (non-hero) cosmetic type. Classified once from the VPK tree
        // then persisted (including the null "checked, not global" result) so
        // later scans skip the parse. The classifier guards out hero payloads,
        // so a real skin resolves to null and stays on the hero axis.
        let globalType = metadata.globalType;
        if (globalType === undefined) {
            let classified: ReturnType<typeof classifyGlobalModFromVpk> = null;
            try {
                classified = classifyGlobalModFromVpk(mod.path);
            } catch (err) {
                console.warn(`[enrichMod] VPK global-type classification failed for ${mod.fileName}:`, err);
            }
            setModMetadata(mod.fileName, { globalType: classified });
            globalType = classified;
        }
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
            sha256: metadata.sha256,
            isUnknown,
            variantLabel: metadata.variantLabel,
            fileDescription: metadata.fileDescription,
            sourceFileName: metadata.sourceFileName,
            lockerHero,
            lockerHeroSource,
            globalType: globalType ?? undefined,
            merged: metadata.merged,
            ignoreUpdates: metadata.ignoreUpdates,
        };
    }
    return { ...mod, isUnknown };
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
    // Self-heal users whose metadata.json still carries orphan entries from
    // pre-fix deletes (issue #26). Skip while dev mode is active: the dev
    // sandbox starts empty, and pruning against it would wipe every real
    // install's name/thumbnail/gameBananaId from the global metadata sidecar.
    const settings = loadSettings();
    if (!settings.devMode) {
        pruneOrphanMetadata(new Set(mods.map((m) => m.fileName)));
    }
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

// detect-unknown-mod-filters
ipcMain.handle('detect-unknown-mod-filters', async (_, modId: string): Promise<UnknownModFilterGuess> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mods = await scanMods(deadlockPath);
    const mod = mods.find((m) => m.id === modId);
    if (!mod) {
        throw new Error(`Mod not found: ${modId}`);
    }
    unknownDetectionControllers.get(modId)?.abort();
    const controller = new AbortController();
    unknownDetectionControllers.set(modId, controller);
    try {
        return await detectUnknownModFilters(mod.id, mod.fileName, mod.path, { signal: controller.signal });
    } finally {
        if (unknownDetectionControllers.get(modId) === controller) {
            unknownDetectionControllers.delete(modId);
        }
    }
});

// cancel-unknown-mod-detection
ipcMain.handle('cancel-unknown-mod-detection', async (_, modId: string): Promise<void> => {
    const controller = unknownDetectionControllers.get(modId);
    if (controller) {
        controller.abort();
        unknownDetectionControllers.delete(modId);
    }
});

// apply-unknown-mod-match
ipcMain.handle(
    'apply-unknown-mod-match',
    async (_, modId: string, match: ApplyUnknownModMatchArgs): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        if (!match || !Number.isFinite(match.gameBananaId) || !match.modName?.trim()) {
            throw new Error('Invalid GameBanana match');
        }
        if (!Number.isFinite(match.gameBananaFileId) || !match.sourceFileName?.trim()) {
            throw new Error('The matched GameBanana file is missing download information');
        }

        const mods = await scanMods(deadlockPath);
        const target = mods.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }

        const wasEnabled = target.enabled;
        const downloadResult = await downloadMod(deadlockPath, {
            modId: match.gameBananaId,
            fileId: match.gameBananaFileId,
            fileName: match.sourceFileName,
            section: match.sourceSection ?? 'Mod',
        }, getMainWindow());
        const installedFileNames = new Set(downloadResult.installedVpks);

        const afterDownload = await scanMods(deadlockPath);
        const downloaded = afterDownload
            .filter((candidate) => {
                if (candidate.id === target.id) return false;
                return installedFileNames.has(candidate.fileName);
            })
            .sort((a, b) => downloadResult.installedVpks.indexOf(a.fileName) - downloadResult.installedVpks.indexOf(b.fileName));

        if (downloaded.length === 0) {
            throw new Error('Download completed, but the installed replacement VPK could not be found. The unknown mod was kept.');
        }

        await deleteMod(deadlockPath, target.id);

        const finalFileNames: string[] = [];
        if (wasEnabled) {
            for (const replacement of downloaded) {
                if (!replacement.enabled) {
                    const enabled = await enableMod(deadlockPath, replacement.id);
                    finalFileNames.push(enabled.fileName);
                } else {
                    finalFileNames.push(replacement.fileName);
                }
            }
        } else {
            finalFileNames.push(...downloaded.map((replacement) => replacement.fileName));
        }

        const finalMods = await scanMods(deadlockPath);
        const finalReplacement =
            finalMods.find((candidate) => candidate.fileName === finalFileNames[0]) ??
            downloaded[0];
        return enrichMod(finalReplacement ?? downloaded[0]);
    }
);

// apply-unknown-custom-mod
ipcMain.handle(
    'apply-unknown-custom-mod',
    async (_, modId: string, args: ApplyUnknownCustomModArgs): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        if (!args?.name?.trim()) {
            throw new Error('A name is required');
        }

        const mods = await scanMods(deadlockPath);
        const target = mods.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }

        await setModMetadataWithHash(target.fileName, {
            modName: args.name.trim(),
            thumbnailUrl: args.thumbnailDataUrl,
            nsfw: !!args.nsfw,
        }, target.path);

        return enrichMod(target);
    }
);

// edit-local-mod - local/custom VPKs keep engine-safe pakNN filenames, so
// edits update the human-readable metadata shown in Grimoire.
ipcMain.handle(
    'edit-local-mod',
    async (_, modId: string, args: EditLocalModArgs): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const trimmed = args?.name?.trim() ?? '';
        if (!trimmed) {
            throw new Error('A name is required');
        }

        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const existing = getModMetadata(target.fileName) ?? {};
        if (typeof existing.gameBananaId === 'number' && existing.gameBananaId > 0) {
            throw new Error('Only local mods can be renamed');
        }

        await setModMetadataWithHash(target.fileName, {
            modName: trimmed,
            thumbnailUrl: args.thumbnailDataUrl,
            nsfw: !!args.nsfw,
        }, target.path);

        return enrichMod(target);
    }
);

// set-variant-label - user-facing rename of a single VPK (the "variant"
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

// set-mod-locker-hero — manual hero tag for the Locker. Pass null to clear
// the override and fall back to categoryId / inferHeroFromTitle. Used from
// the Locker's "unassigned" section when GameBanana left a mod under the
// generic "Skins" parent (or when an author misspelled the hero name).
ipcMain.handle(
    'set-mod-locker-hero',
    async (_, modId: string, heroName: string | null): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        const trimmed = heroName?.trim() ?? '';
        setModMetadata(target.fileName, {
            lockerHero: trimmed.length > 0 ? trimmed : undefined,
            lockerHeroSource: trimmed.length > 0 ? 'manual' : undefined,
            ...(trimmed.length > 0 ? { globalType: undefined } : {}),
        });
        return enrichMod(target);
    }
);

// set-mod-global-type — manual override for the Locker's Global axis, used when
// the VPK-path classifier (classifyGlobalModType) misses a mod or files it
// under the wrong type. Pass a GlobalModType to assign it (this also clears any
// hero tag, since a mod lives on either the hero axis or the global axis, never
// both). Pass null to force it OFF the global axis: we persist the explicit null
// so the classifier doesn't just re-add it on the next scan. The stored value
// wins over auto-classification because enrichMod only classifies when
// globalType is undefined.
ipcMain.handle(
    'set-mod-global-type',
    async (_, modId: string, globalType: GlobalModType | null): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        setModMetadata(target.fileName, {
            globalType,
            // Assigning a global type moves the mod off the hero axis.
            ...(globalType ? { lockerHero: undefined, lockerHeroSource: undefined } : {}),
        });
        return enrichMod(target);
    }
);

// set-mod-ignore-updates — manual opt-out from the update-available flag.
// Pass false to clear and resume normal update detection. Stored alongside
// other per-mod metadata so it survives priority renames.
ipcMain.handle(
    'set-mod-ignore-updates',
    async (_, modId: string, ignore: boolean): Promise<Mod> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const all = await scanMods(deadlockPath);
        const target = all.find((m) => m.id === modId);
        if (!target) {
            throw new Error(`Mod not found: ${modId}`);
        }
        setModMetadata(target.fileName, {
            ignoreUpdates: ignore ? true : undefined,
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
// so custom imports always get a naked `pakNN_dir.vpk` filename - no slug. The
// human-readable name lives in metadata.modName and is shown in the UI instead.
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

        await fs.copyFile(vpkPath, join(addonsPath, newDirFileName));

        // Scrub any orphan metadata at this slot before writing. setModMetadata
        // merges into the existing entry, so stale fields (gameBananaId,
        // categoryName, etc.) from a prior occupant would otherwise stick to
        // the new local mod and visually merge it with unrelated mods.
        removeModMetadata(newDirFileName);
        await setModMetadataWithHash(newDirFileName, {
            modName: name.trim(),
            thumbnailUrl: thumbnailDataUrl,
            nsfw: !!nsfw,
        }, join(addonsPath, newDirFileName));

        const mods = await scanMods(deadlockPath);
        return mods.map(enrichMod);
    }
);

// merge-mods — combine multiple installed VPKs into one via vpkmerge. Sources
// are disabled (moved to .disabled/) so their priority slots free up; the
// merged mod takes the next available pakNN slot. Manifest (source list +
// portable-profile share code) is stored in the merged mod's metadata so
// unmerge can either re-enable the originals or fall back to the share code.
ipcMain.handle('merge-mods', async (_, args: MergeModsArgs): Promise<Mod> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const result = await mergeMods(deadlockPath, args.modIds, {
        name: args.name,
        thumbnailDataUrl: args.thumbnailDataUrl,
        strict: args.strict,
    });
    return enrichMod(result.mod);
});

// unmerge-mod — reverse a merge by re-enabling sources still on disk and
// deleting the merged VPK. Returns missing-source filenames + the share code
// so the renderer can offer the portable-profile import flow for recovery.
ipcMain.handle(
    'unmerge-mod',
    async (_, mergedModId: string): Promise<UnmergeModResult> => {
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) {
            throw new Error('No Deadlock path configured');
        }
        const result = await unmergeMod(deadlockPath, mergedModId);
        return {
            ...result,
            recovered: result.recovered.map(enrichMod),
        };
    }
);

