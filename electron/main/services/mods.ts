import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, randomBytes } from 'crypto';
import { getAddonsPath, getDisabledPath } from './deadlock';
import { getModMetadata, setModMetadata, removeModMetadata, migrateModMetadata } from './metadata';
import { compareFileContents, fingerprintFile } from './fileMatch';

/** Minimum VPK priority number */
const MIN_VPK_PRIORITY = 1;
/** Maximum VPK priority number (Source 2 limit) */
const MAX_VPK_PRIORITY = 99;
/** Default priority for mods without pak## prefix */
const DEFAULT_MOD_PRIORITY = 50;

type CollisionMetadataOwner = 'enabled' | 'disabled';

export interface Mod {
    id: string;
    name: string;
    fileName: string;
    path: string;
    enabled: boolean;
    priority: number;
    size: number;
    installedAt: string;
    description?: string;
    thumbnailUrl?: string;
    audioUrl?: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
    categoryId?: number;
    categoryName?: string;
    sourceSection?: string;
    nsfw?: boolean;
    isArchived?: boolean;
    sha256?: string;
    isUnknown?: boolean;
    /** User-given name for this VPK, used to disambiguate variants of the
     *  same GameBanana mod (e.g. "Red preset" vs "Blue preset"). Optional. */
    variantLabel?: string;
    /** Author-provided file header from GameBanana (_sDescription). Used as
     *  the variant-picker fallback when the user hasn't set a label of their
     *  own, so rows show "Gold w/ alt candle" instead of the raw filename. */
    fileDescription?: string;
    /** Original GameBanana filename stem (e.g. "galaxy_rem_gold"). Captured
     *  so variants from mods whose author left descriptions empty still get
     *  a meaningful label - falls between fileDescription and the local
     *  pakNN_dir.vpk filename in the picker's display chain. */
    sourceFileName?: string;
    /** Populated when this VPK was produced by mergeMods. The metadata
     *  enricher reads this from the mod metadata sidecar. */
    merged?: import('../../../src/types/mod').MergedModInfo;
}

/**
 * Parse VPK filename to extract priority (pak##_dir.vpk format)
 */
function parseVpkPriority(filename: string): number | null {
    if (
        !filename.startsWith('pak') ||
        (!filename.endsWith('_dir.vpk') && !filename.endsWith('.vpk'))
    ) {
        return null;
    }
    const numberPart = filename.slice(3, 5);
    const num = parseInt(numberPart, 10);
    return isNaN(num) ? null : num;
}

/**
 * Generate a mod ID from the file name (hash)
 * Uses fileName instead of full path so ID stays stable when mod moves between folders
 */
function generateModId(fileName: string): string {
    return createHash('md5').update(fileName).digest('hex').slice(0, 16);
}

/**
 * Extract a human-readable name from the VPK filename
 */
