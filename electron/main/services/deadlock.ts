import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

const DEADLOCK_APP_ID = '1422450';

/**
 * Steam install locations to probe (the directory that contains steamapps/),
 * in priority order. On Windows we ask the registry first so users with
 * Steam installed off the C: default are handled correctly.
 */
function getSteamInstallPaths(): string[] {
    const home = homedir();

    if (process.platform === 'linux') {
        return [
            join(home, '.steam/steam'),
            join(home, '.local/share/Steam'),
            join(home, '.var/app/com.valvesoftware.Steam/.steam/steam'),
        ];
    }

    if (process.platform === 'darwin') {
        return [join(home, 'Library/Application Support/Steam')];
    }

    if (process.platform === 'win32') {
        const paths: string[] = [];
        const push = (p: string | null) => {
            if (!p) return;
            const norm = p.replace(/\//g, '\\').replace(/\\+$/, '');
            if (!paths.some((existing) => existing.toLowerCase() === norm.toLowerCase())) {
                paths.push(norm);
            }
        };
        push(queryWindowsRegistry('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
        push(queryWindowsRegistry('HKCU\\SOFTWARE\\Valve\\Steam', 'SteamPath'));
        push('C:\\Program Files (x86)\\Steam');
        push('C:\\Program Files\\Steam');
        return paths;
    }

    return [];
}

function queryWindowsRegistry(key: string, value: string): string | null {
    try {
        const stdout = execFileSync('reg', ['query', key, '/v', value], {
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000,
        }).toString();
        const match = stdout.match(/REG_SZ\s+(.+?)\s*$/m);
        return match ? match[1].trim() : null;
    } catch {
        return null;
    }
}

/**
 * Read every "path" entry from a Steam libraryfolders.vdf so we discover
 * every Steam library on the machine, not just the default install dir.
 */
function readSteamLibraries(steamInstallPath: string): string[] {
    const vdfPath = join(steamInstallPath, 'steamapps', 'libraryfolders.vdf');
    if (!existsSync(vdfPath)) return [];
    try {
        const content = readFileSync(vdfPath, 'utf-8');
        const libraries: string[] = [];
        const re = /"path"\s+"([^"]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
            // VDF escapes backslashes; "C:\\SteamLibrary" -> "C:\SteamLibrary"
            libraries.push(match[1].replace(/\\\\/g, '\\'));
        }
        return libraries;
    } catch {
        return [];
    }
}

/**
 * Strict check: gameinfo.gi is present. Used by auto-detect so we only
 * claim to have "found" Deadlock when the install is actually usable.
 * Stale empty game/citadel/ folders can survive a move-library or partial
 * uninstall and would otherwise masquerade as a real install.
 */
export function isValidDeadlockPath(path: string): boolean {
    return existsSync(join(path, 'game', 'citadel', 'gameinfo.gi'));
}

/**
 * Loose check: the folder layout looks like a Deadlock install, even if
 * gameinfo.gi is missing. Used by the manual path picker so a user whose
 * gameinfo.gi was removed (antivirus, another mod manager, partial
 * verify) can still configure Grimoire and reach the recovery UI in
 * Settings.
 */
export function looksLikeDeadlockPath(path: string): boolean {
    return existsSync(join(path, 'game', 'citadel'));
}

/**
 * Auto-detect Deadlock by walking every Steam library declared in
 * libraryfolders.vdf. Libraries whose appmanifest_<APPID>.acf claims
 * Deadlock are preferred, as that is Steam's authoritative record.
 */
export function detectDeadlockPath(): string | null {
    const steamInstalls = getSteamInstallPaths();
    const visited = new Set<string>();
    const fallback: string[] = [];

    console.log('[detectDeadlockPath] Steam installs:', steamInstalls);

    for (const steamPath of steamInstalls) {
        if (!existsSync(steamPath)) continue;
        const libraries = readSteamLibraries(steamPath);
        // Steam's own install dir is implicitly a library, even when the
        // VDF is missing or doesn't list it.
        if (!libraries.some((lib) => lib.toLowerCase() === steamPath.toLowerCase())) {
            libraries.unshift(steamPath);
        }
        for (const lib of libraries) {
            const key = lib.toLowerCase();
            if (visited.has(key)) continue;
            visited.add(key);

            const candidate = join(lib, 'steamapps', 'common', 'Deadlock');
            const manifest = join(lib, 'steamapps', `appmanifest_${DEADLOCK_APP_ID}.acf`);
            if (existsSync(manifest) && isValidDeadlockPath(candidate)) {
                console.log('[detectDeadlockPath] FOUND via manifest:', candidate);
                return candidate;
            }
            fallback.push(candidate);
        }
    }

    // No library's appmanifest claims Deadlock; fall back to whichever
    // candidate directory holds a valid install. Catches manually-copied
    // installs that Steam doesn't know about.
    for (const candidate of fallback) {
        if (isValidDeadlockPath(candidate)) {
            console.log('[detectDeadlockPath] FOUND via fallback scan:', candidate);
            return candidate;
        }
    }

    console.log('[detectDeadlockPath] Not found in any library');
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
