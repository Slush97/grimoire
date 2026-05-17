import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { join, extname } from 'path';
import { getGameinfoPath, getAddonsPath, getDisabledPath, getCitadelPath } from './deadlock';

// The canonical SearchPaths block for Deadlock with mod support
const SEARCH_PATHS_BLOCK = `SearchPaths
	{
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

        if (content.includes('citadel/addons')) {
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
            message: 'Addon search paths are missing from gameinfo.gi',
            candidates: [],
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
        let content = readFileSync(gameinfoPath, 'utf-8');

        // Check if already configured
        if (content.includes('citadel/addons')) {
            return {
                configured: true,
                missing: false,
                message: 'Addon search paths were already configured',
                candidates: [],
            };
        }

        // Find the SearchPaths section using regex to match the entire block
        // Matches: SearchPaths followed by whitespace, {, any content, and closing }
        const searchPathsRegex = /SearchPaths\s*\{[^}]*\}/s;

        if (!searchPathsRegex.test(content)) {
            return {
                configured: false,
                missing: false,
                message: 'Could not find SearchPaths section in gameinfo.gi',
                candidates: [],
            };
        }

        // Replace the entire SearchPaths block with our canonical version
        content = content.replace(searchPathsRegex, SEARCH_PATHS_BLOCK);

        writeFileSync(gameinfoPath, content, 'utf-8');

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
