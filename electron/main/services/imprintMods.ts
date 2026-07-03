import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import os, { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { scanMods, runExclusiveModMutation, type Mod } from './mods';
import { getModMetadata, setModMetadata, type ModMetadata } from './metadata';
import {
    readEmbeddedAddonInfo,
    carryForwardOriginalIdentity,
    type OriginalIdentity,
} from './vpkIdentity';
import { parseVpkDirectoryCached, parseVpkEntryStats, findChunkSiblingNames } from './vpk';
import {
    computeOriginalIdentity,
    serializeAddonInfo,
    serializeModinfo,
    readEmbeddedModinfo,
    readLegacyGrimoireMergeMeta,
    findImprintRepackMismatch,
    ADDONINFO_ENTRY,
    MODINFO_ENTRY,
    MODINFO_FORMAT,
    MODINFO_GAME,
    MODINFO_SCHEMA_VERSION,
    type AddonInfoFields,
    type ModinfoModRecord,
} from './modinfoFormat';
import { runVpkmerge } from './modMerger';
import {
    evaluateEmbedStaleness,
    gameBananaPageUrl,
    refreshableFieldsFromMetadata,
} from './imprintStaleness';
import { inferMissingVpkIndexes, type MetaLookup } from './profileResolver';
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

/**
 * Assemble the `addoninfo.txt` fields for a single-mod imprint. Title is the
 * mod's display name; author is the GameBanana submitter captured at download
 * time (absent for local mods, and serializeAddonInfo drops empty values);
 * gamebananaId / gamebananaFileId / sourceUrl come from the mod's metadata
 * when present. The original* triple is the canonical-identity anchor
 * resolveVpkIdentity reads back.
 */
function buildAddonFields(
    mod: Mod,
    meta: ModMetadata | undefined,
    original: OriginalIdentity,
    writtenAt: string
): AddonInfoFields {
    const gbId = meta?.gameBananaId;
    return {
        title: meta?.modName || mod.name,
        author: meta?.author,
        gamebananaId: gbId ? String(gbId) : undefined,
        gamebananaFileId: meta?.gameBananaFileId ? String(meta.gameBananaFileId) : undefined,
        sourceUrl: gameBananaPageUrl(gbId, meta?.sourceSection),
        buildDate: writtenAt,
        originalSha256: original.sha256,
        originalSize: original.size,
        originalCrc32: original.crc32,
    };
}

/**
 * Assemble the modinfo.json machine record for a single-mod imprint. Every
 * descriptive field refreshes from the current metadata sidecar; only the
 * identity triple and firstImprintedAt are carried forward by the caller.
 * KEEP IN SYNC with refreshableFieldsFromMetadata (imprintStaleness.ts): the
 * staleness predicate derives the same fields from the same sidecar, and a
 * divergence would make freshly imprinted files read as perpetually stale.
 */
function buildModinfoRecord(
    mod: Mod,
    meta: ModMetadata | undefined,
    original: OriginalIdentity,
    writtenAt: string,
    firstImprintedAt: string
): ModinfoModRecord {
    const gbId = meta?.gameBananaId;
    const source = gbId
        ? {
            gamebananaId: gbId,
            gamebananaFileId: meta?.gameBananaFileId,
            url: gameBananaPageUrl(gbId, meta?.sourceSection),
            section: meta?.sourceSection,
            categoryId: meta?.categoryId,
            categoryName: meta?.categoryName,
        }
        : undefined;
    const packaging =
        meta?.vpkIndex !== undefined || meta?.variantLabel
            ? { vpkIndex: meta?.vpkIndex, variantLabel: meta?.variantLabel }
            : undefined;
    return {
        format: MODINFO_FORMAT,
        schemaVersion: MODINFO_SCHEMA_VERSION,
        kind: 'mod',
        writtenBy: { tool: 'grimoire', version: app.getVersion() },
        writtenAt,
        firstImprintedAt,
        game: MODINFO_GAME,
        identity: { sha256: original.sha256, size: original.size, crc32: original.crc32 },
        title: meta?.modName || mod.name,
        author: meta?.author,
        source,
        packaging,
    };
}

/** Classify a candidate's embed against the CURRENT metadata sidecar. 'fresh'
 *  means it carries a current-format modinfo.json whose refreshable fields
 *  match the sidecar, so no repack is needed. 'stale' means a (re-)imprint is
 *  pending work: never imprinted, a legacy-only embed (migrates on re-imprint),
 *  or the sidecar changed after imprinting (associate / edit / re-label). Bulk
 *  and preflight both classify through here so they can never diverge. */
function classifyEmbedFreshness(mod: Mod, meta: ModMetadata | undefined): 'fresh' | 'stale' {
    const embedded = readEmbeddedModinfo(mod.path);
    const current = refreshableFieldsFromMetadata(meta, mod.name);
    return evaluateEmbedStaleness(embedded, current).stale ? 'stale' : 'fresh';
}

/** Does this VPK carry ANY Grimoire imprint, current or legacy? Drives only
 *  the `imprinted` metadata flag (UI hint): a legacy embed still counts as
 *  imprinted for the flag even though it is stale format-wise. */
function hasAnyImprint(vpkPath: string): boolean {
    if (readEmbeddedModinfo(vpkPath) !== null) return true;
    const embed = readEmbeddedAddonInfo(vpkPath) ?? undefined;
    return carryForwardOriginalIdentity(embed, readLegacyGrimoireMergeMeta(vpkPath)) !== null;
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
 *  - 'chunked': sibling `<base>_NNN.vpk` chunk archives exist next to the dir
 *    VPK. The repack writes a single self-contained dir VPK, so imprinting
 *    would orphan the chunk payload; skip + report, never repack.
 *  - 'foreign-embed': carries an addoninfo.txt but no recoverable original
 *    identity, current keys or legacy shim (a non-Grimoire addon block, or one
 *    written by an incompatible tool).
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

    // Multi-chunk VPK: entry data lives in sibling <base>_NNN.vpk archives,
    // and the in-place repack emits a single self-contained dir VPK, so the
    // payload would be orphaned. Never repack; skip + report.
    try {
        const siblings = await fs.readdir(dirname(mod.path));
        if (findChunkSiblingNames(mod.fileName, siblings).length > 0) return 'chunked';
    } catch {
        // Cannot enumerate the folder, so chunk safety cannot be established.
        return 'unparseable';
    }

    // An addoninfo.txt that carries no recoverable original identity (current
    // keys or the legacy shim) -> foreign embed. A valid Grimoire embed
    // (current or legacy, i.e. re-imprintable) is fine; the caller handles it.
    const embed = readEmbeddedAddonInfo(mod.path);
    if (embed) {
        const carried = carryForwardOriginalIdentity(embed, readLegacyGrimoireMergeMeta(mod.path));
        if (!carried) return 'foreign-embed';
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
 * Re-pack `modPath` in place with BOTH imprint entries (`addoninfo.txt` +
 * `modinfo.json`) embedded at its root in one pass, then atomically swap it
 * over the original. Uses the single-input `vpkmerge metadata` subcommand
 * (which preserves every existing entry and refuses output == input); no typed
 * --title/--author is passed, so Grimoire's own serialized blobs ride in
 * purely via the two --extra-file args. The temp output is a dotfile in the
 * mod's OWN folder (a non-`_dir.vpk` name, so it is neither scanned as a mod
 * nor counted as a slot) so the rename stays on one volume; on any failure the
 * original VPK is left untouched.
 *
 * Before the swap the repacked output must pass a real parity check against
 * the input's entry tree (findImprintRepackMismatch): every carried entry
 * present with an unchanged logical size, nothing added beyond the two
 * imprint entries. A magic-bytes check alone (verifyVpkOutput) would accept a
 * structurally valid VPK that silently dropped or corrupted game content. Any
 * mismatch throws (landing in the caller's fail-soft per-mod handling) and
 * the original VPK keeps its slot.
 */
async function embedImprintInPlace(modPath: string, addonText: string, modinfoText: string): Promise<void> {
    const inputEntries = parseVpkEntryStats(modPath);
    if (!inputEntries) {
        throw new Error('Cannot verify the repack: the input VPK entry tree is unreadable.');
    }
    const addonTmp = join(tmpdir(), `grimoire-imprint-addoninfo-${randomUUID()}.txt`);
    const modinfoTmp = join(tmpdir(), `grimoire-imprint-modinfo-${randomUUID()}.json`);
    const embedOut = join(dirname(modPath), `.imprint-embed-${randomUUID()}.vpk`);
    try {
        await fs.writeFile(addonTmp, addonText);
        await fs.writeFile(modinfoTmp, modinfoText);
        await runVpkmerge([
            'metadata',
            '--vpk',
            modPath,
            '--output',
            embedOut,
            '--extra-file',
            `${ADDONINFO_ENTRY}=${addonTmp}`,
            '--extra-file',
            `${MODINFO_ENTRY}=${modinfoTmp}`,
        ]);
        const outputEntries = parseVpkEntryStats(embedOut);
        if (!outputEntries) {
            throw new Error('Imprint repack produced an unreadable VPK; the original was left untouched.');
        }
        const mismatch = findImprintRepackMismatch(inputEntries, outputEntries);
        if (mismatch) {
            throw new Error(`Imprint repack parity check failed: ${mismatch}. The original was left untouched.`);
        }
        await fs.rename(embedOut, modPath);
    } catch (err) {
        try { await fs.unlink(embedOut); } catch { /* ignore partial-output cleanup */ }
        throw err;
    } finally {
        try { await fs.unlink(addonTmp); } catch { /* best-effort temp cleanup */ }
        try { await fs.unlink(modinfoTmp); } catch { /* best-effort temp cleanup */ }
    }
}

/**
 * Imprint one mod in place (the shared core; caller already holds the mutation lock
 * and has verified the mod is not loaded). Carries an existing embed's original
 * hash forward when present (current keys or the legacy shim), else computes it
 * from the current (still-pristine) bytes. firstImprintedAt is carried from an
 * existing modinfo.json (or a legacy addoninfo buildDate) and otherwise set to
 * now; everything else refreshes from the current metadata sidecar. Does NOT
 * re-stamp a valid metadata.sha256 (canonical = original = unchanged); sets an
 * `imprinted: true` hint for the UI and to short-circuit re-runs. When the entry
 * has NO valid stored hash (e.g. a metadata-less unknown mod being
 * bulk-imprinted), the ORIGINAL hash is stamped alongside the hint: leaving the
 * entry sha-less would otherwise invite the startup backfill to fill it later,
 * and stamping the original here keeps the entry on the canonical axis from the
 * first moment it exists.
 */
async function imprintModCore(mod: Mod): Promise<void> {
    const meta = getModMetadata(mod.metaKey);
    const existingModinfo = readEmbeddedModinfo(mod.path);
    const existingEmbed = readEmbeddedAddonInfo(mod.path) ?? undefined;
    const original =
        carryForwardOriginalIdentity(existingEmbed, readLegacyGrimoireMergeMeta(mod.path)) ??
        (await computeOriginalIdentity(mod.path, { includeCrc: false }));
    const writtenAt = new Date().toISOString();
    const firstImprintedAt =
        existingModinfo?.firstImprintedAt ?? existingEmbed?.buildDate ?? writtenAt;
    const addonText = serializeAddonInfo(buildAddonFields(mod, meta, original, writtenAt));
    const modinfoText = serializeModinfo(
        buildModinfoRecord(mod, meta, original, writtenAt, firstImprintedAt)
    );
    await embedImprintInPlace(mod.path, addonText, modinfoText);
    const hasValidStoredHash = !!meta?.sha256 && SHA256_RE.test(meta.sha256);
    setModMetadata(mod.metaKey, {
        imprinted: true,
        ...(hasValidStoredHash ? {} : { sha256: original.sha256 }),
    });
}

/**
 * Freeze legacy vpkIndexes BEFORE any imprint changes file sizes.
 *
 * Legacy multi-VPK GameBanana groups (installed before vpkIndex existed) get
 * their index reconstructed lazily by inferMissingVpkIndexes, which size-sorts
 * the group's live on-disk sizes at profile-apply time. Imprinting re-packs a
 * VPK in place and changes its size, so partially imprinting an un-stamped
 * group between profile applies could silently shift the inferred sibling
 * order and bind shared profiles to the wrong file. Persisting the CURRENT
 * inference here pins every legacy group to the pre-imprint size axis before
 * a single byte moves.
 *
 * Runs over ALL installed mods, not just imprint candidates: a candidate's
 * sibling may be excluded from imprinting (loaded, merged, locker-managed)
 * yet still belongs to the group being frozen. Reuses the upstream inference
 * verbatim so the stamped order is exactly what profile apply would have
 * inferred; already-stamped indexes are never overwritten (the inference
 * skips them).
 *
 * Accepted residual: groups inferMissingVpkIndexes bails on (single-member,
 * or all siblings the same byte size) stay un-stamped by design. Stamping an
 * arbitrary order for an all-equal-size group would mispair shared-profile
 * indexes that fileName/positional matching currently handles better.
 *
 * getMeta / setMeta are injectable for tests only; production callers use the
 * real synchronous metadata sidecar (this runs under the mutation lock).
 */
export function freezeLegacyVpkIndexes(
    installed: Array<Pick<Mod, 'metaKey' | 'fileName' | 'size'>>,
    getMeta: MetaLookup = getModMetadata,
    setMeta: (metaKey: string, data: { vpkIndex: number }) => void = setModMetadata
): void {
    for (const [metaKey, vpkIndex] of inferMissingVpkIndexes(installed, getMeta)) {
        setMeta(metaKey, { vpkIndex });
    }
}

/**
 * Imprint a single installed mod in place. Runs under the mod-mutation lock and
 * refuses if the running game has the mod loaded (a hard error, the same
 * GAME_RUNNING message merge / reorder use). Refuses anomalous files (the same
 * guard the bulk run applies): imprinting a hash-drifted file would enshrine
 * drifted bytes as "original", and a foreign addoninfo.txt must be reported,
 * not clobbered. Returns the post-imprint Mod.
 */
export async function imprintOneMod(deadlockPath: string, modId: string): Promise<Mod> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        await syncRunningGameModSnapshotFromMods(installed);
        // Pin legacy multi-VPK sibling order before the repack changes sizes
        // (same lock scope, before any byte moves).
        freezeLegacyVpkIndexes(installed);
        const mod = installed.find((m) => m.id === modId);
        if (!mod) throw new Error(`Mod not found: ${modId}`);
        assertCanMoveLoadedGameMod(mod);
        const anomaly = await checkImprintAnomaly(mod);
        if (anomaly) {
            throw new Error(`Refusing to imprint ${mod.fileName}: ${anomaly}`);
        }
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
 * (the merge path embeds a richer kind:"merge" record a single-mod imprint
 * would clobber) are excluded. Mods whose embed is current-format AND fresh
 * (refreshable fields still match the sidecar) are counted as imprinted
 * without a redundant re-pack; stale embeds (legacy-only, or the sidecar
 * changed after imprinting) are re-imprinted, which refreshes the descriptive
 * fields and migrates the format (identity + firstImprintedAt carried).
 */
export async function imprintAllInstalled(
    deadlockPath: string,
    onProgress?: (progress: ImprintInstalledProgress) => void
): Promise<ImprintAllInstalledResult> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        await syncRunningGameModSnapshotFromMods(installed);

        // Pin legacy multi-VPK sibling order before any repack changes sizes.
        // Over ALL installed mods (not the candidate subset): an excluded
        // sibling still anchors its group's size order.
        freezeLegacyVpkIndexes(installed);

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
                    if (classifyEmbedFreshness(mod, meta) === 'fresh') {
                        // Current-format and in step with the sidecar: no repack.
                        // Self-heal the UI hint: the embed is the truth, but the
                        // flag may be missing (embed written by a build that did
                        // not persist it, or by another install). The flag drives
                        // the toolbar button visibility and the View imprint menu.
                        if (!meta?.imprinted) setModMetadata(mod.metaKey, { imprinted: true });
                        result.imprinted++;
                        return;
                    }
                    // Stale: never imprinted, legacy-only, or the sidecar moved
                    // after imprinting. Re-imprint refreshes the descriptive
                    // fields; identity + firstImprintedAt carry forward.
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
 *   3. already-imprinted       -> carries a CURRENT-format embed (modinfo.json)
 *                                 that is FRESH (refreshable fields match the
 *                                 sidecar). A legacy-only or stale embed
 *                                 classifies eligible: it IS pending work, the
 *                                 same way the bulk run treats it.
 *   4. anomalous               -> anomaly guard flagged it (skip + report).
 *   5. eligible                -> safe to imprint (includes stale re-imprints).
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

            // 3. Already carries a current-format embed that is still fresh.
            //    Stale (legacy-only or sidecar-drifted) falls through: the
            //    anomaly guard exempts valid embeds, so it lands in eligible.
            if (classifyEmbedFreshness(mod, meta) === 'fresh') {
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

/**
 * Startup reconcile: stamp `imprinted: true` for every installed VPK that
 * already carries a valid self-identifying embed but whose metadata entry lacks
 * the hint flag. The EMBED is the truth; the flag is a cheap projection the UI
 * keys on (toolbar button visibility, the View imprint context-menu entry), and
 * files imprinted by a build that never persisted the flag (the pre-rename era)
 * or by another install would otherwise read as un-imprinted forever: the bulk
 * modal classifies them already-imprinted, so with nothing eligible there is no
 * run that would ever self-heal them.
 *
 * Read-only toward the FILES (no repack, no hash writes: KEYSTONE untouched);
 * writes only the metadata hint. Cost is one cached VPK directory parse plus at
 * most one small entry read per unflagged mod, once: after stamping, later
 * startups skip flagged entries without touching the disk. Merged and
 * Locker-managed VPKs are stamped too when they carry an embed (the merge path
 * writes one), which is what lets View imprint work on merged mods.
 */
export async function backfillImprintedFlags(deadlockPath: string): Promise<number> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        let stamped = 0;
        for (const mod of installed) {
            if (getModMetadata(mod.metaKey)?.imprinted) continue;
            try {
                // Any imprint counts for the FLAG, legacy format included: a
                // legacy embed is stale (not current-format) but the file is
                // still self-identifying, and the flag is what the UI keys on.
                if (hasAnyImprint(mod.path)) {
                    setModMetadata(mod.metaKey, { imprinted: true });
                    stamped++;
                }
            } catch (err) {
                // Best-effort: an unreadable file just stays unflagged.
                console.warn(`[imprintMods] Imprint-flag backfill skipped ${mod.fileName}:`, err);
            }
        }
        return stamped;
    });
}
