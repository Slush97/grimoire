import { openSync, readSync, closeSync, existsSync, statSync } from 'fs';
import { heroForSoundCodename } from './heroSoundCodenames';

/**
 * VPK Header Structure (Version 2):
 * - Signature: 4 bytes (0x55AA1234)
 * - Version: 4 bytes
 * - TreeSize: 4 bytes (size of directory tree in bytes)
 *
 * After header comes the directory tree which contains:
 * - Extension strings (null-terminated)
 * - Path strings (null-terminated)
 * - Filename strings (null-terminated)
 *
 * We parse this to extract all file paths the VPK contains.
 */

const VPK_SIGNATURE = 0x55AA1234;

/**
 * Read a null-terminated string from a buffer at the given offset
 */
function readNullTerminatedString(buffer: Buffer, offset: number): { str: string; bytesRead: number } {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) {
        end++;
    }
    const str = buffer.slice(offset, end).toString('utf-8');
    return { str, bytesRead: end - offset + 1 }; // +1 for null terminator
}

// Cache parsed VPK file lists keyed by (path, mtime, size). Conflict
// detection re-parses every enabled VPK on each scan, which previously
// pinned the main process for hundreds of ms with 60+ mods. Invalidates
// automatically when the file changes on disk; entries for deleted/missing
// VPKs are dropped opportunistically.
interface VpkCacheEntry {
    mtimeMs: number;
    size: number;
    paths: string[] | null;
}
const vpkParseCache = new Map<string, VpkCacheEntry>();

export function invalidateVpkParseCache(vpkPath?: string): void {
    if (vpkPath) {
        vpkParseCache.delete(vpkPath);
    } else {
        vpkParseCache.clear();
    }
}

/**
 * Parsed VPK file list with on-disk-aware caching. Re-uses the previous
 * parse when (path, mtime, size) is unchanged; otherwise falls through to
 * `parseVpkDirectory` and stores the fresh result.
 */
export function parseVpkDirectoryCached(vpkPath: string): string[] | null {
    let stat;
    try {
        stat = statSync(vpkPath);
    } catch {
        vpkParseCache.delete(vpkPath);
        return null;
    }

    const cached = vpkParseCache.get(vpkPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.paths;
    }

    const paths = parseVpkDirectory(vpkPath);
    vpkParseCache.set(vpkPath, { mtimeMs: stat.mtimeMs, size: stat.size, paths });
    return paths;
}

/**
 * Parse VPK directory tree to extract all file paths
 * Returns null if the file is not a valid VPK or can't be parsed
 */
