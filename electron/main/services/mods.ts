import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, randomBytes } from 'crypto';
import { getAddonsPath, getDisabledPath } from './deadlock';
import { getModMetadata, setModMetadata, removeModMetadata, migrateModMetadata } from './metadata';

/** Minimum VPK priority number */
const MIN_VPK_PRIORITY = 1;
/** Maximum VPK priority number (Source 2 limit) */
const MAX_VPK_PRIORITY = 99;
/** Default priority for mods without pak## prefix */
const DEFAULT_MOD_PRIORITY = 50;

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
    gameBananaId?: number;
    gameBananaFileId?: number;
    categoryId?: number;
    categoryName?: string;
    sourceSection?: string;
    nsfw?: boolean;
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

            // Only process VPK files
            if (!entry.endsWith('_dir.vpk') && !entry.endsWith('.vpk')) continue;

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
 * Scan for all mods in both enabled and disabled folders (async)
 */
export async function scanMods(deadlockPath: string): Promise<Mod[]> {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);

    const [enabledMods, disabledMods] = await Promise.all([
        scanFolder(addonsPath, true),
        scanFolder(disabledPath, false),
    ]);

    const mods = [...enabledMods, ...disabledMods];

    // Sort by priority
    mods.sort((a, b) => a.priority - b.priority);

    return mods;
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
    const destPath = join(addonsPath, targetMod.fileName);

    await fs.rename(targetMod.path, destPath);

    return {
        ...targetMod,
        enabled: true,
        path: destPath,
    };
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
    const destPath = join(disabledPath, targetMod.fileName);

    await fs.rename(targetMod.path, destPath);

    return {
        ...targetMod,
        enabled: false,
        path: destPath,
    };
}

/**
 * Delete a mod completely (including related VPK files) (async)
 */
export async function deleteMod(deadlockPath: string, modId: string): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    // Delete the main file
    await fs.unlink(targetMod.path);

    // Also remove related VPK files (pak##_000.vpk, pak##_001.vpk, etc.)
    const baseName = targetMod.fileName.replace(/_dir\.vpk$/, '');
    const parentDir = join(targetMod.path, '..');

    try {
        const siblings = await fs.readdir(parentDir);
        const deletePromises = siblings
            .filter(sibling => sibling.startsWith(baseName) && sibling.endsWith('.vpk'))
            .map(sibling => fs.unlink(join(parentDir, sibling)));
        await Promise.all(deletePromises);
    } catch {
        // Ignore errors when cleaning up related files
    }
}

/**
 * Find all VPK sibling files for a given _dir.vpk (e.g. pak05_foo_000.vpk, pak05_foo_001.vpk)
 */
async function findVpkSiblings(parentDir: string, dirFileName: string): Promise<string[]> {
    const baseName = dirFileName.replace(/_dir\.vpk$/, '');
    const entries = await fs.readdir(parentDir);
    return entries.filter((e) => e.startsWith(`${baseName}_`) && e.endsWith('.vpk'));
}

/**
 * Replace the pak## prefix in a VPK filename with a new priority.
 */
function renameWithPriority(fileName: string, priority: number): string {
    const priorityStr = String(Math.min(MAX_VPK_PRIORITY, priority)).padStart(2, '0');
    return fileName.replace(/^pak\d{2}_/, `pak${priorityStr}_`);
}

/**
 * Set the priority of a mod by renaming it and all its VPK siblings (async).
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

    const siblings = await findVpkSiblings(parentDir, targetMod.fileName);

    // Collision check across all siblings
    for (const sibling of siblings) {
        const newSiblingName = renameWithPriority(sibling, newPriority);
        if (newSiblingName === sibling) continue;
        if (existsSync(join(parentDir, newSiblingName))) {
            throw new Error(`Priority ${newPriority} is already in use`);
        }
    }

    for (const sibling of siblings) {
        const newSiblingName = renameWithPriority(sibling, newPriority);
        if (newSiblingName === sibling) continue;
        await fs.rename(join(parentDir, sibling), join(parentDir, newSiblingName));
    }

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

    for (const { mod, newPriority } of assignments) {
        const parentDir = dirname(mod.path);
        const siblings = await findVpkSiblings(parentDir, mod.fileName);

        for (const sibling of siblings) {
            const finalName = renameWithPriority(sibling, newPriority);
            if (finalName === sibling) continue;
            steps.push({
                fromPath: join(parentDir, sibling),
                tmpPath: join(parentDir, `tmp${tmpId}_${sibling}`),
                finalPath: join(parentDir, finalName),
            });
        }
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
    const aSiblings = await findVpkSiblings(parentA, a.fileName);
    const bSiblings = await findVpkSiblings(parentB, b.fileName);

    const tmpId = randomBytes(4).toString('hex');
    const steps: { from: string; tmp: string; final: string }[] = [];

    for (const s of aSiblings) {
        steps.push({
            from: join(parentA, s),
            tmp: join(parentA, `tmp${tmpId}_${s}`),
            final: join(parentA, renameWithPriority(s, b.priority)),
        });
    }
    for (const s of bSiblings) {
        steps.push({
            from: join(parentB, s),
            tmp: join(parentB, `tmp${tmpId}_${s}`),
            final: join(parentB, renameWithPriority(s, a.priority)),
        });
    }

    for (const step of steps) await fs.rename(step.from, step.tmp);
    for (const step of steps) await fs.rename(step.tmp, step.final);

    migrateModMetadata([
        { from: a.fileName, to: renameWithPriority(a.fileName, b.priority) },
        { from: b.fileName, to: renameWithPriority(b.fileName, a.priority) },
    ]);
}