function extractModName(filename: string): string {
    // Remove _dir.vpk or .vpk suffix
    let name = filename.replace(/_dir\.vpk$/, '').replace(/\.vpk$/, '');

    // Remove pak## prefix if present
    if (name.startsWith('pak') && name.length > 5) {
        const rest = name.slice(5);
        name = rest.startsWith('_') ? rest.slice(1) : rest;
    }

    // Convert underscores/dashes to spaces and title case
    return name
        .replace(/[_-]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Scan a folder for VPK mods (async)
 */
async function scanFolder(folder: string, enabled: boolean): Promise<Mod[]> {
    const mods: Mod[] = [];

    if (!existsSync(folder)) {
        return mods;
    }

    const entries = await fs.readdir(folder);

    for (const entry of entries) {
        const fullPath = join(folder, entry);

        try {
            const stats = await fs.stat(fullPath);
            if (!stats.isFile()) continue;

            if (!isDeadlockModVpk(entry)) continue;

            const priority = parseVpkPriority(entry) ?? DEFAULT_MOD_PRIORITY;

            mods.push({
                id: generateModId(entry),
                name: extractModName(entry),
                fileName: entry,
                path: fullPath,
                enabled,
                priority,
                size: stats.size,
                installedAt: stats.mtime.toISOString(),
            });
        } catch {
            // Skip files we can't read
        }
    }

    return mods;
}

/**
 * Scan for all mods in both enabled and disabled folders (async).
 *
 * Not pure: reconcileEnabledDisabledCollisions may rename or unlink files
 * when the same pakNN_dir.vpk exists in both addons/ and .disabled/. The
 * heal is idempotent, so repeated scans no-op after the first pass.
 */
export async function scanMods(deadlockPath: string): Promise<Mod[]> {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);

    await reconcileEnabledDisabledCollisions(deadlockPath, addonsPath, disabledPath);

    const [enabledMods, disabledMods] = await Promise.all([
        scanFolder(addonsPath, true),
        scanFolder(disabledPath, false),
    ]);

    const mods = [...enabledMods, ...disabledMods];

    // Sort by priority
    mods.sort((a, b) => a.priority - b.priority);

    return mods;
}

async function reconcileEnabledDisabledCollisions(
    deadlockPath: string,
    addonsPath: string,
    disabledPath: string
): Promise<void> {
    if (!existsSync(addonsPath) || !existsSync(disabledPath)) return;

    const [enabledEntries, disabledEntries] = await Promise.all([
        listPrimaryVpkFiles(addonsPath),
        listPrimaryVpkFiles(disabledPath),
    ]);
    const enabledByName = new Map(enabledEntries.map((entry) => [entry.toLowerCase(), entry]));

    for (const disabledEntry of disabledEntries) {
        const enabledEntry = enabledByName.get(disabledEntry.toLowerCase());
        if (!enabledEntry) continue;

        const identical = await sameFileContents(
            join(addonsPath, enabledEntry),
            join(disabledPath, disabledEntry)
        );
        if (identical) {
            await fs.unlink(join(disabledPath, disabledEntry));
            console.warn(
                `[mods] Removed duplicate disabled VPK for ${enabledEntry}: ${disabledEntry}`
            );
            continue;
        }

        const priority = await findNextAvailablePriority(deadlockPath);
        const metadata = getModMetadata(enabledEntry);
        const owner = await getCollisionMetadataOwner(metadata?.sha256, join(disabledPath, disabledEntry));
        const renamedFileName = await renameModFileToPriority(disabledPath, disabledEntry, priority);
        moveCollisionMetadata(enabledEntry, renamedFileName, owner, metadata);
        console.warn(
            `[mods] Renamed conflicting disabled VPK ${disabledEntry} to ${renamedFileName}; contents differ from enabled copy.`
        );
    }
}

async function listPrimaryVpkFiles(folder: string): Promise<string[]> {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && isDeadlockModVpk(entry.name))
        .map((entry) => entry.name);
}

function isDeadlockModVpk(fileName: string): boolean {
    return fileName.toLowerCase().endsWith('_dir.vpk');
}

async function sameFileContents(leftPath: string, rightPath: string): Promise<boolean> {
    const comparison = await compareFileContents(leftPath, rightPath);
    return comparison.matches;
}

function moveCollisionMetadata(
    enabledFileName: string,
    renamedFileName: string,
    owner: CollisionMetadataOwner,
    metadata: ReturnType<typeof getModMetadata>
): void {
    removeModMetadata(renamedFileName);
    if (owner !== 'disabled' || !metadata) return;

    setModMetadata(renamedFileName, metadata);
    removeModMetadata(enabledFileName);
}

async function getCollisionMetadataOwner(
    sha256: string | undefined,
    disabledPath: string
): Promise<CollisionMetadataOwner> {
    if (!sha256) return 'enabled';

    const disabledHash = await fingerprintFile(disabledPath);
    return disabledHash.sha256.toLowerCase() === sha256.toLowerCase() ? 'disabled' : 'enabled';
}

async function renameModFileToPriority(
    folder: string,
    fileName: string,
    priority: number
): Promise<string> {
    const finalName = fileNameForPriority(fileName, priority);
    if (existsSync(join(folder, finalName))) {
        throw new Error(`Cannot rename conflicting disabled mod: target already exists (${finalName})`);
    }

    await fs.rename(join(folder, fileName), join(folder, finalName));
    return finalName;
}

function fileNameForPriority(fileName: string, priority: number): string {
    const renamed = renameWithPriority(fileName, priority);
    if (renamed !== fileName) return renamed;

    const priorityStr = String(Math.min(MAX_VPK_PRIORITY, priority)).padStart(2, '0');
    return `pak${priorityStr}_dir.vpk`;
}

