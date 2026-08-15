import {
    copyFileSync,
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
    ensureRealDirectory(real);

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
//
// Neither call can take a real folder's contents with it: rmdir is not recursive
// (a populated directory is ENOTEMPTY), and unlink refuses a directory that has
// no readable reparse point (EPERM on Windows, EISDIR on POSIX). On a junction,
// rmdir removes the reparse point and leaves the target's files alone.
//
// The rmdir error is the informative one when both fail: it carries the reason
// the link is stuck (EBUSY for a held handle, EACCES for an ACL), where unlink
// only ever reports that the path is a directory. This bug was diagnosed from a
// user's log, so keep the errno that explains it.
function removeLink(path: string): void {
    try {
        rmdirSync(path);
    } catch (rmdirErr) {
        try {
            unlinkSync(path);
        } catch {
            throw rmdirErr;
        }
    }
}

/**
 * Make `real` a directory we can write into, breaking a symlink loop if that is
 * what stands in the way.
 *
 * dropWedgedTarget is what normally clears this, and it catches every loop we
 * know how to build: realpathSync throws on a cycle, so the link resolves to
 * null and gets dropped. This is the backstop for a shape it decides against by
 * comparing resolved path STRINGS, which on Windows can compare unequal for one
 * location: fs.realpathSync is the JS walk (not realpathSync.native), so it
 * expands no 8.3 short name and canonicalizes no case, and a `subst` drive or a
 * junctioned Steam library gives the same folder two spellings.
 *
 * Narrow on purpose. Only ELOOP is treated as recoverable, because only ELOOP
 * says the link is unusable by anyone. Retrying on any error would let a
 * transient failure (an unavailable drive, a denied ACL) delete the deliberate
 * "replays live on another drive" junction that dropWedgedTarget goes out of
 * its way to preserve.
 */
function ensureRealDirectory(real: string): void {
    try {
        mkdirSync(real, { recursive: true });
        return;
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ELOOP') throw err;
        if (!linkStat(real)?.isSymbolicLink()) throw err;
        removeLink(real);
    }
    mkdirSync(real, { recursive: true });
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

/**
 * Move one replay into the canonical folder, across volumes if it has to.
 *
 * rename is MoveFileExW on Windows without MOVEFILE_COPY_ALLOWED, so it fails
 * with EXDEV the moment the two ends sit on different volumes. That is not an
 * exotic case here: it is exactly the "replays kept on another drive" setup this
 * service goes out of its way to preserve (citadel/replays junctioned to D:),
 * combined with a mod folder that 1.27.0 already filled with real downloads.
 * Without the fallback, that user throws on the first file of every launch and
 * never gets a link.
 *
 * Copy-then-unlink, not copyFile alone: the source folder has to end up empty or
 * the rmdir that follows fails and the folder never becomes a link.
 */
function moveEntry(source: string, dest: string): void {
    try {
        renameSync(source, dest);
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
        copyFileSync(source, dest);
        unlinkSync(source);
    }
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
            moveEntry(join(link, name), dest);
        }
        // Throws ENOTEMPTY if a name collision was skipped above, which leaves the
        // folder untouched rather than losing a file to make room for the link.
        rmdirSync(link);
    }

    // 'junction' is what lets this work on Windows without admin rights. The
    // argument is ignored everywhere else.
    symlinkSync(real, link, 'junction');
}
