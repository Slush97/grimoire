import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { getCitadelPath, metaKeyFor } from './deadlock';
import { assertCanMoveLoadedGameMod, syncRunningGameModSnapshotFromMods } from './gameSessionMods';
import { freezeLegacyVpkIndexes } from './imprintMods';
import { getModMetadata, setModMetadataWithHash } from './metadata';
import { runVpkmergeStdout } from './modMerger';
import { runExclusiveModMutation, scanMods } from './mods';
import { assertVpkSafety, carryVpkSafety, moveSafetySnapshot } from './modSafety';
import { modTempPath } from './modTemps';
import { retargetProfileModSha } from './profiles';
import { findChunkSiblingNames, parseVpkEntryStats } from './vpk';

interface HealedModel { entry: string; attachments: string[]; blocks: number }

/**
 * Rewrites a mod's stale hero models (see `staleModelsSnapshot`) with the
 * game's camera and aim data, including missing transform-camera inputs, and
 * repacks every other entry unchanged into a same-folder temp, which replaces
 * the mod by rename, so any failure leaves the original untouched. Returns how
 * many models were healed: 0 when none was stale.
 */
export function healModAttachments(deadlockPath: string, modId: string): Promise<number> {
    const base = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        await syncRunningGameModSnapshotFromMods(installed);
        // The heal changes the mod's size, which legacy sibling order is inferred from.
        freezeLegacyVpkIndexes(installed);
        const mod = installed.find((m) => m.id === modId);
        if (!mod) throw new Error(`Mod not found: ${modId}`);
        assertCanMoveLoadedGameMod(mod);
        // The repack is one self-contained dir VPK, which would orphan the chunks.
        if (findChunkSiblingNames(mod.fileName, await fs.readdir(dirname(mod.path))).length > 0) {
            throw new Error(`${mod.fileName} is split into chunk files, which can't be fixed in place.`);
        }
        const staged = modTempPath(dirname(mod.path), 'heal');
        try {
            const healed = JSON.parse(await runVpkmergeStdout(
                ['attachments', 'heal', '--base', base, '--output', staged, '--json', mod.path]
            )) as HealedModel[];
            if (healed.length === 0) return 0;
            const mismatch = repackMismatch(mod.path, staged, healed.map((m) => m.entry));
            if (mismatch) throw new Error(`Heal repack check failed: ${mismatch}. The mod was left untouched.`);
            // Only model camera data changed, so the mod keeps its trust state.
            if (await carryVpkSafety([mod.path], staged) === 'differs') {
                await assertVpkSafety(staged, { name: mod.name });
            }
            const metaKey = metaKeyFor(mod.path);
            const previousSha = getModMetadata(metaKey)?.sha256;
            await fs.rename(staged, mod.path);
            moveSafetySnapshot(staged, mod.path);
            // Same fileName and slot with new bytes: saved profiles find local
            // mods by hash, so their entries move onto the new one.
            if (previousSha) {
                await setModMetadataWithHash(metaKey, {}, mod.path);
                retargetProfileModSha(previousSha, getModMetadata(metaKey)?.sha256);
            }
            return healed.length;
        } finally {
            await fs.rm(staged, { force: true });
        }
    });
}

/** Why the repack is not the input with only the healed models changed, or null. */
function repackMismatch(input: string, output: string, healed: string[]): string | null {
    const before = parseVpkEntryStats(input);
    const after = parseVpkEntryStats(output);
    if (!before || !after) return 'unreadable entry tree';
    const key = (path: string) => path.replace(/\\/g, '/').toLowerCase();
    const changed = new Set(healed.map(key));
    const sizes = new Map(after.map((e) => [key(e.path), e.size]));
    // A tree can list the same path twice, and the repack keeps one copy.
    const paths = new Set(before.map((e) => key(e.path))).size;
    if (sizes.size !== paths) return `${paths} entries became ${sizes.size}`;
    for (const entry of before) {
        const size = sizes.get(key(entry.path));
        if (size === undefined) return `${entry.path} is missing`;
        if (size !== entry.size && !changed.has(key(entry.path))) return `${entry.path} changed size`;
    }
    return null;
}