async function moveModToFolder(
    deadlockPath: string,
    targetMod: Mod,
    destinationFolder: string,
    enabled: boolean
): Promise<Mod> {
    let destinationFileName = targetMod.fileName;
    let collisionMetadata: ReturnType<typeof getModMetadata> | undefined;
    let collisionMetadataOwner: CollisionMetadataOwner | undefined;
    const destinationPath = join(destinationFolder, destinationFileName);
    const hasConflict = targetMod.path !== destinationPath && existsSync(destinationPath);

    if (hasConflict) {
        const identical = await sameFileContents(
            targetMod.path,
            join(destinationFolder, destinationFileName)
        );

        if (identical) {
            await fs.unlink(targetMod.path);
            return {
                ...targetMod,
                enabled,
                path: join(destinationFolder, destinationFileName),
            };
        }

        const priority = await findNextAvailablePriority(deadlockPath);
        collisionMetadata = getModMetadata(targetMod.fileName);
        collisionMetadataOwner = await getCollisionMetadataOwner(
            collisionMetadata?.sha256,
            targetMod.path
        );
        destinationFileName = fileNameForPriority(targetMod.fileName, priority);
    }

    await fs.mkdir(destinationFolder, { recursive: true });
    await fs.rename(targetMod.path, join(destinationFolder, destinationFileName));

    if (destinationFileName !== targetMod.fileName) {
        if (collisionMetadataOwner) {
            moveCollisionMetadata(targetMod.fileName, destinationFileName, collisionMetadataOwner, collisionMetadata);
        } else {
            migrateModMetadata([{ from: targetMod.fileName, to: destinationFileName }]);
        }
    }

    return {
        ...targetMod,
        id: generateModId(destinationFileName),
        fileName: destinationFileName,
        enabled,
        priority: parseVpkPriority(destinationFileName) ?? targetMod.priority,
        path: join(destinationFolder, destinationFileName),
    };
}

/**
 * Get the set of used priorities in BOTH addons AND disabled folders (async)
 * This prevents conflicts when downloading new mods
 */
export async function getUsedPriorities(deadlockPath: string): Promise<Set<number>> {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);
    const usedPriorities = new Set<number>();

    const scanPriorities = async (folder: string) => {
        if (!existsSync(folder)) return;
        const entries = await fs.readdir(folder);
        for (const entry of entries) {
            const priority = parseVpkPriority(entry);
            if (priority !== null) {
                usedPriorities.add(priority);
            }
        }
    };

    await Promise.all([
        scanPriorities(addonsPath),
        scanPriorities(disabledPath),
    ]);

    return usedPriorities;
}

/**
 * Find the next available priority number that doesn't conflict (async)
 * Checks BOTH addons and disabled folders to avoid overwriting disabled mods
 */
export async function findNextAvailablePriority(deadlockPath: string, startFrom = MIN_VPK_PRIORITY): Promise<number> {
    const usedPriorities = await getUsedPriorities(deadlockPath);

    // Find next available starting from startFrom (default 1)
    let priority = startFrom;
    while (usedPriorities.has(priority) && priority < MAX_VPK_PRIORITY) {
        priority++;
    }

    // If all numbers up to 99 are taken, this is an error
    if (priority >= MAX_VPK_PRIORITY && usedPriorities.has(MAX_VPK_PRIORITY)) {
        throw new Error('No available priority slots (all 1-99 are used)');
    }

    return priority;
}

/**
 * Enable a mod by moving it from disabled to addons folder (async)
 */
export async function enableMod(deadlockPath: string, modId: string): Promise<Mod> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    if (targetMod.enabled) {
        return targetMod;
    }

    const addonsPath = getAddonsPath(deadlockPath);
    return moveModToFolder(deadlockPath, targetMod, addonsPath, true);
}

/**
 * Disable a mod by moving it to the disabled folder (async)
 */
export async function disableMod(deadlockPath: string, modId: string): Promise<Mod> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    if (!targetMod.enabled) {
        return targetMod;
    }

    const disabledPath = getDisabledPath(deadlockPath);
    return moveModToFolder(deadlockPath, targetMod, disabledPath, false);
}

/**
 * Delete a mod completely (async)
 */
