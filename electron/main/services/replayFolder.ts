import {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmdirSync,
    statSync,
    symlinkSync,
    unlinkSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { getCitadelPath, getModScanRootPaths } from './deadlock';

/**
 * Keep downloaded replays decompressible on a modded install.
 *
 * A modded gameinfo.gi lists mod folders ahead of `Game citadel`, and the engine
 * downloads replays into the FIRST of those folders while the replay manager
 * still unpacks out of citadel/replays. The download lands in one folder and the
 * decompress step looks in the other, so every replay fails with
 * CITADEL_REPLAY_MANAGER_ERROR_PARTIAL_DECOMPRESSION_FAILURE.
 *
 * "First" is the part that has to stay honest: citadel/grimoire (the priority
 * root) sits above citadel/addons in the canonical block, so covering only the
 * addons folder fixes nobody once a grimoire folder exists, which is always
 * (getGrimoirePath creates it on every scan). Every root that outranks citadel
 * gets a replays link, in the order the block lists them.
 *
 * Deleting those folders is not the fix: the engine still writes there, it just
 * recreates them and stays broken. Instead make every path the same directory.
 * citadel/replays is the real folder (it is where a vanilla install writes, so
 * the user's replays keep working if they stop using grimoire) and each mod
 * folder's replays becomes a link to it.
 */
const REPLAYS_FOLDER_NAME = 'replays';

export function ensureReplayFolderLink(deadlockPath: string): void {
    const real = join(getCitadelPath(deadlockPath), REPLAYS_FOLDER_NAME);
    const links = getModScanRootPaths(deadlockPath).map((root) => join(root, REPLAYS_FOLDER_NAME));

    dropWedgedTarget(real, links);
    mkdirSync(real, { recursive: true });

    // One folder that can't be linked (a name collision, a file in the way) must
    // not strand the others: link what we can, then report the first failure.
    let failure: unknown = null;
    for (const link of links) {
        try {
            linkReplaysAt(link, real);
        } catch (err) {
            failure ??= err;
        }
    }

    if (failure) throw failure;
}

// lstat, not existsSync: a link whose target is missing or loops has to read as
// present, or we'd try to create it again on top of itself.
function linkStat(path: string): ReturnType<typeof lstatSync> | null {
    try {
        return lstatSync(path);
    } catch {
        return null;
    }
}

// Where a path actually lands, or null when it dangles or loops.
function resolveTarget(path: string): string | null {
    try {
        return realpathSync(path);
    } catch {
        return null;
    }
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

function samePath(a: string, b: string): boolean {
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// rmdir removes a Windows junction or directory symlink; unlink removes a POSIX
// one. Try both so a wedged link goes away on either platform.
function removeLink(path: string): void {
    try {
        rmdirSync(path);
    } catch {
        unlinkSync(path);
    }
}

/**
 * citadel/replays is what every other copy points at, so it has to be a real
 * directory. A link here is usually the community workaround (citadel/replays
 * junctioned at citadel/addons/replays); linking that mod folder back at
 * citadel/replays makes the two reference each other and every access fails with
 * ELOOP, including the mkdir below. So drop a link that leads nowhere, and drop
 * one aimed at a folder this service is about to link back here.
 *
 * A link pointing anywhere else is someone deliberately keeping replays
 * elsewhere (another drive, say). Leave it: the mod folders link at this path
 * and the OS resolves the rest.
 */
function dropWedgedTarget(real: string, links: string[]): void {
    const stat = linkStat(real);
    if (!stat?.isSymbolicLink()) return;

    const target = resolveTarget(real);
    if (!target || !isDirectory(target)) {
        removeLink(real); // dangling, or already looping
        return;
    }

    if (links.some((link) => samePath(target, canonicalPath(link)))) {
        removeLink(real); // the community workaround; whatever is in there gets
        // moved into the fresh folder when that link is rebuilt below
    }
}

// A link's own path with its parents resolved, so it compares equal to a
// realpath result. realpath on the link itself would resolve the leaf too, which
// is the thing being compared against.
function canonicalPath(path: string): string {
    const parent = resolveTarget(dirname(path));
    return parent ? join(parent, basename(path)) : path;
}

function linkReplaysAt(link: string, real: string): void {
    const stat = linkStat(link);

    if (stat?.isSymbolicLink()) {
        const target = resolveTarget(link);
        if (target && samePath(target, resolveTarget(real) ?? real)) return; // already home
        removeLink(link); // dangling, looping, or aimed somewhere else
    } else if (stat) {
        // A real folder, from a run before this fix covered it. Move its replays
        // into the canonical folder so nothing is stranded, then let it become
        // the link.
        for (const name of readdirSync(link)) {
            const dest = join(real, name);
            if (existsSync(dest)) continue; // never clobber a replay already there
            renameSync(join(link, name), dest);
        }
        // Throws ENOTEMPTY if a name collision was skipped above, which leaves the
        // folder untouched rather than losing a file to make room for the link.
        rmdirSync(link);
    }

    // 'junction' is what lets this work on Windows without admin rights. The
    // argument is ignored everywhere else.
    symlinkSync(real, link, 'junction');
}
