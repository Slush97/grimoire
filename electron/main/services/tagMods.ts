import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { scanMods, runExclusiveModMutation, type Mod } from './mods';
import { getModMetadata, setModMetadata, type ModMetadata } from './metadata';
import { readEmbeddedAddonInfo } from './vpkIdentity';
import {
    computeOriginalIdentity,
    carryForwardOriginalIdentity,
    serializeAddonInfo,
    ADDONINFO_ENTRY,
    type AddonInfoFields,
    type OriginalIdentity,
} from './embeddedMetadata';
import { runVpkmerge, verifyVpkOutput } from './modMerger';
import {
    assertCanMoveLoadedGameMod,
    isLoadedGameModLocked,
    syncRunningGameModSnapshotFromMods,
} from './gameSessionMods';
import type {
    TagAllInstalledResult,
    TagInstalledProgress,
} from '../../../src/types/mod';

/**
 * Path B: in-place VPK tagging (see docs/vpk-metadata-embed-integration.md).
 *
 * Tag a single mod, or bulk-tag the whole installed library, by re-packing each
 * VPK with a self-identifying `addoninfo.txt` embedded at its root. The embed
 * carries the VPK's CANONICAL (original, pre-first-tag) whole-file sha256, so an
 * orphaned-but-tagged file can be identified offline with zero network.
 *
 * The canonical identity never changes when a file is tagged: the original hash
 * is read back from any existing embed (idempotent re-tag) or computed from the
 * still-pristine bytes on a first tag, and is NEVER recomputed from already-tagged
 * bytes. metadata.sha256 already equals that original for an untagged file, so it
 * is left untouched (no re-stamp); resolveVpkIdentity reads the embedded original
 * back afterwards. Tagging a loaded mod is a hard refusal (the running game has it
 * memory-mapped), exactly like merge / reorder.
 */

const SHA256_RE = /^[0-9a-f]{64}$/i;

/** Build the GameBanana page URL for a tagged single mod, when its id is known. */
function gameBananaUrl(gameBananaId: number | undefined, section: string | undefined): string | undefined {
    if (!gameBananaId) return undefined;
    const path = section === 'Sound' ? 'sounds' : 'mods';
    return `https://gamebanana.com/${path}/${gameBananaId}`;
}

/**
 * Assemble the `addoninfo.txt` fields for a single-mod tag. Title is the mod's
 * display name; author is omitted (Grimoire does not store a per-mod author, and
 * serializeAddonInfo drops empty values); gamebananaId / sourceUrl come from the
 * mod's metadata when present. The grimoireOriginal* triple is the canonical-
 * identity anchor resolveVpkIdentity reads back.
 */
function buildAddonFields(mod: Mod, meta: ModMetadata | undefined, original: OriginalIdentity): AddonInfoFields {
    const gbId = meta?.gameBananaId;
    return {
        title: meta?.modName || mod.name,
        author: '',
        gamebananaId: gbId ? String(gbId) : undefined,
        sourceUrl: gameBananaUrl(gbId, meta?.sourceSection),
        buildDate: new Date().toISOString(),
        grimoireOriginalSha256: original.sha256,
        grimoireOriginalCrc32: original.crc32,
        grimoireOriginalSize: original.size,
    };
}

/** Does this VPK already carry a well-formed self-identifying embed? */
function isAlreadyTagged(vpkPath: string): boolean {
    const embed = readEmbeddedAddonInfo(vpkPath);
    return !!(embed?.grimoireOriginalSha256 && SHA256_RE.test(embed.grimoireOriginalSha256));
}

/**
 * Re-pack `modPath` in place with `addoninfo.txt` embedded at its root, then
 * atomically swap it over the original. Uses the single-input `vpkmerge metadata`
 * subcommand (which preserves every existing entry and refuses output == input);
 * no typed --title/--author is passed, so Grimoire's own serialized addoninfo.txt
 * rides in purely via --extra-file. The temp output is a dotfile in the mod's OWN
 * folder (a non-`_dir.vpk` name, so it is neither scanned as a mod nor counted as
 * a slot) so the rename stays on one volume; on any failure the original VPK is
 * left untouched.
 */
async function embedAddonInfoInPlace(modPath: string, addonText: string): Promise<void> {
    const addonTmp = join(tmpdir(), `grimoire-tag-addoninfo-${randomUUID()}.txt`);
    const embedOut = join(dirname(modPath), `.tag-embed-${randomUUID()}.vpk`);
    try {
        await fs.writeFile(addonTmp, addonText);
        await runVpkmerge([
            'metadata',
            '--vpk',
            modPath,
            '--output',
            embedOut,
            '--extra-file',
            `${ADDONINFO_ENTRY}=${addonTmp}`,
        ]);
        await verifyVpkOutput(embedOut);
        await fs.rename(embedOut, modPath);
    } catch (err) {
        try { await fs.unlink(embedOut); } catch { /* ignore partial-output cleanup */ }
        throw err;
    } finally {
        try { await fs.unlink(addonTmp); } catch { /* best-effort temp cleanup */ }
    }
}

