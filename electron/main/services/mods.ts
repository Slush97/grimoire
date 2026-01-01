import {
    readdirSync,
    statSync,
    renameSync,
    unlinkSync,
    existsSync,
} from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { getAddonsPath, getDisabledPath } from './deadlock';

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
 * Scan a folder for VPK mods
 */
function scanFolder(folder: string, enabled: boolean): Mod[] {
    const mods: Mod[] = [];

    if (!existsSync(folder)) {
        return mods;
    }

    const entries = readdirSync(folder);

    for (const entry of entries) {
        const fullPath = join(folder, entry);

        try {
            const stats = statSync(fullPath);
            if (!stats.isFile()) continue;

            // Only process VPK files
            if (!entry.endsWith('_dir.vpk') && !entry.endsWith('.vpk')) continue;

            const priority = parseVpkPriority(entry) ?? 50;

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
 * Scan for all mods in both enabled and disabled folders
 */
export function scanMods(deadlockPath: string): Mod[] {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);

    const mods: Mod[] = [
        ...scanFolder(addonsPath, true),
        ...scanFolder(disabledPath, false),
    ];

    // Sort by priority
    mods.sort((a, b) => a.priority - b.priority);

    return mods;
}

/**
 * Find the next available priority number that doesn't conflict
 * Checks BOTH addons and disabled folders to avoid overwriting disabled mods
 */
export function findNextAvailablePriority(deadlockPath: string, startFrom = 1): number {
    const usedPriorities = getUsedPriorities(deadlockPath);

    // Find next available starting from startFrom (default 1)
    let priority = startFrom;
    while (usedPriorities.has(priority) && priority < 99) {
        priority++;
    }

    // If all numbers up to 99 are taken, this is an error
    if (priority >= 99 && usedPriorities.has(99)) {
        throw new Error('No available priority slots (all 1-99 are used)');
    }

    return priority;
}

/**
 * Get the set of used priorities in BOTH addons AND disabled folders
 * This prevents conflicts when downloading new mods
 */
export function getUsedPriorities(deadlockPath: string): Set<number> {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);
    const usedPriorities = new Set<number>();

    // Check addons folder
    if (existsSync(addonsPath)) {
        const entries = readdirSync(addonsPath);
        for (const entry of entries) {
            const priority = parseVpkPriority(entry);
            if (priority !== null) {
                usedPriorities.add(priority);
            }
        }
    }

    // Also check disabled folder
    if (existsSync(disabledPath)) {
        const entries = readdirSync(disabledPath);
        for (const entry of entries) {
            const priority = parseVpkPriority(entry);
            if (priority !== null) {
                usedPriorities.add(priority);
            }
        }
    }

    return usedPriorities;
}

/**
 * Enable a mod by moving it from disabled to addons folder
 */
export function enableMod(deadlockPath: string, modId: string): Mod {
    const mods = scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    if (targetMod.enabled) {
        return targetMod;
    }

    const addonsPath = getAddonsPath(deadlockPath);
    const destPath = join(addonsPath, targetMod.fileName);

    renameSync(targetMod.path, destPath);

    return {
        ...targetMod,
        enabled: true,
        path: destPath,
    };
}

/**
 * Disable a mod by moving it to the disabled folder
 */
export function disableMod(deadlockPath: string, modId: string): Mod {
    const mods = scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    if (!targetMod.enabled) {
        return targetMod;
    }

    const disabledPath = getDisabledPath(deadlockPath);
    const destPath = join(disabledPath, targetMod.fileName);

    renameSync(targetMod.path, destPath);

    return {
        ...targetMod,
        enabled: false,
        path: destPath,
    };
}

/**
 * Delete a mod completely (including related VPK files)
 */
export function deleteMod(deadlockPath: string, modId: string): void {
    const mods = scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    // Delete the main file
    unlinkSync(targetMod.path);

    // Also remove related VPK files (pak##_000.vpk, pak##_001.vpk, etc.)
    const baseName = targetMod.fileName.replace(/_dir\.vpk$/, '');
    const parentDir = join(targetMod.path, '..');

    try {
        const siblings = readdirSync(parentDir);
        for (const sibling of siblings) {
            if (sibling.startsWith(baseName) && sibling.endsWith('.vpk')) {
                unlinkSync(join(parentDir, sibling));
            }
        }
    } catch {
        // Ignore errors when cleaning up related files
    }
}

/**
 * Set the priority of a mod by renaming it
 */
export function setModPriority(
    deadlockPath: string,
    modId: string,
    newPriority: number
): Mod {
    const mods = scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    const parentDir = join(targetMod.path, '..');
    const priorityStr = String(Math.min(99, newPriority)).padStart(2, '0');

    // Preserve the mod name by only replacing the priority prefix
    // e.g., pak05_cool_skin_dir.vpk -> pak10_cool_skin_dir.vpk
    const newFileName = targetMod.fileName.replace(/^pak\d{2}_/, `pak${priorityStr}_`);
    const destPath = join(parentDir, newFileName);

    // Check if destination already exists
    if (existsSync(destPath) && destPath !== targetMod.path) {
        throw new Error(`Priority ${newPriority} is already in use`);
    }

    renameSync(targetMod.path, destPath);

    return {
        ...targetMod,
        priority: newPriority,
        fileName: newFileName,
        path: destPath,
        id: generateModId(newFileName),
    };
}
