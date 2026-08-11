// Steam install root discovery, shared by every service that needs to find
// Steam's data on disk (game detection, loginusers.vdf, localconfig.vdf).
//
// A "Steam root" is the directory that directly contains steamapps/, config/
// and userdata/. Callers append whichever subfolder they care about.
//
// macOS is the interesting platform. Deadlock ships no macOS depot, so the
// native Steam client at ~/Library/Application Support/Steam can never hold it.
// The only way the game exists on a Mac is inside a Wine prefix, in practice a
// CrossOver bottle, where a Windows Steam installed the Windows depot. So on
// darwin we enumerate CrossOver bottles and treat each Steam we find inside one
// as a first-class Steam root. The native location is still probed (harmless,
// and correct the day Valve ships a macOS build).

import { existsSync, readdirSync, readlinkSync, statSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

/** A Wine/CrossOver prefix that contains a Windows Steam installation. */
export interface SteamBottle {
    /** Bottle folder name, as shown in CrossOver ("Deadlock"). */
    name: string;
    /** Absolute host path of the bottle root (the dir holding drive_c/). */
    bottlePath: string;
    /** Absolute host path of the Steam install inside the bottle. */
    steamRoot: string;
}

/** Default CrossOver bottles directory on macOS. */
export function defaultBottlesDir(): string {
    return join(homedir(), 'Library/Application Support/CrossOver/Bottles');
}

/**
 * Windows-side Steam install directories to probe inside a bottle, relative to
 * drive_c. Ordered as Steam's own installer prefers them.
 */
const BOTTLE_STEAM_SUBPATHS = [
    join('Program Files (x86)', 'Steam'),
    join('Program Files', 'Steam'),
];

/**
 * Map a bottle's DOS drive letters to host paths by reading the symlinks in
 * dosdevices/. Returns lowercase keys with the colon included ("c:").
 *
 * Note that z: conventionally maps to the host filesystem root, so a Windows
 * path recorded inside the bottle can legitimately point back out at native
 * files. That is why we resolve through this map rather than assuming every
 * Windows path lives under drive_c.
 */
export function readBottleDriveMap(bottlePath: string): Record<string, string> {
    const dosdevices = join(bottlePath, 'dosdevices');
    const map: Record<string, string> = {};
    let entries: string[];
    try {
        entries = readdirSync(dosdevices);
    } catch {
        return map;
    }
    for (const entry of entries) {
        // Drive links only ("c:"). Skip port links like "com1" and the
        // "c::" device variants Wine also creates.
        if (!/^[a-z]:$/i.test(entry)) continue;
        const linkPath = join(dosdevices, entry);
        try {
            const target = readlinkSync(linkPath);
            map[entry.toLowerCase()] = isAbsolute(target)
                ? target
                : resolve(dosdevices, target);
        } catch {
            // Not a symlink (some prefixes use real dirs); use it as-is.
            if (existsSync(linkPath)) map[entry.toLowerCase()] = linkPath;
        }
    }
    return map;
}

/**
 * Translate a Windows path recorded inside a bottle ("C:\\Program Files
 * (x86)\\Steam") into a host path, using that bottle's drive map. Returns null
 * when the drive letter is not mapped, which is the honest answer for a library
 * on a drive the prefix no longer has.
 *
 * Accepts an already-unescaped path: VDF doubles its backslashes, and callers
 * are expected to have collapsed those first.
 */
export function resolveBottleWindowsPath(
    windowsPath: string,
    driveMap: Record<string, string>
): string | null {
    const match = windowsPath.match(/^([a-z]:)[\\/]*(.*)$/i);
    if (!match) return null;
    const root = driveMap[match[1].toLowerCase()];
    if (!root) return null;
    const rest = match[2].replace(/\\/g, '/');
    return rest ? join(root, rest) : root;
}

/**
 * Every CrossOver bottle that contains a Windows Steam install.
 *
 * `bottlesDir` is injectable so tests can point at a fixture tree; production
 * callers use the default.
 */
export function findSteamBottles(bottlesDir: string = defaultBottlesDir()): SteamBottle[] {
    let entries: string[];
    try {
        entries = readdirSync(bottlesDir);
    } catch {
        return [];
    }

    const bottles: SteamBottle[] = [];
    for (const name of entries) {
        const bottlePath = join(bottlesDir, name);
        try {
            if (!statSync(bottlePath).isDirectory()) continue;
        } catch {
            continue;
        }
        for (const sub of BOTTLE_STEAM_SUBPATHS) {
            const steamRoot = join(bottlePath, 'drive_c', sub);
            if (existsSync(steamRoot)) {
                bottles.push({ name, bottlePath, steamRoot });
                break;
            }
        }
    }
    // Stable order so detection is deterministic across runs.
    return bottles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The bottle a given host path lives inside, or null when the path is not in a
 * bottle. Used by the launch path to decide whether the game must be started
 * through Wine and, if so, which prefix.
 */
export function findBottleForPath(
    hostPath: string,
    bottlesDir: string = defaultBottlesDir()
): SteamBottle | null {
    const normalized = resolve(hostPath);
    for (const bottle of findSteamBottles(bottlesDir)) {
        const root = resolve(bottle.bottlePath);
        if (normalized === root || normalized.startsWith(root + '/')) return bottle;
    }
    return null;
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
 * Steam install roots to probe, in priority order, deduplicated.
 *
 * On Windows we ask the registry first so users with Steam installed off the
 * C: default are handled correctly. On macOS bottle Steams come before the
 * native location, because the native one cannot hold Deadlock.
 */
export function getSteamRoots(bottlesDir: string = defaultBottlesDir()): string[] {
    const home = homedir();
    const roots: string[] = [];
    const push = (p: string | null) => {
        if (!p) return;
        const norm = process.platform === 'win32'
            ? p.replace(/\//g, '\\').replace(/\\+$/, '')
            : p.replace(/\/+$/, '');
        if (!roots.some((existing) => existing.toLowerCase() === norm.toLowerCase())) {
            roots.push(norm);
        }
    };

    if (process.platform === 'linux') {
        push(join(home, '.steam/steam'));
        push(join(home, '.local/share/Steam'));
        push(join(home, '.var/app/com.valvesoftware.Steam/.steam/steam'));
        return roots;
    }

    if (process.platform === 'darwin') {
        for (const bottle of findSteamBottles(bottlesDir)) push(bottle.steamRoot);
        push(join(home, 'Library/Application Support/Steam'));
        return roots;
    }

    if (process.platform === 'win32') {
        push(queryWindowsRegistry('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
        push(queryWindowsRegistry('HKCU\\SOFTWARE\\Valve\\Steam', 'SteamPath'));
        push('C:\\Program Files (x86)\\Steam');
        push('C:\\Program Files\\Steam');
        return roots;
    }

    return roots;
}