export function parseVpkDirectory(vpkPath: string): string[] | null {
    if (!existsSync(vpkPath)) {
        return null;
    }

    try {
        const fd = openSync(vpkPath, 'r');

        // Read basic header first (12 bytes) to check signature and version
        const headerBuffer = Buffer.alloc(12);
        readSync(fd, headerBuffer, 0, 12, 0);

        const signature = headerBuffer.readUInt32LE(0);
        if (signature !== VPK_SIGNATURE) {
            closeSync(fd);
            return null;
        }

        const version = headerBuffer.readUInt32LE(4);
        const treeSize = headerBuffer.readUInt32LE(8);

        // VPK v2 has an extended header (28 bytes total vs 12 for v1)
        // After the first 12 bytes, v2 has: FileDataSectionSize(4) + ArchiveMD5SectionSize(4) + OtherMD5SectionSize(4) + SignatureSectionSize(4)
        const headerSize = version === 2 ? 28 : 12;

        // Read the directory tree (starts after the full header)
        const treeBuffer = Buffer.alloc(treeSize);
        readSync(fd, treeBuffer, 0, treeSize, headerSize);
        closeSync(fd);

        const paths: string[] = [];
        let offset = 0;
        let properlyTerminated = false;

        // Parse directory tree
        // Structure: extension\0 (path\0 (filename\0 entry_data)*)* until empty extension
        while (offset < treeBuffer.length) {
            // Read extension
            const extResult = readNullTerminatedString(treeBuffer, offset);
            offset += extResult.bytesRead;

            if (extResult.str === '') {
                properlyTerminated = true;
                break; // End of tree (empty extension = proper termination)
            }

            const extension = extResult.str;
            let extensionProperlyTerminated = false;

            // Read paths for this extension
            while (offset < treeBuffer.length) {
                const pathResult = readNullTerminatedString(treeBuffer, offset);
                offset += pathResult.bytesRead;

                if (pathResult.str === '') {
                    extensionProperlyTerminated = true;
                    break; // End of paths for this extension
                }

                // Space means root directory in VPK format
                const dirPath = pathResult.str === ' ' ? '' : pathResult.str;
                let pathProperlyTerminated = false;

                // Read filenames for this path
                while (offset < treeBuffer.length) {
                    const nameResult = readNullTerminatedString(treeBuffer, offset);
                    offset += nameResult.bytesRead;

                    if (nameResult.str === '') {
                        pathProperlyTerminated = true;
                        break; // End of filenames for this path
                    }

                    const filename = nameResult.str;

                    // Build full path
                    const fullPath = dirPath
                        ? `${dirPath}/${filename}.${extension}`
                        : `${filename}.${extension}`;

                    paths.push(fullPath);

                    // Skip the entry data (18 bytes for version 2)
                    // CRC (4) + PreloadBytes (2) + ArchiveIndex (2) + EntryOffset (4) + EntryLength (4) + Terminator (2)
                    offset += 18;

                    // Skip preload data if any
                    // PreloadBytes is at offset 4 in the entry (after CRC), so offset - 14 after skipping 18
                    if (offset - 14 >= 0 && offset - 14 < treeBuffer.length - 1) {
                        const preloadBytes = treeBuffer.readUInt16LE(offset - 14);
                        offset += preloadBytes;
                    }
                }

                // Warn if filename loop exited due to buffer exhaustion instead of proper termination
                if (!pathProperlyTerminated) {
                    console.warn(`[parseVpkDirectory] Warning: Filename section for path "${dirPath}" (ext: ${extension}) did not terminate properly - buffer exhausted at offset ${offset}/${treeBuffer.length}`);
                }
            }

            // Warn if path loop exited due to buffer exhaustion instead of proper termination
            if (!extensionProperlyTerminated) {
                console.warn(`[parseVpkDirectory] Warning: Path section for extension "${extension}" did not terminate properly - buffer exhausted at offset ${offset}/${treeBuffer.length}`);
            }
        }

        // Validate tree was properly terminated
        if (!properlyTerminated) {
            console.warn(`[parseVpkDirectory] ${vpkPath}: tree did not terminate properly (offset ${offset}/${treeBuffer.length}). Some files may be missing from conflict detection.`);
        }

        // Check if there's unexpected data after tree termination
        if (properlyTerminated && offset < treeBuffer.length) {
            const remainingBytes = treeBuffer.length - offset;
            // Small amount of padding is acceptable, but large amounts suggest parsing error
            if (remainingBytes > 16) {
                console.warn(`[parseVpkDirectory] ${vpkPath}: ${remainingBytes} bytes remaining after tree termination.`);
            }
        }

        return paths;
    } catch (error) {
        console.error(`[parseVpkDirectory] Error parsing ${vpkPath}:`, error);
        return null;
    }
}

/**
 * Extract hero name from a VPK file path if it's a hero-related file
 * Returns null if not a hero file
 */
export function extractHeroFromPath(filePath: string): string | null {
    // Hero path patterns for Source 2 games (including Deadlock which uses heroes_wip)
    const patterns = [
        // Standard Source 2 patterns
        /models\/heroes\/([^/]+)\//i,
        /materials\/models\/heroes\/([^/]+)\//i,
        /particles\/heroes\/([^/]+)\//i,
        /sounds\/heroes\/([^/]+)\//i,
        /scripts\/heroes\/([^/]+)/i,
        // Deadlock-specific patterns (uses heroes_wip instead of heroes)
        /models\/heroes_wip\/([^/]+)\//i,
        /materials\/models\/heroes_wip\/([^/]+)\//i,
        /materials\/heroes_wip\/([^/]+)\//i,
        /particles\/heroes_wip\/([^/]+)\//i,
        /sounds\/heroes_wip\/([^/]+)\//i,
        /scripts\/heroes_wip\/([^/]+)/i,
    ];

    for (const pattern of patterns) {
        const match = filePath.match(pattern);
        if (match) {
            return match[1].toLowerCase();
        }
    }

    return null;
}

/**
 * Sound mod path patterns. Sound mods don't live under `sounds/heroes/`
 * the way skin VPKs do: they live under `sounds/abilities/<codename>/aN_X/`
 * or, more rarely, under `sounds/heroes/<codename>/`. The codename is
 * Deadlock's sound-path namespace (e.g. `ghost` for Lady Geist, `hornet`
 * for Vindicta), translated via HERO_SOUND_CODENAMES below.
 *
 * `soundevents/` files (e.g. `soundevents/citadel/hero_ghost.vsndevts_c`)
 * are also a strong signal but live outside `sounds/`. We match those too.
 */
