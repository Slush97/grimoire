import { scanMods, Mod } from './mods';
import { parseVpkDirectoryCached } from './vpk';
import { loadSettings } from './settings';
import { getModMetadata } from './metadata';

/**
 * Build a stable order-independent key for a pair of mod ids or identities.
 * Sorts the two values so detection order doesn't matter when checking the ignored list.
 */
export function conflictPairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
}

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

// Path prefixes for files the VPK packer commonly bundles even when the mod
// doesn't really touch them. Two mods both shipping a copy of the engine's
// default fallback textures isn't a real conflict between them — it's just
// the packer dragging in shared dependencies. Filtering these prevents false
// positives like "Graves Shirt vs Ghost Bride Vindicta" caused entirely by
// materials/default/default_*_tga_*.vtex_c overlaps.
const IGNORED_CONFLICT_PREFIXES = [
    'materials/default/default_',
];

/**
 * Check if a file path should be ignored for conflict detection
 */
function shouldIgnoreFile(filePath: string): boolean {
    const normalizedPath = filePath.toLowerCase();
    const fileName = normalizedPath.split('/').pop() || normalizedPath;
    if (IGNORED_CONFLICT_FILES.has(fileName)) return true;
    for (const prefix of IGNORED_CONFLICT_PREFIXES) {
        if (normalizedPath.startsWith(prefix)) return true;
    }
    return false;
}

export interface ModConflict {
    modA: string;      // mod ID
    modAName: string;  // mod display name
    modB: string;      // mod ID
    modBName: string;  // mod display name
    modAIdentity: string; // stable ignore identity
    modBIdentity: string; // stable ignore identity
    ignoreKey: string;    // stable sorted pair key
    conflictType: 'priority' | 'file';
    details: string;
}

function normalizeIdentityPart(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function modConflictIdentity(mod: Mod): string {
    const metadata = getModMetadata(mod.fileName);
    if (typeof metadata?.gameBananaId === 'number' && metadata.gameBananaId > 0) {
        if (typeof metadata.gameBananaFileId === 'number' && metadata.gameBananaFileId > 0) {
            return `gb:${metadata.gameBananaId}:file:${metadata.gameBananaFileId}`;
        }
        if (metadata.sourceFileName) {
            return `gb:${metadata.gameBananaId}:source:${normalizeIdentityPart(metadata.sourceFileName)}`;
        }
        return `gb:${metadata.gameBananaId}:mod`;
    }

    const installedStamp = Number.isFinite(Date.parse(mod.installedAt))
        ? String(Date.parse(mod.installedAt))
        : normalizeIdentityPart(mod.installedAt);
    return `local:${mod.size}:${installedStamp}`;
}

export function migrateIgnoredConflictKeysForMods(keys: string[], mods: Mod[]): string[] {
    const idToIdentity = new Map<string, string>();
    for (const mod of mods) {
        idToIdentity.set(mod.id, modConflictIdentity(mod));
    }

    const migrated = keys.map((key) => {
        const parts = key.split('::');
        if (parts.length !== 2) return key;

        const modAIdentity = idToIdentity.get(parts[0]);
        const modBIdentity = idToIdentity.get(parts[1]);
        if (!modAIdentity || !modBIdentity) return key;

        return conflictPairKey(modAIdentity, modBIdentity);
    });

    return Array.from(new Set(migrated));
}

function createConflict(
    modA: Mod,
    modB: Mod,
    conflictType: ModConflict['conflictType'],
    details: string
): ModConflict {
    const modAIdentity = modConflictIdentity(modA);
    const modBIdentity = modConflictIdentity(modB);
    return {
        modA: modA.id,
        modAName: modA.name,
        modB: modB.id,
        modBName: modB.name,
        modAIdentity,
        modBIdentity,
        ignoreKey: conflictPairKey(modAIdentity, modBIdentity),
        conflictType,
        details,
    };
}

/**
 * Detect conflicts between installed mods
 * Two mods conflict if they have overlapping file paths.
 */
export async function detectConflicts(deadlockPath: string): Promise<ModConflict[]> {
    const mods = await scanMods(deadlockPath);
    const enabledMods = mods.filter(m => m.enabled);
    const conflicts: ModConflict[] = [];

    if (enabledMods.length < 2) {
        return [];
    }

    // Priority conflicts (same pak number). Track which pairs are already
    // reported so the later file-conflict pass skips them in O(1).
    const reportedPairs = new Set<string>();
    const markReported = (a: Mod, b: Mod) => reportedPairs.add(conflictPairKey(a.id, b.id));
    const wasReported = (a: Mod, b: Mod) => reportedPairs.has(conflictPairKey(a.id, b.id));

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
                    const a = modsWithPriority[i];
                    const b = modsWithPriority[j];
                    conflicts.push(createConflict(
                        a,
                        b,
                        'priority',
                        `Both use pak${String(priority).padStart(2, '0')}`
                    ));
                    markReported(a, b);
                }
            }
        }
    }

    // Parse VPK file lists
    const modFileLists = new Map<string, Set<string>>();
    for (const mod of enabledMods) {
        const files = parseVpkDirectoryCached(mod.path);
        if (files && files.length > 0) {
            modFileLists.set(mod.id, new Set(files));
        }
    }

    // Find file conflicts (overlapping files between mods)
    const modsWithFiles = enabledMods.filter(m => modFileLists.has(m.id));

    for (let i = 0; i < modsWithFiles.length; i++) {
        for (let j = i + 1; j < modsWithFiles.length; j++) {
            const modA = modsWithFiles[i];
            const modB = modsWithFiles[j];
            if (wasReported(modA, modB)) continue;

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
                conflicts.push(createConflict(
                    modA,
                    modB,
                    'file',
                    `${overlapping.length} shared file(s): ${overlapping.slice(0, 3).join(', ')}${overlapping.length > 3 ? '...' : ''}`
                ));
                markReported(modA, modB);
            }
        }
    }

    // Strip out any pairs the user has explicitly dismissed. We do this at
    // the end rather than inside the loops so the ignored list stays a clean
    // post-filter — easy to reason about and easy to disable later.
    const settings = loadSettings();
    if (settings.ignoreConflictsByDefault) {
        return [];
    }
    const ignored = new Set(settings.ignoredConflicts ?? []);
    const filtered = ignored.size === 0
        ? conflicts
        : conflicts.filter((c) =>
            !ignored.has(c.ignoreKey) &&
            !ignored.has(conflictPairKey(c.modA, c.modB))
        );

    return filtered;
}