/**
 * Tag one mod in place (the shared core; caller already holds the mutation lock
 * and has verified the mod is not loaded). Carries an existing embed's original
 * hash forward when present, else computes it from the current (still-pristine)
 * bytes. Does NOT re-stamp metadata.sha256 (canonical = original = unchanged);
 * sets a `tagged: true` hint for the UI and to short-circuit re-runs.
 */
async function tagModCore(mod: Mod): Promise<void> {
    const meta = getModMetadata(mod.metaKey);
    const existingEmbed = readEmbeddedAddonInfo(mod.path) ?? undefined;
    const original = carryForwardOriginalIdentity(existingEmbed) ?? (await computeOriginalIdentity(mod.path));
    const addonText = serializeAddonInfo(buildAddonFields(mod, meta, original));
    await embedAddonInfoInPlace(mod.path, addonText);
    setModMetadata(mod.metaKey, { tagged: true });
}

/**
 * Tag a single installed mod in place. Runs under the mod-mutation lock and
 * refuses if the running game has the mod loaded (a hard error, the same
 * GAME_RUNNING message merge / reorder use). Returns the post-tag Mod.
 */
export async function tagOneMod(deadlockPath: string, modId: string): Promise<Mod> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        await syncRunningGameModSnapshotFromMods(installed);
        const mod = installed.find((m) => m.id === modId);
        if (!mod) throw new Error(`Mod not found: ${modId}`);
        assertCanMoveLoadedGameMod(mod);
        await tagModCore(mod);
        // The tag changes the file's bytes/size but not its name, so the id and
        // metaKey are stable; re-scan only to return up-to-date size/state.
        const rescanned = (await scanMods(deadlockPath)).find((m) => m.metaKey === mod.metaKey);
        return rescanned ?? mod;
    });
}

/**
 * Retroactively tag the whole installed library in place. Runs under the
 * mod-mutation lock; loaded mods are skipped and reported (never silently
 * failed), and per-mod failures are collected rather than aborting the batch.
 * Locker-managed artifacts (rebuilt automatically) and already-merged mods
 * (Phase 2 embeds a richer addoninfo + grimoire_meta a single-mod tag would
 * clobber) are excluded. Mods that already carry a well-formed embed are counted
 * as tagged without a redundant re-pack.
 */
export async function tagAllInstalled(
    deadlockPath: string,
    onProgress?: (progress: TagInstalledProgress) => void
): Promise<TagAllInstalledResult> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        await syncRunningGameModSnapshotFromMods(installed);

        const candidates = installed.filter((mod) => {
            const meta = getModMetadata(mod.metaKey);
            if (!meta) return true;
            if (meta.merged) return false;
            if (meta.lockerCosmetics || meta.lockerSounds || meta.lockerColors || meta.lockerTrippySkins) {
                return false;
            }
            return true;
        });

        const result: TagAllInstalledResult = { tagged: 0, skipped: [], failed: [] };
        const total = candidates.length;
        let done = 0;

        for (const mod of candidates) {
            done++;
            const meta = getModMetadata(mod.metaKey);
            const modName = meta?.modName || mod.name;
            onProgress?.({ done, total, fileName: mod.fileName, modName });

            if (isLoadedGameModLocked(mod)) {
                result.skipped.push({ fileName: mod.fileName, modName, reason: 'loaded' });
                continue;
            }

            try {
                if (isAlreadyTagged(mod.path)) {
                    result.tagged++;
                    continue;
                }
                await tagModCore(mod);
                result.tagged++;
            } catch (err) {
                result.failed.push({
                    fileName: mod.fileName,
                    modName,
                    reason: err instanceof Error ? err.message : String(err),
                });
            }
        }

        return result;
    });
}

/**
 * Best-effort install-time tagging hook for download.ts. Tags each freshly
 * installed VPK (by its disabled-folder fileName) in place while it is still
 * pristine. The just-stored metadata.sha256 IS the pristine pre-tag hash, and
 * tagOneMod carries that forward as the canonical original (no re-stamp). A tag
 * failure never throws: the install already succeeded and the un-tagged file's
 * live hash equals its original, so resolveVpkIdentity stays consistent either
 * way. Only call when settings.experimentalVpkTagging is on.
 */
export async function tagFreshlyInstalled(deadlockPath: string, fileNames: string[]): Promise<void> {
    for (const fileName of fileNames) {
        try {
            const installed = await scanMods(deadlockPath);
            const mod = installed.find((m) => m.fileName === fileName);
            if (!mod) continue;
            await tagOneMod(deadlockPath, mod.id);
        } catch (err) {
            console.warn(`[tagMods] Failed to tag freshly installed ${fileName}:`, err);
        }
    }
}
