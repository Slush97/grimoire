import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { join, extname } from 'path';
import { getGameinfoPath, getAddonsPath, getDisabledPath, getCitadelPath, getGrimoirePath } from './deadlock';

// The canonical SearchPaths block for Deadlock with mod support
const SEARCH_PATHS_BLOCK = `SearchPaths
	{
		Game				citadel/grimoire
		Game				citadel/addons
		Mod				citadel
		Write				citadel
		Game				citadel
		Write				core
		Mod				core
		Game				core
		AddonRoot			citadel_addons
		OfficialAddonRoot		citadel_community_addons
	}`;

export interface GameinfoStatus {
    configured: boolean;
    message: string;
    missing: boolean;
    candidates: string[];
}

// Scan citadel/ for files named like gameinfo.* (case-insensitive, excluding
// the canonical name itself). Surfaces backups another mod manager may have
// left behind (e.g. gameinfo.gi.bak, gameinfo_orig.gi).
function findGameinfoCandidates(deadlockPath: string): string[] {
    const citadelPath = getCitadelPath(deadlockPath);
    if (!existsSync(citadelPath)) return [];
    try {
        return readdirSync(citadelPath).filter((name) => {
            const lower = name.toLowerCase();
            return lower !== 'gameinfo.gi' && /^gameinfo[._]/.test(lower);
        });
    } catch {
        return [];
    }
}

// Suffix for the one-time backup Grimoire takes before its first edit to
// gameinfo.gi, so a bad patch is recoverable without verifying/reinstalling.
const GAMEINFO_BACKUP_SUFFIX = '.grimoire-bak';

// Locate the first SearchPaths { ... } block using balanced-brace scanning.
// The previous regex (/SearchPaths\s*\{[^}]*\}/) stops at the first '}', so any
// nested brace would truncate the match and corrupt the replacement. A foreign
// gameinfo.gi left by another mod manager could be matched wrong or missed
// entirely. Returns the block's bounds (relative to content) and inner body,
// or null when there's no parseable SearchPaths section.
function findSearchPathsBlock(
    content: string
): { start: number; end: number; body: string } | null {
    const keyword = /SearchPaths\s*\{/g;
    const match = keyword.exec(content);
    if (!match) return null;

    const braceStart = match.index + match[0].length - 1; // index of the '{'
    let depth = 0;
    for (let i = braceStart; i < content.length; i++) {
        const ch = content[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return {
                    start: match.index,
                    end: i + 1,
                    body: content.slice(braceStart + 1, i),
                };
            }
        }
    }
    return null; // unbalanced braces
}

// True when the SearchPaths body has an active (non-commented) entry pointing the
// engine at citadel/addons. Checking inside the block and ignoring // comments
// means a stray "citadel/addons" in a comment or elsewhere in the file no longer
// reads as configured: that false positive is what let a DLM-mangled gameinfo.gi
// look healthy while mods silently failed to load.
function hasActiveAddonPath(searchPathsBody: string): boolean {
    return searchPathsBody.split(/\r?\n/).some((line) => {
        const code = line.split('//')[0]; // drop any trailing line comment
        // Match citadel/addons only as a complete path token. A subfolder path
        // like citadel/addons/profile_default (which Deadlock Mod Manager writes
        // in its profile mode) must NOT count as configured: the engine would
        // search that subfolder, not the addons root where Grimoire drops its
        // VPKs. The bare substring check this replaces treated that prefix as
        // healthy, so Grimoire reported "configured" while no mods loaded.
        return /citadel[\\/]+addons(?![\\/\w])/i.test(code);
    });
}

// True when the SearchPaths body has an active entry pointing the engine at
// citadel/grimoire, the Grimoire-managed override folder (Locker cards + ability
// sounds). Listed first in the canonical block so it outranks every user mod;
// matched as a complete token, ignoring comments, same as the addons check.
function hasActiveGrimoirePath(searchPathsBody: string): boolean {
    return searchPathsBody.split(/\r?\n/).some((line) => {
        const code = line.split('//')[0];
        return /citadel[\\/]+grimoire(?![\\/\w])/i.test(code);
    });
}

