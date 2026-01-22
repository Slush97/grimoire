import { scanMods, Mod } from './mods';
import { parseVpkDirectory } from './vpk';

// Files to ignore when checking for conflicts (non-game metadata files)
const IGNORED_CONFLICT_FILES = new Set([
    'readme.txt',
    'readme.md',
    'license.txt',
    'license.md',
    'credits.txt',
    'changelog.txt',
    'info.txt',
]);

/**
 * Check if a file path should be ignored for conflict detection
 */
function shouldIgnoreFile(filePath: string): boolean {
    const normalizedPath = filePath.toLowerCase();
    const fileName = normalizedPath.split('/').pop() || normalizedPath;
    return IGNORED_CONFLICT_FILES.has(fileName);
}

export interface ModConflict {
    modA: string;      // mod ID
    modAName: string;  // mod display name
    modB: string;      // mod ID
    modBName: string;  // mod display name
    conflictType: 'priority' | 'file';
    details: string;
}

/**
 * Detect conflicts between installed mods
 * Two mods conflict if they have overlapping file paths.
 */
export async function detectConflicts(deadlockPath: string): Promise<ModConflict[]> {
    const mods = await scanMods(deadlockPath);
    const enabledMods = mods.filter(m => m.enabled);
    const conflicts: ModConflict[] = [];

    console.log(`[detectConflicts] Enabled mods: ${enabledMods.length}`);

    if (enabledMods.length < 2) {
        return [];
    }

    // Priority conflicts (same pak number)
    const priorityMap = new Map<number, Mod[]>();
    for (const mod of enabledMods) {
        const existing = priorityMap.get(mod.priority) || [];
        existing.push(mod);
        priorityMap.set(mod.priority, existing);
    }

    for (const [priority, modsWithPriority] of priorityMap) {
        if (modsWithPriority.length > 1) {
            for (let i = 0; i < modsWithPriority.length; i++) {
                for (let j = i + 1; j < modsWithPriority.length; j++) {
                    conflicts.push({
                        modA: modsWithPriority[i].id,
                        modAName: modsWithPriority[i].name,
                        modB: modsWithPriority[j].id,
                        modBName: modsWithPriority[j].name,
                        conflictType: 'priority',
                        details: `Both use pak${String(priority).padStart(2, '0')}`,
                    });
                }
            }
        }
    }

    // Parse VPK file lists
    const modFileLists = new Map<string, Set<string>>();
    for (const mod of enabledMods) {
        const files = parseVpkDirectory(mod.path);
        if (files && files.length > 0) {
            modFileLists.set(mod.id, new Set(files));
            console.log(`[detectConflicts] ${mod.fileName}: ${files.length} files`);
            // Log sample paths for debugging
            console.log(`[detectConflicts]   Sample paths: ${files.slice(0, 5).join(', ')}`);
        } else {
            console.log(`[detectConflicts] ${mod.fileName}: failed to parse or empty`);
        }
    }

    // Find file conflicts (overlapping files between mods)
    const modsWithFiles = enabledMods.filter(m => modFileLists.has(m.id));

    for (let i = 0; i < modsWithFiles.length; i++) {
        for (let j = i + 1; j < modsWithFiles.length; j++) {
            const modA = modsWithFiles[i];
            const modB = modsWithFiles[j];
            const filesA = modFileLists.get(modA.id)!;
            const filesB = modFileLists.get(modB.id)!;

            // Find overlapping files (excluding metadata files)
            const overlapping: string[] = [];
            for (const file of filesA) {
                if (filesB.has(file) && !shouldIgnoreFile(file)) {
                    overlapping.push(file);
                }
            }

            if (overlapping.length > 0) {
                // Skip if already reported as priority conflict
                const alreadyReported = conflicts.some(
                    c => (c.modA === modA.id && c.modB === modB.id) ||
                        (c.modA === modB.id && c.modB === modA.id)
                );

                if (!alreadyReported) {
                    // Log the actual conflicting files for debugging
                    console.log(`[detectConflicts] File conflict: ${modA.fileName} vs ${modB.fileName}`);
                    console.log(`[detectConflicts] Overlapping files (${overlapping.length}):`);
                    for (const file of overlapping.slice(0, 20)) { // Log first 20
                        console.log(`[detectConflicts]   - ${file}`);
                    }
                    if (overlapping.length > 20) {
                        console.log(`[detectConflicts]   ... and ${overlapping.length - 20} more`);
                    }

                    conflicts.push({
                        modA: modA.id,
                        modAName: modA.name,
                        modB: modB.id,
                        modBName: modB.name,
                        conflictType: 'file',
                        details: `${overlapping.length} shared file(s): ${overlapping.slice(0, 3).join(', ')}${overlapping.length > 3 ? '...' : ''}`,
                    });
                }
            }
        }
    }

    console.log(`[detectConflicts] Found ${conflicts.length} conflicts`);
    return conflicts;
}
