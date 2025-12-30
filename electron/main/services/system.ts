import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { join, extname, basename } from 'path';
import { getGameinfoPath, getAddonsPath, getDisabledPath } from './deadlock';

const SEARCH_PATH_ENTRY = '\t\t\tGame\t\t\t\tcitadel/addons';

export interface GameinfoStatus {
    configured: boolean;
    message: string;
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
            message: 'gameinfo.gi not found',
        };
    }

    try {
        const content = readFileSync(gameinfoPath, 'utf-8');

        if (content.includes('citadel/addons')) {
            return {
                configured: true,
                message: 'Addon search paths are configured correctly',
            };
        }

        return {
            configured: false,
            message: 'Addon search paths are missing from gameinfo.gi',
        };
    } catch (err) {
        return {
            configured: false,
            message: `Failed to read gameinfo.gi: ${err}`,
        };
    }
}

/**
 * Add the required SearchPaths entry to gameinfo.gi
 */
export function fixGameinfo(deadlockPath: string): GameinfoStatus {
    const gameinfoPath = getGameinfoPath(deadlockPath);

    if (!existsSync(gameinfoPath)) {
        return {
            configured: false,
            message: 'gameinfo.gi not found',
        };
    }

    try {
        let content = readFileSync(gameinfoPath, 'utf-8');

        // Check if already configured
        if (content.includes('citadel/addons')) {
            return {
                configured: true,
                message: 'Addon search paths were already configured',
            };
        }

        // Find the SearchPaths section and add our entry
        // Look for a line like: Game				citadel
        const citadelGameLine = /(\t*Game\s+citadel\s*\n)/;
        const match = content.match(citadelGameLine);

        if (match) {
            // Insert our entry after the citadel Game entry
            content = content.replace(
                citadelGameLine,
                `$1${SEARCH_PATH_ENTRY}\n`
            );

            writeFileSync(gameinfoPath, content, 'utf-8');

            return {
                configured: true,
                message: 'Successfully added addon search paths',
            };
        }

        // Fallback: try to find SearchPaths section
        const searchPathsStart = content.indexOf('SearchPaths');
        if (searchPathsStart === -1) {
            return {
                configured: false,
                message: 'Could not find SearchPaths section in gameinfo.gi',
            };
        }

        // Find the opening brace after SearchPaths
        const bracePos = content.indexOf('{', searchPathsStart);
        if (bracePos === -1) {
            return {
                configured: false,
                message: 'Malformed SearchPaths section',
            };
        }

        // Insert after the opening brace
        const insertPos = bracePos + 1;
        content =
            content.slice(0, insertPos) +
            '\n' +
            SEARCH_PATH_ENTRY +
            content.slice(insertPos);

        writeFileSync(gameinfoPath, content, 'utf-8');

        return {
            configured: true,
            message: 'Successfully added addon search paths',
        };
    } catch (err) {
        return {
            configured: false,
            message: `Failed to fix gameinfo.gi: ${err}`,
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
