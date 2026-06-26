import { scanMods, type Mod } from './mods';
import { parseVpkDirectoriesAsync, type VpkParseStats } from './vpk';
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

// Exact paths of Source 2 compiler artifacts that any mod touching a given
// subsystem co-ships, regardless of what it actually changes. The panorama
// image compiler writes panorama/image_compiler.vdata_c (an atlas/manifest)
// into every mod that includes any panorama image, so two unrelated mods that
// each touched panorama collide on it even though the real assets they edit
// don't overlap (those are still detected on their own paths). Same class of
// false positive as the default fallback textures below; matched by full path
// so a legitimately-named file elsewhere isn't swept up.
const IGNORED_CONFLICT_PATHS = new Set([
    'panorama/image_compiler.vdata_c',
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
    if (IGNORED_CONFLICT_PATHS.has(normalizedPath)) return true;
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
    /** For `file` conflicts: every overlapping path still flagged for this pair
     *  (after subtracting any individually ignored files). Drives the per-file
     *  ignore UI. Undefined for `priority` conflicts. */
    files?: string[];
}

function normalizeIdentityPart(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The addon folder an enabled mod lives in, derived from its metaKey: the bare
 *  filename (no slash) means the base citadel/addons; `addonsN/<file>` means
 *  overflow folder N. Used to scope pakNN priority-collision grouping per folder. */
function folderOf(mod: Mod): string {
    const slash = mod.metaKey.indexOf('/');
    return slash === -1 ? 'addons' : mod.metaKey.slice(0, slash);
}

/** Message for a priority (same-slot) conflict. Two mods only reach here when
 *  they share a folder AND a pakNN, so naming the slot (and the overflow folder,
 *  when not base) is enough to tell the user which slot to change. */
function priorityConflictDetail(mod: Mod): string {
    const folder = folderOf(mod);
    const pak = `pak${String(mod.priority).padStart(2, '0')}`;
    return folder === 'addons' ? `Both use ${pak}` : `Both use ${folder}/${pak}`;
}

/** Header line for a file (overlapping-path) conflict. Caps the inline preview
 *  at three names; the full list rides along on ModConflict.files for the
 *  per-file ignore UI. */
function fileConflictDetail(files: string[]): string {
    return `${files.length} shared file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`;
}

export function modConflictIdentity(mod: Mod): string {
    const metadata = getModMetadata(mod.metaKey);
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
    details: string,
    files?: string[]
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
        files,
    };
}

/**
 * Detect conflicts between installed mods
 * Two mods conflict if they have overlapping file paths.
 */
export async function detectConflicts(deadlockPath: string): Promise<ModConflict[]> {
    // Track scan duration + cache hit rate so user-supplied diagnostic
    // reports tell us whether the conflict scan is actually the thing
    // freezing the main process on their machine. Without this we can
    // only infer from code review.
    const scanStart = Date.now();
    const vpkStats: VpkParseStats = { hits: 0, misses: 0 };

    const mods = await scanMods(deadlockPath);
    // The Locker cosmetics VPK and the Locker sound VPK deliberately override
    // the paths of the mods they pulled from (that's how a chosen card / sound
    // wins), so they would otherwise report a file conflict against every
    // source. Exclude them.
    const enabledMods = mods.filter(m => {
        const meta = getModMetadata(m.metaKey);
        return m.enabled && !meta?.lockerCosmetics && !meta?.lockerSounds;
    });
    const conflicts: ModConflict[] = [];

    if (enabledMods.length < 2) {
        console.log(`[detectConflicts] enabled=${enabledMods.length} took=${Date.now() - scanStart}ms (trivial)`);
        return [];
    }

    // Priority conflicts (same pak number). Track which pairs are already
    // reported so the later file-conflict pass skips them in O(1).
    const reportedPairs = new Set<string>();
    const markReported = (a: Mod, b: Mod) => reportedPairs.add(conflictPairKey(a.id, b.id));
    const wasReported = (a: Mod, b: Mod) => reportedPairs.has(conflictPairKey(a.id, b.id));

    // A pakNN load-order slot only collides WITHIN a single addon folder: base
    // citadel/addons/pak05 and an overflow citadel/addons1/pak05 are mounted via
    // separate SearchPaths, so they are NOT a real priority conflict (each folder
    // has its own pak01-pak99 namespace, Model A). Group by (folder, pakNN), not
    // raw pakNN. The folder comes from metaKey: bare filename (no slash) = base
    // addons, `addonsN/<file>` = overflow folder N.
    const priorityMap = new Map<string, Mod[]>();
    for (const mod of enabledMods) {
        const key = `${folderOf(mod)}#${mod.priority}`;
        const existing = priorityMap.get(key) || [];
        existing.push(mod);
        priorityMap.set(key, existing);
    }

    for (const modsWithPriority of priorityMap.values()) {
        if (modsWithPriority.length > 1) {
            for (let i = 0; i < modsWithPriority.length; i++) {
                for (let j = i + 1; j < modsWithPriority.length; j++) {
                    const a = modsWithPriority[i];
                    const b = modsWithPriority[j];
                    conflicts.push(createConflict(a, b, 'priority', priorityConflictDetail(a)));
                    markReported(a, b);
                }
            }
        }
    }

    // Parse VPK file lists. Cache misses are parsed concurrently across the
    // worker pool instead of sequentially on the main process, which is what
    // used to pin the event loop for hundreds of ms on a cold cache.
    const parsedVpks = await parseVpkDirectoriesAsync(
        enabledMods.map((mod) => mod.path),
        { stats: vpkStats }
    );
    const modFileLists = new Map<string, Set<string>>();
    for (const mod of enabledMods) {
        const files = parsedVpks.get(mod.path);
        if (files && files.length > 0) {
            modFileLists.set(mod.id, new Set(files));
        }
    }

    // Load settings once for both per-file (in-loop) and whole-pair (end)
    // filtering. Per-file ignores are keyed by the same stable identity pair
    // key as whole-pair ignores, so resolve each enabled mod's identity up
    // front and reuse it.
    const settings = loadSettings();
    const ignoredFilesByKey = new Map<string, Set<string>>();
    for (const [key, files] of Object.entries(settings.ignoredConflictFiles ?? {})) {
        if (Array.isArray(files) && files.length > 0) {
            ignoredFilesByKey.set(key, new Set(files));
        }
    }
    // Globally ignored paths: never count as a conflict for any pair (the
    // user-curated companion to the built-in IGNORED_CONFLICT_PATHS filter).
    const globalIgnored = new Set(settings.ignoredConflictFilesGlobal ?? []);
    const identityById = new Map<string, string>();
    for (const mod of enabledMods) {
        identityById.set(mod.id, modConflictIdentity(mod));
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

            // Find overlapping files (excluding metadata files and any path
            // the user has globally silenced)
            const overlapping: string[] = [];
            for (const file of filesA) {
                if (filesB.has(file) && !shouldIgnoreFile(file) && !globalIgnored.has(file)) {
                    overlapping.push(file);
                }
            }

            if (overlapping.length > 0) {
                // Subtract any individually ignored files for this pair. If
                // every overlapping file has been dismissed the pair is no
                // longer a conflict at all, so it drops out like a whole-pair
                // ignore.
                const ignoreKey = conflictPairKey(
                    identityById.get(modA.id)!,
                    identityById.get(modB.id)!
                );
                const ignoredForPair = ignoredFilesByKey.get(ignoreKey);
                const remaining = ignoredForPair
                    ? overlapping.filter((file) => !ignoredForPair.has(file))
                    : overlapping;

                if (remaining.length > 0) {
                    conflicts.push(createConflict(
                        modA,
                        modB,
                        'file',
                        fileConflictDetail(remaining),
                        remaining
                    ));
                    markReported(modA, modB);
                }
            }
        }
    }

    // Strip out any pairs the user has explicitly dismissed. We do this at
    // the end rather than inside the loops so the ignored list stays a clean
    // post-filter: easy to reason about and easy to disable later.
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

    console.log(
        `[detectConflicts] enabled=${enabledMods.length} ` +
        `pairs=${filtered.length} ` +
        `vpkCache=${vpkStats.hits}/${vpkStats.hits + vpkStats.misses} ` +
        `took=${Date.now() - scanStart}ms`
    );
    return filtered;
}