export async function deleteMod(deadlockPath: string, modId: string): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    await fs.unlink(targetMod.path);

    // Metadata is keyed by fileName. If we leave it behind, the next mod that
    // is assigned the same pakNN_dir.vpk slot will inherit the deleted mod's
    // gameBananaId, thumbnail, category, etc. via setModMetadata's merge.
    removeModMetadata(targetMod.fileName);
}

/**
 * Replace the pak## prefix in a VPK filename with a new priority.
 */
function renameWithPriority(fileName: string, priority: number): string {
    const priorityStr = String(Math.min(MAX_VPK_PRIORITY, priority)).padStart(2, '0');
    return fileName.replace(/^pak\d{2}_/, `pak${priorityStr}_`);
}

/**
 * Set the priority of a mod by renaming its VPK file (async).
 * Also migrates metadata to the new filename.
 */
export async function setModPriority(
    deadlockPath: string,
    modId: string,
    newPriority: number
): Promise<Mod> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    const parentDir = dirname(targetMod.path);
    const newFileName = renameWithPriority(targetMod.fileName, newPriority);

    if (newFileName === targetMod.fileName) {
        return targetMod;
    }

    // Check BOTH folders, not just parentDir. Otherwise the user could
    // promote an enabled mod into a priority slot held by a disabled mod
    // (e.g. an absorbed merge source), reconcile would then rename the
    // disabled file on next scan, and any merged-mod manifest pointing at
    // that disabled fileName would silently lose its source.
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);
    if (
        existsSync(join(addonsPath, newFileName)) ||
        existsSync(join(disabledPath, newFileName))
    ) {
        throw new Error(`Priority ${newPriority} is already in use`);
    }
    await fs.rename(join(parentDir, targetMod.fileName), join(parentDir, newFileName));

    const oldMeta = getModMetadata(targetMod.fileName);
    if (oldMeta) {
        setModMetadata(newFileName, oldMeta);
        removeModMetadata(targetMod.fileName);
    }

    return {
        ...targetMod,
        priority: newPriority,
        fileName: newFileName,
        path: join(parentDir, newFileName),
        id: generateModId(newFileName),
    };
}

/**
 * Reorder mods by rewriting their pak## priorities to match the given order (async).
 * - Assigns priorities 1, 2, 3, … to orderedFileNames, skipping priority numbers
 *   already held by mods NOT in the list (so disabled mods keep their slots).
 * - Uses two-phase rename (temp prefix → final) so collisions between target
 *   priorities can't happen mid-operation.
 * - Migrates metadata for every renamed _dir.vpk.
 */
export async function reorderMods(
    deadlockPath: string,
    orderedFileNames: string[]
): Promise<void> {
    const allMods = await scanMods(deadlockPath);
    const modByFileName = new Map(allMods.map((m) => [m.fileName, m]));

    for (const fn of orderedFileNames) {
        if (!modByFileName.has(fn)) {
            throw new Error(`Mod not in list: ${fn}`);
        }
    }

    const targetSet = new Set(orderedFileNames);
    const reserved = new Set(
        allMods.filter((m) => !targetSet.has(m.fileName)).map((m) => m.priority)
    );

    const assignments: { mod: Mod; newPriority: number; newFileName: string }[] = [];
    let cursor = MIN_VPK_PRIORITY;
    for (const fileName of orderedFileNames) {
        while (reserved.has(cursor) && cursor <= MAX_VPK_PRIORITY) cursor++;
        if (cursor > MAX_VPK_PRIORITY) {
            throw new Error('No available priority slots (all 1-99 are used)');
        }
        const mod = modByFileName.get(fileName)!;
        const newFileName = renameWithPriority(fileName, cursor);
        if (mod.priority !== cursor || newFileName !== fileName) {
            assignments.push({ mod, newPriority: cursor, newFileName });
        }
        cursor++;
    }

    if (assignments.length === 0) return;

    const tmpId = randomBytes(4).toString('hex');
    type RenameStep = { fromPath: string; tmpPath: string; finalPath: string };
    const steps: RenameStep[] = [];

    for (const { mod, newFileName } of assignments) {
        const parentDir = dirname(mod.path);
        steps.push({
            fromPath: join(parentDir, mod.fileName),
            tmpPath: join(parentDir, `tmp${tmpId}_${mod.fileName}`),
            finalPath: join(parentDir, newFileName),
        });
    }

    const phase1Done: RenameStep[] = [];
    try {
        for (const step of steps) {
            await fs.rename(step.fromPath, step.tmpPath);
            phase1Done.push(step);
        }
    } catch (err) {
        for (const done of phase1Done.reverse()) {
            try {
                await fs.rename(done.tmpPath, done.fromPath);
            } catch { /* best-effort rollback */ }
        }
        throw err;
    }

    const phase2Done: RenameStep[] = [];
    try {
        for (const step of steps) {
            await fs.rename(step.tmpPath, step.finalPath);
            phase2Done.push(step);
        }
    } catch (err) {
        for (const done of phase2Done.reverse()) {
            try {
                await fs.rename(done.finalPath, done.tmpPath);
            } catch { /* ignore */ }
        }
        for (const step of steps) {
            try {
                await fs.rename(step.tmpPath, step.fromPath);
            } catch { /* ignore */ }
        }
        throw err;
    }

    migrateModMetadata(
        assignments.map(({ mod, newFileName }) => ({
            from: mod.fileName,
            to: newFileName,
        }))
    );
}

