import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { getAddonsPath, getDisabledPath } from './deadlock';

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
 * Set the priority of a mod by renaming it (async)
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

    const parentDir = join(targetMod.path, '..');
    const priorityStr = String(Math.min(MAX_VPK_PRIORITY, newPriority)).padStart(2, '0');

    // Preserve the mod name by only replacing the priority prefix
    // e.g., pak05_cool_skin_dir.vpk -> pak10_cool_skin_dir.vpk
    const newFileName = targetMod.fileName.replace(/^pak\d{2}_/, `pak${priorityStr}_`);
    const destPath = join(parentDir, newFileName);

    // Check if destination already exists
    if (existsSync(destPath) && destPath !== targetMod.path) {
        throw new Error(`Priority ${newPriority} is already in use`);
    }

    await fs.rename(targetMod.path, destPath);

    return {
        ...targetMod,
        priority: newPriority,
        fileName: newFileName,
        path: destPath,
        id: generateModId(newFileName),
    };
}