// Both required search paths are present and active. The grimoire path is what
// makes applied Locker cards/sounds win, so an install missing it (e.g. a
// pre-grimoire 1.13.x user, or a game update that reset gameinfo.gi) reads as
// not-yet-configured and Fix Configuration rewrites the canonical block.
function hasRequiredSearchPaths(searchPathsBody: string): boolean {
    return hasActiveAddonPath(searchPathsBody) && hasActiveGrimoirePath(searchPathsBody);
}

// Preserve the first version we touch. Never overwrites an existing backup so the
// oldest (closest-to-original) copy is kept. Best-effort: a failed backup must
// not block the repair itself.
function backupGameinfoOnce(gameinfoPath: string, original: string): void {
    const backupPath = `${gameinfoPath}${GAMEINFO_BACKUP_SUFFIX}`;
    if (existsSync(backupPath)) return;
    try {
        writeFileSync(backupPath, original, 'utf-8');
    } catch {
        // Ignore: recovery backup is a nice-to-have, not a hard requirement.
    }
}

// Insert the canonical SearchPaths block just inside the FileSystem section, for
// the case where another tool stripped SearchPaths out entirely. Returns null if
// there's no FileSystem block to repair (don't guess at an unknown structure).
function insertSearchPaths(content: string): string | null {
    const match = /FileSystem\s*\{/.exec(content);
    if (!match) return null;
    const insertAt = match.index + match[0].length;
    return `${content.slice(0, insertAt)}\n\t\t${SEARCH_PATHS_BLOCK}${content.slice(insertAt)}`;
}

export interface CleanupResult {
    removedArchives: number;
    renamedMinaPresets: number;
    renamedMinaTextures: number;
    skippedMinaPresets: number;
    skippedMinaTextures: number;
}

/**
 * Check if gameinfo.gi has the required SearchPaths entry
 */
export function getGameinfoStatus(deadlockPath: string): GameinfoStatus {
    const gameinfoPath = getGameinfoPath(deadlockPath);

    if (!existsSync(gameinfoPath)) {
        return {
            configured: false,
            missing: true,
            message: 'gameinfo.gi not found',
            candidates: findGameinfoCandidates(deadlockPath),
        };
    }

    try {
        const content = readFileSync(gameinfoPath, 'utf-8');
        const block = findSearchPathsBlock(content);

        if (block && hasRequiredSearchPaths(block.body)) {
            return {
                configured: true,
                missing: false,
                message: 'Addon search paths are configured correctly',
                candidates: [],
            };
        }

        // A SearchPaths block exists but doesn't load citadel/addons: fixable in place.
        if (block) {
            return {
                configured: false,
                missing: false,
                message: 'Addon search paths are missing from gameinfo.gi',
                candidates: [],
            };
        }

        // No parseable SearchPaths block: the classic state another mod manager
        // leaves behind. Surface any leftover gameinfo.* it dropped, and note that
        // Fix Configuration can rebuild the section (see fixGameinfo).
        return {
            configured: false,
            missing: false,
            message: 'gameinfo.gi has no usable SearchPaths section (it may have been altered by another mod manager). Use Fix Configuration to rebuild it.',
            candidates: findGameinfoCandidates(deadlockPath),
        };
    } catch (err) {
        return {
            configured: false,
            missing: false,
            message: `Failed to read gameinfo.gi: ${err}`,
            candidates: [],
        };
    }
}

/**
 * Replace the SearchPaths section in gameinfo.gi with the canonical block
 * This ensures consistent mod loading regardless of the original file state
 */
export function fixGameinfo(deadlockPath: string): GameinfoStatus {
    const gameinfoPath = getGameinfoPath(deadlockPath);

    if (!existsSync(gameinfoPath)) {
        return {
            configured: false,
            missing: true,
            message: 'gameinfo.gi not found',
            candidates: findGameinfoCandidates(deadlockPath),
        };
    }

    try {
        const content = readFileSync(gameinfoPath, 'utf-8');
        const block = findSearchPathsBlock(content);

        // Already correct: an active addon path inside a real SearchPaths block.
        if (block && hasRequiredSearchPaths(block.body)) {
            return {
                configured: true,
                missing: false,
                message: 'Addon search paths were already configured',
                candidates: [],
            };
        }

        let next: string;
        if (block) {
            // Canonicalize: swap whatever SearchPaths block is present (including
            // one a different mod manager rewrote) for our known-good version.
            next = content.slice(0, block.start) + SEARCH_PATHS_BLOCK + content.slice(block.end);
        } else if (!/SearchPaths/.test(content)) {
            // Another tool stripped SearchPaths out entirely. Rebuild it inside the
            // FileSystem section so mods load again without a game reinstall.
            const rebuilt = insertSearchPaths(content);
            if (!rebuilt) {
                return {
                    configured: false,
                    missing: false,
                    message: 'Could not find a FileSystem section to repair in gameinfo.gi. In Steam, verify the integrity of game files, then try again.',
                    candidates: findGameinfoCandidates(deadlockPath),
                };
            }
            next = rebuilt;
        } else {
            // SearchPaths text is present but its braces do not parse (corrupted or
            // an unusual format). Don't guess; let the user restore a clean file.
            return {
                configured: false,
                missing: false,
                message: 'The SearchPaths section in gameinfo.gi could not be parsed. In Steam, verify the integrity of game files, then try again.',
                candidates: findGameinfoCandidates(deadlockPath),
            };
        }

        // Keep a one-time recovery copy before the first write.
        backupGameinfoOnce(gameinfoPath, content);
        writeFileSync(gameinfoPath, next, 'utf-8');

        // Ensure the grimoire override folder exists so its (now-active) search
        // path points at a real directory rather than a missing one.
        getGrimoirePath(deadlockPath);

        return {
            configured: true,
            missing: false,
            message: 'Successfully configured addon search paths',
            candidates: [],
        };
    } catch (err) {
        return {
            configured: false,
            missing: false,
            message: `Failed to fix gameinfo.gi: ${err}`,
            candidates: [],
        };
    }
}

/**
 * Cleanup addons folder - remove leftover archives and normalize Mina files
 */
export function cleanupAddons(deadlockPath: string): CleanupResult {
    const result: CleanupResult = {
        removedArchives: 0,
        renamedMinaPresets: 0,
        renamedMinaTextures: 0,
        skippedMinaPresets: 0,
        skippedMinaTextures: 0,
    };

    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);

    // Process both enabled and disabled folders
    for (const folder of [addonsPath, disabledPath]) {
        if (!existsSync(folder)) continue;

        const files = readdirSync(folder);

        for (const file of files) {
            const fullPath = join(folder, file);
            const ext = extname(file).toLowerCase();

            // Remove archive files
            if (ext === '.zip' || ext === '.7z' || ext === '.rar') {
                try {
                    unlinkSync(fullPath);
                    result.removedArchives++;
                } catch {
                    // Ignore errors
                }
                continue;
            }

            // Handle Mina preset files (.mina_preset)
            if (file.includes('.mina_preset')) {
                const newName = file.replace('.mina_preset', '_mina_preset');
                const newPath = join(folder, newName);

                if (existsSync(newPath)) {
                    result.skippedMinaPresets++;
                } else {
                    try {
                        renameSync(fullPath, newPath);
                        result.renamedMinaPresets++;
                    } catch {
                        result.skippedMinaPresets++;
                    }
                }
                continue;
            }

            // Handle Mina texture files (.mina_texture)
            if (file.includes('.mina_texture')) {
                // Normalize to pak21 format
                const newName = file.replace('.mina_texture', '_mina_texture');
                const newPath = join(folder, newName);

                if (existsSync(newPath)) {
                    result.skippedMinaTextures++;
                } else {
                    try {
                        renameSync(fullPath, newPath);
                        result.renamedMinaTextures++;
                    } catch {
                        result.skippedMinaTextures++;
                    }
                }
            }
        }
    }

    return result;
}
