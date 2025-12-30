import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Get platform-specific Steam library paths to search for Deadlock
 */
function getSteamLibraryPaths(): string[] {
    const paths: string[] = [];
    const home = homedir();

    if (process.platform === 'linux') {
        // Common Steam locations on Linux
        paths.push(join(home, '.steam/steam/steamapps/common'));
        paths.push(join(home, '.local/share/Steam/steamapps/common'));
        // Flatpak
        paths.push(join(home, '.var/app/com.valvesoftware.Steam/.steam/steam/steamapps/common'));
    } else if (process.platform === 'win32') {
        // Common Steam locations on Windows
        paths.push('C:\\Program Files (x86)\\Steam\\steamapps\\common');
        paths.push('C:\\Program Files\\Steam\\steamapps\\common');
        paths.push('D:\\Steam\\steamapps\\common');
        paths.push('D:\\SteamLibrary\\steamapps\\common');
    } else if (process.platform === 'darwin') {
        // macOS
        paths.push(join(home, 'Library/Application Support/Steam/steamapps/common'));
    }

    return paths;
}

/**
 * Check if a path is a valid Deadlock installation
 */
export function isValidDeadlockPath(path: string): boolean {
    const gameDir = join(path, 'game');
    const citadelDir = join(gameDir, 'citadel');
    return existsSync(gameDir) && existsSync(citadelDir);
}

/**
 * Auto-detect Deadlock installation path
 */
export function detectDeadlockPath(): string | null {
    const paths = getSteamLibraryPaths();
    console.log('[detectDeadlockPath] Searching paths:', paths);

    for (const libraryPath of paths) {
        const deadlockPath = join(libraryPath, 'Deadlock');
        console.log('[detectDeadlockPath] Checking:', deadlockPath);
        if (isValidDeadlockPath(deadlockPath)) {
            console.log('[detectDeadlockPath] FOUND:', deadlockPath);
            return deadlockPath;
        }
    }
    console.log('[detectDeadlockPath] Not found in any location');
    return null;
}

/**
 * Get the addons folder path, creating it if necessary
 */
export function getAddonsPath(deadlockPath: string): string {
    const addonsPath = join(deadlockPath, 'game', 'citadel', 'addons');

    if (!existsSync(addonsPath)) {
        mkdirSync(addonsPath, { recursive: true });
    }

    return addonsPath;
}

/**
 * Get the disabled mods folder path, creating it if necessary
 */
export function getDisabledPath(deadlockPath: string): string {
    const disabledPath = join(deadlockPath, 'game', 'citadel', 'addons', '.disabled');

    if (!existsSync(disabledPath)) {
        mkdirSync(disabledPath, { recursive: true });
    }

    return disabledPath;
}

/**
 * Get the gameinfo.gi file path
 */
export function getGameinfoPath(deadlockPath: string): string {
    return join(deadlockPath, 'game', 'citadel', 'gameinfo.gi');
}

/**
 * Get the citadel directory path
 */
export function getCitadelPath(deadlockPath: string): string {
    return join(deadlockPath, 'game', 'citadel');
}