/**
 * Dense-pack enabled mods to consecutive pak## slots in their current priority
 * order, skipping any slot reserved by a disabled mod. Wraps reorderMods so
 * callers (applyProfile, post-install, post-enable/disable) get a single
 * two-phase rename instead of per-mod setModPriority cascades that fail on
 * mid-operation slot collisions.
 */
export async function compactEnabledMods(deadlockPath: string): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const orderedFileNames = mods
        .filter((m) => m.enabled)
        .sort((a, b) => a.priority - b.priority)
        .map((m) => m.fileName);
    if (orderedFileNames.length === 0) return;
    await reorderMods(deadlockPath, orderedFileNames);
}

/**
 * Swap the priorities of two mods (async).
 */
export async function swapModPriority(
    deadlockPath: string,
    modIdA: string,
    modIdB: string
): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const a = mods.find((m) => m.id === modIdA);
    const b = mods.find((m) => m.id === modIdB);

    if (!a || !b) {
        throw new Error('Mod not found for swap');
    }
    if (a.priority === b.priority) {
        throw new Error('Cannot swap mods with identical priorities');
    }

    // Build a new ordered list where A and B's positions are swapped.
    // We only reorder enabled mods to avoid touching disabled-mod priorities.
    const enabled = mods.filter((m) => m.enabled).sort((x, y) => x.priority - y.priority);
    const aIdx = enabled.findIndex((m) => m.id === modIdA);
    const bIdx = enabled.findIndex((m) => m.id === modIdB);

    if (aIdx === -1 || bIdx === -1) {
        // At least one mod is disabled — fall back to direct priority swap via temp
        await directSwap(a, b);
        return;
    }

    const orderedFileNames = enabled.map((m) => m.fileName);
    [orderedFileNames[aIdx], orderedFileNames[bIdx]] = [orderedFileNames[bIdx], orderedFileNames[aIdx]];
    await reorderMods(deadlockPath, orderedFileNames);
}

/**
 * Direct swap of two mods' pak## priorities via a temp name.
 * Used when one or both mods live in the disabled folder.
 */
async function directSwap(a: Mod, b: Mod): Promise<void> {
    const parentA = dirname(a.path);
    const parentB = dirname(b.path);
    const tmpId = randomBytes(4).toString('hex');
    const steps = [
        {
            from: join(parentA, a.fileName),
            tmp: join(parentA, `tmp${tmpId}_${a.fileName}`),
            final: join(parentA, renameWithPriority(a.fileName, b.priority)),
        },
        {
            from: join(parentB, b.fileName),
            tmp: join(parentB, `tmp${tmpId}_${b.fileName}`),
            final: join(parentB, renameWithPriority(b.fileName, a.priority)),
        },
    ];

    for (const step of steps) await fs.rename(step.from, step.tmp);
    for (const step of steps) await fs.rename(step.tmp, step.final);

    migrateModMetadata([
        { from: a.fileName, to: renameWithPriority(a.fileName, b.priority) },
        { from: b.fileName, to: renameWithPriority(b.fileName, a.priority) },
    ]);
}
