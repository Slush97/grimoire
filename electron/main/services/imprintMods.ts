import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import os, { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { scanMods, runExclusiveModMutation, type Mod } from './mods';
import { getModMetadata, setModMetadata, type ModMetadata } from './metadata';
import { readEmbeddedAddonInfo } from './vpkIdentity';
import { parseVpkDirectoryCached } from './vpk';
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
    ImprintAllInstalledResult,
    ImprintInstalledProgress,
    ImprintPreflightResult,
    ImprintAnomalousMod,
} from '../../../src/types/mod';

/**
 * Path B: in-place VPK imprinting (see docs/vpk-metadata-embed-integration.md).
 *
 * Imprint a single mod, or bulk-imprint the whole installed library, by re-packing
 * each VPK with a self-identifying `addoninfo.txt` embedded at its root. The embed
 * carries the VPK's CANONICAL (original, pre-first-imprint) whole-file sha256, so an
 * orphaned-but-imprinted file can be identified offline with zero network.
 *
 * The canonical identity never changes when a file is imprinted: the original hash
 * is read back from any existing embed (idempotent re-imprint) or computed from the
 * still-pristine bytes on a first imprint, and is NEVER recomputed from already-imprinted
 * bytes. metadata.sha256 already equals that original for an un-imprinted file, so it
 * is left untouched (no re-stamp); resolveVpkIdentity reads the embedded original
 * back afterwards. Imprinting a loaded mod is a hard refusal (the running game has it
 * memory-mapped), exactly like merge / reorder.
 */

const SHA256_RE = /^[0-9a-f]{64}$/i;

/** Build the GameBanana page URL for an imprinted single mod, when its id is known. */
function gameBananaUrl(gameBananaId: number | undefined, section: string | undefined): string | undefined {
    if (!gameBananaId) return undefined;
    const path = section === 'Sound' ? 'sounds' : 'mods';
    return `https://gamebanana.com/${path}/${gameBananaId}`;
}

/**
 * Assemble the `addoninfo.txt` fields for a single-mod imprint. Title is the mod's
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
function isAlreadyImprinted(vpkPath: string): boolean {
    const embed = readEmbeddedAddonInfo(vpkPath);
    return !!(embed?.grimoireOriginalSha256 && SHA256_RE.test(embed.grimoireOriginalSha256));
}

/**
 * Inspect a candidate VPK for anomalies that make imprinting it unsafe, and
 * return the anomaly reason (or null when the file is sound). Never mutates the
 * file and NEVER re-records any canonical identity (KEYSTONE). Called by both
 * imprintPreflight and the per-mod loop of imprintAllInstalled (before
 * imprintModCore) so an anomalous file is skipped and reported, never silently
 * failed and never re-stamped.
 *
 * Checks, in order:
 *  - 'empty': zero-byte / truncated on disk (fs.stat size 0).
 *  - 'unparseable': parseVpkDirectoryCached returns null (not a readable VPK dir).
 *  - 'foreign-embed': carries an addoninfo.txt but no valid grimoireOriginalSha256
 *    (a non-Grimoire addon block, or one written by an incompatible tool).
 *  - 'hash-drift': a NON-embedded file whose live whole-file hash no longer
 *    matches the stored canonical metadata.sha256 (someone edited the bytes out
 *    of band). We report it and refuse; we do NOT re-record the drifted hash,
 *    because the stored value is the canonical identity every other record keys
 *    on. Files that already carry a valid embed are exempt: their canonical
 *    identity is the embedded original, and the live bytes legitimately differ.
 */
