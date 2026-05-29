import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
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
 * Get the Grimoire-managed addon folder path, creating it if necessary.
 *
 * This is a SECOND addon search path (sibling of citadel/addons), listed FIRST
 * in gameinfo.gi's SearchPaths so it outranks every user mod. It holds only the
 * Locker-managed override VPKs (hero cards + ability sounds), keeping them off
 * the user's 99-slot citadel/addons budget while still winning every collision.
 */
export function getGrimoirePath(deadlockPath: string): string {
    const grimoirePath = join(deadlockPath, 'game', 'citadel', 'grimoire');

    if (!existsSync(grimoirePath)) {
        mkdirSync(grimoirePath, { recursive: true });
    }

    return grimoirePath;
}

/**
 * Match an overflow addons folder name: addons1, addons2, ... (NOT the base
 * "addons", which has no numeric suffix). Overflow folders hold mods that spill
 * past the 99-slot pakNN budget of the base citadel/addons folder; each carries
 * its own pak01-pak99 namespace and its own Game search path in gameinfo.gi.
 */
const OVERFLOW_FOLDER_RE = /^addons(\d+)$/i;

/**
 * Maximum number of addon root folders (base citadel/addons plus overflow
 * addons1..addons9). Each holds a pak01-pak99 namespace, so 10 folders gives a
 * 990-mod enabled ceiling. Bump this to raise the cap.
 */
export const MAX_ADDON_FOLDERS = 10;

/**
 * Ordered list of addon root folders the engine searches, base first, then
 * overflow folders (addons1, addons2, ...) in numeric order. Only folders that
 * exist on disk are returned; the base citadel/addons is always present (created
 * if missing). Each entry is an absolute path.
 */
export function getAddonFolderPaths(deadlockPath: string): string[] {
    const citadelPath = getCitadelPath(deadlockPath);
    const folders = [getAddonsPath(deadlockPath)]; // base, created if missing
    try {
        const overflow = readdirSync(citadelPath, { withFileTypes: true })
            .filter((e) => e.isDirectory() && OVERFLOW_FOLDER_RE.test(e.name))
            .map((e) => ({ path: join(citadelPath, e.name), num: parseInt(e.name.match(OVERFLOW_FOLDER_RE)![1], 10) }))
            .sort((a, b) => a.num - b.num)
            .map((e) => e.path);
        folders.push(...overflow);
    } catch {
        // citadel/ unreadable: base-only is the safe fallback.
    }
    return folders;
}

/**
 * Get the Nth overflow addons folder path (citadel/addons{index}, index >= 1),
 * creating it if necessary. These are the spill-over roots for mods past the
 * base folder's 99-slot pakNN budget.
 */
export function overflowAddonsPath(deadlockPath: string, index: number): string {
    const path = join(deadlockPath, 'game', 'citadel', `addons${index}`);
    if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
    }
    return path;
}

/** Overflow folder basenames (addons1, addons2, ...) that exist on disk, in
 *  numeric order. Empty when no overflow folders have been created yet. */
export function getOverflowFolderNames(deadlockPath: string): string[] {
    return getAddonFolderPaths(deadlockPath)
        .slice(1) // drop the base citadel/addons
        .map((p) => basename(p));
}

/**
 * Create and return the next overflow folder, reusing the lowest unused
 * addons{N} index (so a deleted folder's slot is recycled). Returns null when
 * the MAX_ADDON_FOLDERS cap is already reached, leaving the caller to surface
 * the enable-limit error.
 */
export function createNextOverflowFolder(deadlockPath: string): string | null {
    const used = new Set(
        getOverflowFolderNames(deadlockPath).map((n) => parseInt(n.match(OVERFLOW_FOLDER_RE)![1], 10))
    );
    let index = 1;
    while (used.has(index)) index++;
    // index is the 1-based overflow slot; base counts as folder 0, so the cap is
    // MAX_ADDON_FOLDERS - 1 overflow folders.
    if (index > MAX_ADDON_FOLDERS - 1) return null;
    return overflowAddonsPath(deadlockPath, index);
}

/**
 * Derive the metadata/identity key for a VPK from its on-disk location.
 *
 * Mods in the base citadel/addons folder and in .disabled/ key to their BARE
 * filename, exactly as they always have, so existing installs need no migration.
 * Mods in an overflow folder key to `addons{N}/<filename>` so a pak01_dir.vpk in
 * addons1 can't collide with the pak01_dir.vpk in the base folder. This is the
 * single source of truth for the rule; metadata access and id generation both
 * route through it.
 */
export function metaKeyFor(vpkPath: string): string {
    const fileName = basename(vpkPath);
    const parentName = basename(dirname(vpkPath));
    return OVERFLOW_FOLDER_RE.test(parentName) ? `${parentName}/${fileName}` : fileName;
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
