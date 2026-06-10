import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { getGameinfoPath, getDisabledPath, getCitadelPath, getGrimoirePath, getOverflowFolderNames, getAddonFolderPaths } from './deadlock';

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

// The canonical block with one extra `Game citadel/addonsN` line per overflow
// folder, inserted right after the base citadel/addons line and reusing its
// indentation. Per Model A precedence (earlier line wins), base addons outranks
// addons1 outranks addons2, etc. With no overflow folders this is byte-identical
// to SEARCH_PATHS_BLOCK, so existing installs are unaffected.
function buildSearchPathsBlock(overflowFolderNames: string[]): string {
    if (overflowFolderNames.length === 0) return SEARCH_PATHS_BLOCK;
    return SEARCH_PATHS_BLOCK.replace(
        /^([^\S\n]*Game[^\S\n]+)citadel\/addons[^\S\n]*$/m,
        (line, prefix: string) =>
            [line, ...overflowFolderNames.map((name) => `${prefix}citadel/${name}`)].join('\n')
    );
}

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
// engine at the given citadel-relative folder. Matched as a COMPLETE path token,
// ignoring // comments, so: a stray path in a comment doesn't read as configured
// (the false positive that let a DLM-mangled gameinfo.gi look healthy); a
// subfolder like citadel/addons/profile_default (Deadlock Mod Manager's profile
// mode) does NOT satisfy citadel/addons; and citadel/addons does NOT satisfy a
// query for citadel/addons1 (or vice versa).
function hasActivePath(searchPathsBody: string, relPath: string): boolean {
    const pattern = relPath.replace(/[/\\]/g, '[\\\\/]+');
    const re = new RegExp(`${pattern}(?![\\\\/\\w])`, 'i');
    return searchPathsBody.split(/\r?\n/).some((line) => re.test(line.split('//')[0]));
}

function hasActiveAddonPath(searchPathsBody: string): boolean {
    return hasActivePath(searchPathsBody, 'citadel/addons');
}

// citadel/grimoire is the Grimoire-managed override folder (Locker cards +
// ability sounds), listed first in the canonical block so it outranks every mod.
function hasActiveGrimoirePath(searchPathsBody: string): boolean {
    return hasActivePath(searchPathsBody, 'citadel/grimoire');
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
function insertSearchPaths(content: string, block: string): string | null {
    const match = /FileSystem\s*\{/.exec(content);
    if (!match) return null;
    const insertAt = match.index + match[0].length;
    return `${content.slice(0, insertAt)}\n\t\t${block}${content.slice(insertAt)}`;
}

// CleanupResult is single-sourced in src/types/electron.ts; re-exported
// because ipc/system.ts imports it from this service.
import type { CleanupResult } from '../../../src/types/electron';
export type { CleanupResult };

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
            // Required base paths are present. Also require a Game line for every
            // overflow folder that exists on disk: a >99 user whose gameinfo.gi
            // lost its overflow paths (a game update reset the file, or an old
            // build's fixGameinfo dropped them) would otherwise read as configured
            // while those mods silently stop loading. Vacuously true - and a no-op
            // - for the common install with no overflow folders, so non-overflow
            // users are never re-flagged.
            const missingOverflow = getOverflowFolderNames(deadlockPath).filter(
                (name) => !hasActivePath(block.body, `citadel/${name}`)
            );
            if (missingOverflow.length === 0) {
                return {
                    configured: true,
                    missing: false,
                    message: 'Addon search paths are configured correctly',
                    candidates: [],
                };
            }
            return {
                configured: false,
                missing: false,
                message: `Overflow mod folders are missing from gameinfo.gi (${missingOverflow.join(', ')}). Use Fix Configuration to restore them.`,
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

        // The canonical block includes a Game line for every overflow folder that
        // currently exists on disk, so a user-triggered repair restores them too.
        const overflow = getOverflowFolderNames(deadlockPath);
        const canonical = buildSearchPathsBlock(overflow);

        // Already correct: a real SearchPaths block with the required base paths
        // AND every existing overflow folder's Game line present.
        if (
            block &&
            hasRequiredSearchPaths(block.body) &&
            overflow.every((name) => hasActivePath(block.body, `citadel/${name}`))
        ) {
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
            next = content.slice(0, block.start) + canonical + content.slice(block.end);
        } else if (!/SearchPaths/.test(content)) {
            // Another tool stripped SearchPaths out entirely. Rebuild it inside the
            // FileSystem section so mods load again without a game reinstall.
            const rebuilt = insertSearchPaths(content, canonical);
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
 * Cleanup addons folder - remove leftover archives
 */
export function cleanupAddons(deadlockPath: string): CleanupResult {
    const result: CleanupResult = {
        removedArchives: 0,
    };

    const disabledPath = getDisabledPath(deadlockPath);

    // Process every enabled addon folder (base citadel/addons plus any overflow
    // addonsN) and the shared .disabled parking lot, so leftover archives are
    // removed wherever a mod ended up.
    for (const folder of [...getAddonFolderPaths(deadlockPath), disabledPath]) {
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
            }
        }
    }

    return result;
}