async function checkImprintAnomaly(mod: Mod): Promise<ImprintAnomalousMod['reason'] | null> {
    // Zero-byte / truncated file.
    try {
        const st = await fs.stat(mod.path);
        if (st.size === 0) return 'empty';
    } catch {
        // A file that cannot even be stat'd is not a valid VPK to imprint.
        return 'unparseable';
    }

    // Not a readable VPK directory.
    if (parseVpkDirectoryCached(mod.path) === null) return 'unparseable';

    // An addoninfo.txt that is not a valid Grimoire embed -> foreign embed. A
    // valid Grimoire embed (already imprinted) is fine; the caller handles it.
    const embed = readEmbeddedAddonInfo(mod.path);
    if (embed) {
        const sha = embed.grimoireOriginalSha256;
        if (!sha || !SHA256_RE.test(sha)) return 'foreign-embed';
        // Valid embed: canonical identity is the embedded original; live bytes may
        // differ legitimately, so skip the drift check.
        return null;
    }

    // Non-embedded file: the live whole-file hash must still match the stored
    // canonical identity. Drift means the bytes changed out of band; refuse and
    // report, but NEVER re-record (KEYSTONE).
    const meta = getModMetadata(mod.metaKey);
    if (meta?.sha256 && SHA256_RE.test(meta.sha256)) {
        try {
            const live = await computeOriginalIdentity(mod.path, { includeCrc: false });
            if (live.sha256 !== meta.sha256.toLowerCase()) return 'hash-drift';
        } catch {
            return 'unparseable';
        }
    }

    return null;
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
    const addonTmp = join(tmpdir(), `grimoire-imprint-addoninfo-${randomUUID()}.txt`);
    const embedOut = join(dirname(modPath), `.imprint-embed-${randomUUID()}.vpk`);
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
 * Imprint one mod in place (the shared core; caller already holds the mutation lock
 * and has verified the mod is not loaded). Carries an existing embed's original
 * hash forward when present, else computes it from the current (still-pristine)
 * bytes. Does NOT re-stamp metadata.sha256 (canonical = original = unchanged);
 * sets an `imprinted: true` hint for the UI and to short-circuit re-runs.
 */
async function imprintModCore(mod: Mod): Promise<void> {
    const meta = getModMetadata(mod.metaKey);
    const existingEmbed = readEmbeddedAddonInfo(mod.path) ?? undefined;
    const original =
        carryForwardOriginalIdentity(existingEmbed) ??
        (await computeOriginalIdentity(mod.path, { includeCrc: false }));
    const addonText = serializeAddonInfo(buildAddonFields(mod, meta, original));
    await embedAddonInfoInPlace(mod.path, addonText);
    setModMetadata(mod.metaKey, { imprinted: true });
}

/**
 * Imprint a single installed mod in place. Runs under the mod-mutation lock and
 * refuses if the running game has the mod loaded (a hard error, the same
 * GAME_RUNNING message merge / reorder use). Returns the post-imprint Mod.
 */
export async function imprintOneMod(deadlockPath: string, modId: string): Promise<Mod> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        await syncRunningGameModSnapshotFromMods(installed);
        const mod = installed.find((m) => m.id === modId);
        if (!mod) throw new Error(`Mod not found: ${modId}`);
        assertCanMoveLoadedGameMod(mod);
        await imprintModCore(mod);
        // The imprint changes the file's bytes/size but not its name, so the id and
        // metaKey are stable; re-scan only to return up-to-date size/state.
        const rescanned = (await scanMods(deadlockPath)).find((m) => m.metaKey === mod.metaKey);
        return rescanned ?? mod;
    });
}

/**
 * Retroactively imprint the whole installed library in place. Runs under the
 * mod-mutation lock; loaded mods are skipped and reported (never silently
 * failed), and per-mod failures are collected rather than aborting the batch.
 * Locker-managed artifacts (rebuilt automatically) and already-merged mods
 * (Phase 2 embeds a richer addoninfo + grimoire_meta a single-mod imprint would
 * clobber) are excluded. Mods that already carry a well-formed embed are counted
 * as imprinted without a redundant re-pack.
 */
export async function imprintAllInstalled(
    deadlockPath: string,
    onProgress?: (progress: ImprintInstalledProgress) => void
): Promise<ImprintAllInstalledResult> {
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

        const result: ImprintAllInstalledResult = { imprinted: 0, skipped: [], failed: [] };
        const total = candidates.length;
        let done = 0;

        // Bounded worker pool: the dominant per-mod cost is the vpkmerge repack
        // subprocess in embedAddonInfoInPlace, so overlapping several across cores
        // shrinks a bulk run wall-clock. The per-mod work is fully independent, and
        // JS is single-threaded: every shared-state mutation below (result.*, the
        // `done` counter + its onProgress emit, setModMetadata inside imprintModCore)
        // is SYNCHRONOUS and sits between awaits, so no two workers can interleave a
        // read-then-write of shared state. Each worker pulls the next candidate via a
        // synchronous index bump (nextIndex++). `done` is incremented once per mod as
        // it COMPLETES (all classifications land there), keeping done/total monotonic.
        const poolSize = Math.min(8, Math.max(1, os.cpus().length));
        let nextIndex = 0;

        const processOne = (mod: Mod): Promise<void> => {
            const meta = getModMetadata(mod.metaKey);
            const modName = meta?.modName || mod.name;

            // Emit progress + classify once this mod is FULLY resolved, so done is
            // monotonic and every emitted tick names a mod that just finished.
            const finish = (): void => {
                done++;
                onProgress?.({ done, total, fileName: mod.fileName, modName });
            };

            if (isLoadedGameModLocked(mod)) {
                result.skipped.push({ fileName: mod.fileName, modName, reason: 'loaded' });
                finish();
                return Promise.resolve();
            }

            return (async () => {
                try {
                    if (isAlreadyImprinted(mod.path)) {
                        result.imprinted++;
                        return;
                    }
                    // Anomaly guard: skip + report, never re-stamp (KEYSTONE). The
                    // reason flows into the failed list so the run stays fail-soft.
                    const anomaly = await checkImprintAnomaly(mod);
                    if (anomaly) {
                        result.failed.push({ fileName: mod.fileName, modName, reason: anomaly });
                        return;
                    }
                    await imprintModCore(mod);
                    result.imprinted++;
                } catch (err) {
                    // Fail-soft: a per-mod throw lands in failed and never aborts.
                    result.failed.push({
                        fileName: mod.fileName,
                        modName,
                        reason: err instanceof Error ? err.message : String(err),
                    });
                } finally {
                    finish();
                }
            })();
        };

        // Each worker drains the shared index until the candidate list is exhausted.
        const worker = async (): Promise<void> => {
            for (;;) {
                const i = nextIndex++;
                if (i >= candidates.length) return;
                await processOne(candidates[i]);
            }
        };

        await Promise.all(Array.from({ length: Math.min(poolSize, total) }, () => worker()));

        return result;
    });
}