const SOUND_HERO_PATTERNS: RegExp[] = [
    /(?:^|\/)sounds\/abilities\/([a-z0-9_]+)\//i,
    /(?:^|\/)sounds\/heroes\/([a-z0-9_]+)\//i,
    /(?:^|\/)sounds\/[^/]+\/hero_([a-z0-9_]+)\//i,
    // `soundevents/citadel/hero_<codename>.vsndevts_c` (hero_ prefix on file).
    /(?:^|\/)soundevents\/[^/]*\/hero_([a-z0-9_]+)\.vsndevts/i,
    // `soundevents/hero/<codename>.vsndevts_c` (hero is the folder, file is
    // just the codename). Observed on pak04 "We don't talk Animal" which
    // ships soundevents/hero/werewolf.vsndevts_c.
    /(?:^|\/)soundevents\/hero\/([a-z0-9_]+)\.vsndevts/i,
];

/**
 * Inspect a VPK's path list for sound-mod payloads and return the display
 * name of the hero they target. Returns null when no recognized hero
 * codename appears, or when the VPK touches more than one hero (we'd
 * rather leave that case to manual tagging than pick the wrong one).
 */
export function inferHeroFromVpkPaths(paths: string[]): string | null {
    const heroes = new Set<string>();
    for (const filePath of paths) {
        for (const pattern of SOUND_HERO_PATTERNS) {
            const match = filePath.match(pattern);
            if (!match) continue;
            const hero = heroForSoundCodename(match[1]);
            if (hero) {
                heroes.add(hero);
                break;
            }
        }
        // Bail early once we've already seen a conflict: no point scanning
        // the rest of a large VPK if the answer is already "ambiguous."
        if (heroes.size > 1) return null;
    }
    return heroes.size === 1 ? [...heroes][0] : null;
}

/**
 * Convenience wrapper: parse the VPK directory and run the path-based
 * inference. Returns null when the VPK can't be parsed or no hero matches.
 */
export function inferHeroFromVpk(vpkPath: string): string | null {
    const paths = parseVpkDirectory(vpkPath);
    if (!paths || paths.length === 0) return null;
    return inferHeroFromVpkPaths(paths);
}

/**
 * Best-effort label derived from a VPK's file tree (VPKs have no authored
 * title). Returns null when nothing distinctive matches — caller should
 * fall back to the filename rather than guess.
 */
export function getVpkLabel(vpkPath: string): string | null {
    const paths = parseVpkDirectory(vpkPath);
    if (!paths || paths.length === 0) return null;

    const titleCase = (s: string) =>
        s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

    const heroes = new Set<string>();
    for (const p of paths) {
        const hero = extractHeroFromPath(p);
        if (hero) heroes.add(hero);
    }
    if (heroes.size > 0 && heroes.size <= 3) {
        return [...heroes].map(titleCase).join(', ');
    }

    const extractUnique = (pattern: RegExp): string[] => {
        const set = new Set<string>();
        for (const p of paths) {
            const m = p.match(pattern);
            if (m?.[1]) set.add(m[1].toLowerCase());
        }
        return [...set];
    };

    const skyboxes = extractUnique(/materials\/skybox\/([^/]+)\//i);
    if (skyboxes.length === 1) return `${titleCase(skyboxes[0])} skybox`;
    if (skyboxes.length > 1 && skyboxes.length <= 3) {
        return `${skyboxes.map(titleCase).join(', ')} skyboxes`;
    }

    const maps = extractUnique(/^maps\/([^/]+?)(?:\.|\/)/i);
    if (maps.length === 1) return `${titleCase(maps[0])} map`;

    const uiThemes = extractUnique(/panorama\/(?:images|layout|styles)\/(?:hud|themes?)\/([^/]+)\//i);
    if (uiThemes.length === 1) return `${titleCase(uiThemes[0])} UI`;

    return null;
}

/** Batch wrapper around getVpkLabel; omits entries with no label. */
export function getVpkLabels(vpkPaths: Array<{ fileName: string; absPath: string }>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { fileName, absPath } of vpkPaths) {
        try {
            const label = getVpkLabel(absPath);
            if (label) out[fileName] = label;
        } catch {
            // best-effort; missing label is fine
        }
    }
    return out;
}

/**
 * Get a summary of what a VPK modifies
 */
export function getVpkContentSummary(vpkPath: string): {
    heroes: Set<string>;
    fileCount: number;
    samplePaths: string[];
} {
    const paths = parseVpkDirectory(vpkPath);

    if (!paths) {
        return { heroes: new Set(), fileCount: 0, samplePaths: [] };
    }

    const heroes = new Set<string>();

    for (const path of paths) {
        const hero = extractHeroFromPath(path);
        if (hero) {
            heroes.add(hero);
        }
    }

    return {
        heroes,
        fileCount: paths.length,
        samplePaths: paths.slice(0, 5), // First 5 paths as sample
    };
}
