import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { getGameinfoPath, getDisabledPath, getCitadelPath, getGrimoirePath, getOverflowFolderNames, getModScanRootPaths, hasDeadworksContentRoot, DEADWORKS_SEARCH_PATH } from './deadlock';
import { ensureReplayFolderLink } from './replayFolder';
import {
    buildSearchPathsBlock,
    findSearchPathsBlock,
    hasActivePath,
    hasLanguageSearchPaths,
    hasModSearchPaths,
    hasRequiredSearchPaths,
    insertSearchPaths,
} from './gameinfoSearchPaths';

export interface GameinfoStatus {
    configured: boolean;
    /** Why, as a code the renderer can word for users; `message` stays the
     *  technical detail. 'language-paths-missing' and 'boot-paths-missing'
     *  still load mods. */
    reason: 'ok' | 'not-found' | 'mods-not-loaded' | 'language-paths-missing' | 'boot-paths-missing' | 'unrepairable' | 'error';
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
            reason: 'not-found',
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
            // Once Deadworks content has been provisioned, its search path is
            // forced present too, so downloaded server content keeps mounting even
            // after a game update resets gameinfo.gi.
            const missingDeadworks =
                hasDeadworksContentRoot(deadlockPath) && !hasActivePath(block.body, DEADWORKS_SEARCH_PATH);
            const missing = [
                ...missingOverflow,
                ...(missingDeadworks ? ['deadworks_addons'] : []),
            ];
            if (missing.length === 0 && !hasModSearchPaths(block.body)) {
                return {
                    configured: false,
                    missing: false,
                    reason: 'boot-paths-missing',
                    message: 'Mod and Write search paths are missing from gameinfo.gi',
                    candidates: [],
                };
            }
            if (missing.length === 0 && !hasLanguageSearchPaths(block.body)) {
                return {
                    configured: false,
                    missing: false,
                    reason: 'language-paths-missing',
                    message: 'Language search paths are missing from gameinfo.gi',
                    candidates: [],
                };
            }
            if (missing.length === 0) {
                return {
                    configured: true,
                    missing: false,
                    reason: 'ok',
                    message: 'Addon search paths are configured correctly',
                    candidates: [],
                };
            }
            return {
                configured: false,
                missing: false,
                reason: 'mods-not-loaded',
                message: `Mod folders are missing from gameinfo.gi (${missing.join(', ')}). Use Fix Configuration to restore them.`,
                candidates: [],
            };
        }

        // A SearchPaths block exists but doesn't load citadel/addons: fixable in place.
        if (block) {
            return {
                configured: false,
                missing: false,
                reason: 'mods-not-loaded',
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
            reason: 'mods-not-loaded',
            message: 'gameinfo.gi has no usable SearchPaths section (it may have been altered by another mod manager). Use Fix Configuration to rebuild it.',
            candidates: findGameinfoCandidates(deadlockPath),
        };
    } catch (err) {
        return {
            configured: false,
            missing: false,
            reason: 'error',
            message: `Failed to read gameinfo.gi: ${err}`,
            candidates: [],
        };
    }
}

/**
 * Restore required mounts while preserving existing Valve and custom search paths.
 */
export function fixGameinfo(deadlockPath: string): GameinfoStatus {
    const gameinfoPath = getGameinfoPath(deadlockPath);

    if (!existsSync(gameinfoPath)) {
        return {
            configured: false,
            missing: true,
            reason: 'not-found',
            message: 'gameinfo.gi not found',
            candidates: findGameinfoCandidates(deadlockPath),
        };
    }

    // The modded search paths are what redirect replay downloads into the first
    // mod folder, so this repair owns the links that keep them decompressible
    // (startup heals them too; see runStartupRecovery in ipc/launch.ts). Runs
    // before the already-configured early return: an install can have correct
    // search paths and still be missing the link. Best-effort, like the backup.
    try {
        ensureReplayFolderLink(deadlockPath);
    } catch (err) {
        console.error('[system] Could not link the replays folder:', err);
    }

    try {
        const content = readFileSync(gameinfoPath, 'utf-8');
        const block = findSearchPathsBlock(content);

        // Include each provisioned mod root and restore stock mounts removed by
        // older Grimoire versions. Keep all other entries from the live file.
        const overflow = getOverflowFolderNames(deadlockPath);
        const includeDeadworks = hasDeadworksContentRoot(deadlockPath);
        const canonical = buildSearchPathsBlock(overflow, includeDeadworks, block?.body, content.includes('\r\n') ? '\r\n' : '\n');

        // Already correct: a real SearchPaths block with the required base paths,
        // every existing overflow folder's Game line, AND the deadworks path when
        // server content has been provisioned.
        if (
            block &&
            hasRequiredSearchPaths(block.body) &&
            hasLanguageSearchPaths(block.body) &&
            hasModSearchPaths(block.body) &&
            overflow.every((name) => hasActivePath(block.body, `citadel/${name}`)) &&
            (!includeDeadworks || hasActivePath(block.body, DEADWORKS_SEARCH_PATH))
        ) {
            return {
                configured: true,
                missing: false,
                reason: 'ok',
                message: 'Addon search paths were already configured',
                candidates: [],
            };
        }

        let next: string;
        if (block) {
            // Merge into the existing block without discarding language mounts
            // or unrelated third-party paths.
            next = content.slice(0, block.start) + canonical + content.slice(block.end);
        } else if (!/SearchPaths/.test(content)) {
            // Another tool stripped SearchPaths out entirely. Rebuild it inside the
            // FileSystem section so mods load again without a game reinstall.
            const rebuilt = insertSearchPaths(content, canonical);
            if (!rebuilt) {
                return {
                    configured: false,
                    missing: false,
                    reason: 'unrepairable',
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
                reason: 'unrepairable',
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
            reason: 'ok',
            message: 'Successfully configured addon search paths',
            candidates: [],
        };
    } catch (err) {
        return {
            configured: false,
            missing: false,
            reason: 'error',
            message: `Failed to fix gameinfo.gi: ${err}`,
            candidates: [],
        };
    }
}

/**
 * Ensure gameinfo.gi mounts the Deadworks content search path before a connect.
 *
 * Call this after the deadworks_addons/vpks folder exists. If the search-path
 * block is already correct this is a cheap no-op; otherwise it merges in the
 * missing paths, including the provisioned Deadworks content root. Returns the
 * resulting status so the connect flow can surface a "close Deadlock and retry"
 * message when the file is locked or unparseable.
 */
export function ensureDeadworksSearchPath(deadlockPath: string): GameinfoStatus {
    const status = getGameinfoStatus(deadlockPath);
    if (status.configured) return status;
    return fixGameinfo(deadlockPath);
}

/**
 * Cleanup addons folder - remove leftover archives
 */
export function cleanupAddons(deadlockPath: string): CleanupResult {
    const result: CleanupResult = {
        removedArchives: 0,
    };

    const disabledPath = getDisabledPath(deadlockPath);

    // Process every enabled user-mod root (priority, base addons, and overflow
    // addonsN) plus the shared .disabled parking lot, so leftover archives are
    // removed wherever a mod ended up.
    for (const folder of [...getModScanRootPaths(deadlockPath), disabledPath]) {
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