/**
 * No-network dry-run: classify every installed mod into one of six mutually
 * exclusive imprint buckets WITHOUT calling imprintModCore or mutating any file.
 * Runs an up-front full pass so the UI can show the user exactly what a bulk
 * imprint would do before they commit. Returns per-bucket counts (merged and
 * locker-managed kept separate even though the UI collapses them) plus the item
 * lists for the buckets a user needs to inspect (loaded + anomalies).
 *
 * Classification order (first match wins, so every candidate lands in exactly
 * one bucket and the six counts sum to scanMods()'s candidate count):
 *   1. locker-managed / merged -> auto-managed (excluded from bulk imprint).
 *   2. blocked-loaded          -> the running game has it memory-mapped.
 *   3. already-imprinted       -> carries a well-formed self-identifying embed.
 *   4. anomalous               -> anomaly guard flagged it (skip + report).
 *   5. eligible                -> safe to imprint.
 *
 * Ordering merged/locker before already-imprinted matches imprintAllInstalled,
 * which excludes those from its candidate set entirely. Ordering blocked-loaded
 * before already-imprinted mirrors the bulk loop (loaded is checked first, so a
 * loaded-but-already-imprinted mod reports as loaded, consistent across both).
 * The anomaly guard never re-records any canonical identity (KEYSTONE).
 */
export async function imprintPreflight(deadlockPath: string): Promise<ImprintPreflightResult> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        // Fresh loaded snapshot once, up front (same as the bulk run + merge).
        await syncRunningGameModSnapshotFromMods(installed);

        const result: ImprintPreflightResult = {
            counts: {
                eligible: 0,
                alreadyImprinted: 0,
                blockedLoaded: 0,
                merged: 0,
                lockerManaged: 0,
                anomalous: 0,
            },
            total: installed.length,
            blockedLoaded: [],
            anomalous: [],
        };

        for (const mod of installed) {
            const meta = getModMetadata(mod.metaKey);
            const modName = meta?.modName || mod.name;

            // 1. Auto-managed (merged or Locker): excluded from bulk imprint.
            if (meta?.merged) {
                result.counts.merged++;
                continue;
            }
            if (
                meta?.lockerCosmetics ||
                meta?.lockerSounds ||
                meta?.lockerColors ||
                meta?.lockerTrippySkins
            ) {
                result.counts.lockerManaged++;
                continue;
            }

            // 2. Loaded by the running game (a hard imprint refusal).
            if (isLoadedGameModLocked(mod)) {
                result.counts.blockedLoaded++;
                result.blockedLoaded.push({ fileName: mod.fileName, modName, reason: 'loaded' });
                continue;
            }

            // 3. Already carries a well-formed self-identifying embed.
            if (isAlreadyImprinted(mod.path)) {
                result.counts.alreadyImprinted++;
                continue;
            }

            // 4. Anomaly guard (skip + report, never re-stamp: KEYSTONE).
            const anomaly = await checkImprintAnomaly(mod);
            if (anomaly) {
                result.counts.anomalous++;
                result.anomalous.push({ fileName: mod.fileName, modName, reason: anomaly });
                continue;
            }

            // 5. Eligible: safe to imprint.
            result.counts.eligible++;
        }

        return result;
    });
}

/**
 * Best-effort install-time imprinting hook for download.ts. Imprints each freshly
 * installed VPK (by its disabled-folder fileName) in place while it is still
 * pristine. The just-stored metadata.sha256 IS the pristine pre-imprint hash, and
 * imprintOneMod carries that forward as the canonical original (no re-stamp). An imprint
 * failure never throws: the install already succeeded and the un-imprinted file's
 * live hash equals its original, so resolveVpkIdentity stays consistent either
 * way. Only call when settings.experimentalVpkImprinting is on.
 */
export async function imprintFreshlyInstalled(deadlockPath: string, fileNames: string[]): Promise<void> {
    for (const fileName of fileNames) {
        try {
            const installed = await scanMods(deadlockPath);
            const mod = installed.find((m) => m.fileName === fileName);
            if (!mod) continue;
            await imprintOneMod(deadlockPath, mod.id);
        } catch (err) {
            console.warn(`[imprintMods] Failed to imprint freshly installed ${fileName}:`, err);
        }
    }
}
