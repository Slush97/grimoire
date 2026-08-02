import { lstatSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { getAddonsPath, getCitadelPath } from './deadlock';

/**
 * Keep downloaded replays decompressible on a modded install.
 *
 * Any modded gameinfo.gi lists an addon folder ahead of `Game citadel`, and the
 * engine then downloads replays into citadel/addons/replays while the replay
 * manager still unpacks out of citadel/replays. The download lands in one folder
 * and the decompress step looks in the other, so every replay fails with
 * CITADEL_REPLAY_MANAGER_ERROR_PARTIAL_DECOMPRESSION_FAILURE.
 *
 * Deleting citadel/addons/replays is not the fix: the engine still writes there,
 * it just recreates it and stays broken. Instead make both paths the same
 * directory. citadel/replays is the real folder (it is where a vanilla install
 * writes, so the user's replays keep working if they stop using grimoire) and
 * citadel/addons/replays becomes a link to it.
 */
export function ensureReplayFolderLink(deadlockPath: string): void {
    const real = join(getCitadelPath(deadlockPath), 'replays');
    const link = join(getAddonsPath(deadlockPath), 'replays');

    mkdirSync(real, { recursive: true });

    // lstat, not existsSync: a link whose target is missing has to read as
    // present, or we'd try to create it again on top of itself.
    let existing;
    try {
        existing = lstatSync(link);
    } catch {
        existing = null;
    }

    if (existing?.isSymbolicLink()) return;

    if (existing) {
        // A real folder, from a modded run before this fix. Move its replays into
        // the canonical folder so nothing is stranded, then let it become the link.
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
