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
    hasLegacyGrimoireMergeMetaEntry,
    reconstructMergedModInfoFromEmbed,
    reconstructMergedModInfoFromLegacy,
    ADDONINFO_ENTRY,
    MODINFO_ENTRY,
    LEGACY_GRIMOIRE_META_ENTRY,
    MODINFO_FORMAT,
    MODINFO_GAME,
    MODINFO_SCHEMA_VERSION,
    type AddonInfoFields,
    type ModinfoModRecord,
    type ModinfoMergeSource,
    type ReconstructedMergeManifest,
} from './modinfoFormat';
import { runVpkmerge, embedMergeIdentity, buildPortableForMergeSources } from './modMerger';
import { encodeShareCode } from './portableProfile';
import {
    evaluateEmbedStaleness,
    evaluateMergeEmbedStaleness,
    classifyMissingMergeManifest,
    gameBananaPageUrl,
    refreshableFieldsFromMetadata,
    refreshableMergeFieldsFromMetadata,
    refreshableMergeFieldsFromRecord,
    deriveAdoptionPatch,
    adoptionFieldsFromModRecord,
    adoptionFieldsFromLegacyAddonInfo,
    refreshableFieldsFromRecord,
    type AdoptionPatch,
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
    MergedModInfo,
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
 *  and preflight both classify through here so they can never diverge.
 *
 * A MERGED mod (`meta.merged` present) routes through the merge-record
 * comparison instead: a merge's refreshable data is the title plus the whole
 * source list, not the flat single-mod field set, so evaluateEmbedStaleness's
 * single-mod compare does not apply. A merged mod whose embed is not itself a
 * `kind: "merge"` record classifies stale too (never fresh): that shape only
 * happens on a file mid-migration from the legacy format, and re-imprinting
 * (which routes to the merge refresh path, never a flattening kind:"mod"
 * write) is exactly the pending work that clears it. */
function classifyEmbedFreshness(mod: Mod, meta: ModMetadata | undefined): 'fresh' | 'stale' {
    return classifyEmbedFreshnessAt(mod.path, mod.name, meta);
}

/**
 * classifyEmbedFreshness's actual implementation, keyed by a bare path + scan-
 * name fallback instead of a full scanned Mod. Exported so callers that
 * haven't scanned yet (import-custom-mod stamps imprinted/imprintStale for a
 * freshly-copied VPK before the post-copy scanMods runs) can classify against
 * the embed without waiting for a rescan, using the exact same rule bulk/
 * preflight/backfill all share.
 */
export function classifyEmbedFreshnessAt(
    path: string,
    fallbackName: string,
    meta: ModMetadata | undefined
): 'fresh' | 'stale' {
    if (meta?.merged) {
        const embedded = readEmbeddedModinfo(path);
        const embeddedMerge = embedded?.kind === 'merge' ? refreshableMergeFieldsFromRecord(embedded) : null;
        const current = refreshableMergeFieldsFromMetadata(meta.modName, meta.merged);
        return evaluateMergeEmbedStaleness(embeddedMerge, current).stale ? 'stale' : 'fresh';
    }
    const embedded = readEmbeddedModinfo(path);
    const current = refreshableFieldsFromMetadata(meta, fallbackName);
    return evaluateEmbedStaleness(embedded, current).stale ? 'stale' : 'fresh';
}

/**
 * Read whatever Grimoire embed `mod.path` carries (current-format modinfo.json
 * first, else the legacy addoninfo.txt keys) and project it onto
 * deriveAdoptionPatch's flat input shape. Returns null when the file carries
 * no recoverable Grimoire embed at all (a genuinely fresh local import), the
 * same "nothing to adopt from" signal deriveAdoptionPatch expects.
 *
 * A `kind: "merge"` embed returns null here too (NEVER FLATTEN's mirror image):
 * a merge's addoninfo.txt carries only its merge title + the fixed
 * MERGE_ADDON_AUTHOR label ("Multiple (merged)"), never a gamebananaId, but
 * leaking even that much through the legacy-shaped fallback below would stamp
 * a plain single-mod import's `author` field with a merge label if the user
 * ever re-imports an already-merged VPK as a "custom mod" (a raw copy, not
 * routed through recoverMergedModInfo the way the imprint bulk/preflight/
 * backfill paths are). Merges have their own recovery machinery
 * (classifyOrphanMerge/recoverMergedModInfo) for the paths that actually need
 * it; this flat single-mod adoption patch is never the right tool for a merge,
 * so it opts out at the read step rather than relying solely on every caller
 * remembering to check `!meta?.merged` first.
 */
export function readAdoptionEmbedFields(modPath: string): ReturnType<typeof adoptionFieldsFromModRecord> | null {
    const current = readEmbeddedModinfo(modPath);
    if (current) {
        return current.kind === 'mod' ? adoptionFieldsFromModRecord(refreshableFieldsFromRecord(current)) : null;
    }
    const legacyEmbed = readEmbeddedAddonInfo(modPath);
    if (legacyEmbed) {
        const carried = carryForwardOriginalIdentity(legacyEmbed, readLegacyGrimoireMergeMeta(modPath));
        // Only a RECOVERABLE Grimoire embed (current keys or the legacy shim)
        // counts as adoption material; a foreign addoninfo.txt has no basis for
        // trust and is handled elsewhere by the anomaly guard. A legacy MERGE
        // companion (hasLegacyGrimoireMergeMetaEntry) is excluded the same way
        // a current-format merge record is above.
        if (carried && !hasLegacyGrimoireMergeMetaEntry(modPath)) {
            return adoptionFieldsFromLegacyAddonInfo({
                title: legacyEmbed.title,
                author: legacyEmbed.author,
                gamebananaId: legacyEmbed.gamebananaId,
                gamebananaFileId: legacyEmbed.gamebananaFileId,
            });
        }
    }
    return null;
}

/**
 * Compute the adoption patch for a non-merged candidate: the fields its own
 * embed knows that the CURRENT sidecar (`meta`) does not. Shared by
 * imprintPreflight (classifies against this WITHOUT persisting) and
 * imprintAllInstalled's processOne (persists it before classifying), so the
 * two can never diverge on what adoption would do. Callers must have already
 * established `!meta?.merged` (or equivalent): this never inspects
 * meta.merged itself and always treats the candidate as a plain mod.
 */
function computeAdoptionPatch(mod: Mod, meta: ModMetadata | undefined): AdoptionPatch {
    return computeAdoptionPatchAt(mod.path, meta);
}

/**
 * computeAdoptionPatch's actual implementation, keyed by a bare path instead
 * of a scanned Mod. Exported for import-custom-mod (ipc/mods.ts), which needs
 * to adopt from a freshly-copied VPK's own embed before the post-copy
 * scanMods has run.
 */
export function computeAdoptionPatchAt(path: string, meta: ModMetadata | undefined): AdoptionPatch {
    const embed = readAdoptionEmbedFields(path);
    return deriveAdoptionPatch(embed, meta);
}

/** True when an AdoptionPatch has at least one field to apply. Exported for
 *  import-custom-mod, which needs the same "is there anything to merge" check
 *  before deciding whether to touch the freshly-stamped sidecar entry. */
export function hasAdoptionFields(patch: AdoptionPatch): boolean {
    return Object.keys(patch).length > 0;
}

/** In-memory merge of an adoption patch onto a sidecar snapshot, WITHOUT
 *  writing anything. imprintPreflight's whole contract is read-only, so it
 *  classifies against this hypothetical merge instead of calling
 *  setModMetadata like imprintAllInstalled's processOne does; both go through
 *  computeAdoptionPatch first, so what gets merged here is identical to what
 *  the bulk run would actually persist. */
function applyAdoptionPatch(
    meta: ModMetadata | undefined,
    patch: AdoptionPatch
): ModMetadata | undefined {
    if (!hasAdoptionFields(patch)) return meta;
    return { ...meta, ...patch };
}

/**
 * NEVER FLATTEN guard: decide what to do with a mod whose metadata sidecar has
 * NO `merged` entry but whose file (embed or legacy companion) says it IS a
 * merge. `meta.merged` being absent does not by itself mean "plain mod": a
 * DB wipe, or an orphan-metadata prune racing a merge, can drop the sidecar
 * entry while the file itself still carries the full source list. Re-imprinting
 * such a file as kind:"mod" would permanently destroy that list, so this is
 * checked BEFORE any single-mod imprint decision, for every candidate that
 * lacks meta.merged.
 *
 * Returns null when the mod looks like a genuine plain mod (classifyMissingMergeManifest
 * resolved to 'no-manifest-needed'): the caller proceeds with normal single-mod
 * handling. Otherwise returns the reconstructed manifest fields (never re-embeds
 * here; the caller's merge-refresh path does that) or the literal string
 * 'orphan-merge' when the file positively looks like an orphaned merge but no
 * source list could be read cleanly from either the embed or the legacy
 * companion (skip + report, per the anomaly guard's contract).
 */
function classifyOrphanMerge(mod: Mod): ReconstructedMergeManifest | 'orphan-merge' | null {
    const embedded = readEmbeddedModinfo(mod.path);
    const legacy = readLegacyGrimoireMergeMeta(mod.path);
    const embeddedKind = embedded?.kind ?? null;
    const outcome = classifyMissingMergeManifest(embeddedKind, !!legacy?.sources);

    if (outcome.kind === 'no-manifest-needed') return null;
    if (outcome.kind === 'reconstruct-from-embed') {
        // classifyMissingMergeManifest only returns this outcome when
        // embeddedKind === 'merge', so `embedded` is a ModinfoMergeRecord here.
        if (embedded?.kind !== 'merge') return 'orphan-merge';
        return reconstructMergedModInfoFromEmbed(embedded);
    }
    // 'reconstruct-from-legacy': only returned when legacy.sources is non-null.
    if (!legacy || !legacy.sources) return 'orphan-merge';
    return reconstructMergedModInfoFromLegacy(
        { ...legacy, sources: legacy.sources },
        mod.name,
        new Date().toISOString()
    );
}

/** Does this VPK carry ANY Grimoire imprint, current or legacy? Drives only
 *  the `imprinted` metadata flag (UI hint): a legacy embed still counts as
 *  imprinted for the flag even though it is stale format-wise. Exported for
 *  import-custom-mod (ipc/mods.ts), which needs this same any-embed check
 *  (including a `kind: "merge"` embed, which readAdoptionEmbedFields
 *  deliberately excludes) to stamp `imprinted` honestly for a re-imported
 *  already-imprinted file regardless of whether it happens to be a merge. */
export function hasAnyImprint(vpkPath: string): boolean {
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
 * present with an unchanged logical size (except an expected `--drop-entry`
 * removal), nothing added beyond the two imprint entries. A magic-bytes check
 * alone (verifyVpkOutput) would accept a structurally valid VPK that silently
 * dropped or corrupted game content. Any mismatch throws (landing in the
 * caller's fail-soft per-mod handling) and the original VPK keeps its slot.
 *
 * A single-mod imprint record fully supersedes the old grimoire-branded merge
 * companion (kind:"mod" never had one to begin with, but a file that started
 * life as a legacy MERGE and is being handled as a plain mod here should not
 * happen post-never-flatten; the check is defensive residue cleanup either
 * way): when the input still carries a legacy grimoire_meta.json entry, it is
 * passed to vpkmerge's `--drop-entry` so the residue is retired in the same
 * repack that writes its replacement.
 */
async function embedImprintInPlace(modPath: string, addonText: string, modinfoText: string): Promise<void> {
    const inputEntries = parseVpkEntryStats(modPath);
    if (!inputEntries) {
        throw new Error('Cannot verify the repack: the input VPK entry tree is unreadable.');
    }
    const addonTmp = join(tmpdir(), `grimoire-imprint-addoninfo-${randomUUID()}.txt`);
    const modinfoTmp = join(tmpdir(), `grimoire-imprint-modinfo-${randomUUID()}.json`);
    const embedOut = join(dirname(modPath), `.imprint-embed-${randomUUID()}.vpk`);
    const droppedEntries = hasLegacyGrimoireMergeMetaEntry(modPath) ? [LEGACY_GRIMOIRE_META_ENTRY] : [];
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
            ...droppedEntries.flatMap((entry) => ['--drop-entry', entry]),
        ]);
        const outputEntries = parseVpkEntryStats(embedOut);
        if (!outputEntries) {
            throw new Error('Imprint repack produced an unreadable VPK; the original was left untouched.');
        }
        const mismatch = findImprintRepackMismatch(inputEntries, outputEntries, droppedEntries);
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
        imprintStale: false,
        ...(hasValidStoredHash ? {} : { sha256: original.sha256 }),
    });
}

/**
 * Refresh a MERGED mod's embed in place (the merge counterpart of
 * imprintModCore). Re-embeds via the exact same pass-2 machinery
 * mergeModsLocked/extractMergeSourceLocked use (embedMergeIdentity), sourced
 * from `merged.sources` (the CURRENT metadata sidecar's manifest, which is
 * the authoritative source list; classifyEmbedFreshness already established
 * this needs a refresh). The identity triple and firstImprintedAt are carried
 * forward from whatever embed already exists (current or legacy shim) per the
 * KEYSTONE carry-forward rule; only a merge with NO prior embed at all
 * computes an original from the live bytes, exactly like a first single-mod
 * imprint.
 */
async function imprintMergeCore(mod: Mod, merged: MergedModInfo, modName: string | undefined): Promise<void> {
    const existingModinfo = readEmbeddedModinfo(mod.path);
    const existingEmbed = readEmbeddedAddonInfo(mod.path) ?? undefined;
    const original =
        carryForwardOriginalIdentity(existingEmbed, readLegacyGrimoireMergeMeta(mod.path)) ??
        (await computeOriginalIdentity(mod.path));
    const writtenAt = new Date().toISOString();
    const firstImprintedAt =
        existingModinfo?.firstImprintedAt ?? existingEmbed?.buildDate ?? writtenAt;
    const title = modName || merged.id;
    const sources: ModinfoMergeSource[] = merged.sources.map((s) => ({
        title: s.modName,
        identity: { sha256: s.sha256AtMergeTime },
        gamebananaId: s.gameBananaId,
        gamebananaFileId: s.gameBananaFileId,
        section: s.section,
        priorityAtMergeTime: s.priorityAtMergeTime,
        enabledAtMergeTime: s.enabledAtMergeTime,
        fileNameAtMergeTime: s.fileName,
        // vpkIndex is not tracked on MergedModSource (see the comment on
        // RefreshableMergeSourceFields in imprintStaleness.ts); a refresh
        // simply does not carry a per-source vpkIndex forward.
    }));
    await embedMergeIdentity(mod.path, title, writtenAt, original, sources, firstImprintedAt);
    setModMetadata(mod.metaKey, { imprinted: true, imprintStale: false });
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
 * not clobbered. NEVER FLATTEN applies here too: a merged mod (or an orphan
 * whose manifest gets recovered) routes through the merge-refresh path, never
 * a plain single-mod re-imprint that would clobber the source list. Returns
 * the post-imprint Mod.
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

        let meta = getModMetadata(mod.metaKey);
        if (!meta?.merged) {
            const orphan = classifyOrphanMerge(mod);
            if (orphan === 'orphan-merge') {
                throw new Error(`Refusing to imprint ${mod.fileName}: orphan-merge`);
            }
            if (orphan !== null) {
                recoverMergedModInfo(mod, orphan);
                meta = getModMetadata(mod.metaKey);
            }
        }

        const anomaly = await checkImprintAnomaly(mod);
        if (anomaly) {
            throw new Error(`Refusing to imprint ${mod.fileName}: ${anomaly}`);
        }
        if (meta?.merged) {
            await imprintMergeCore(mod, meta.merged, meta.modName);
        } else {
            await imprintModCore(mod);
        }
        // The imprint changes the file's bytes/size but not its name, so the id and
        // metaKey are stable; re-scan only to return up-to-date size/state.
        const rescanned = (await scanMods(deadlockPath)).find((m) => m.metaKey === mod.metaKey);
        return rescanned ?? mod;
    });
}

/**
 * Recover the metadata sidecar's `merged` entry for a mod that has none, by
 * reconstructing it from the file's own embed or legacy companion (NEVER
 * FLATTEN). Mints a fresh manifest id and regenerates the share code from the
 * recovered source list (neither travels inside the VPK); persists the
 * manifest to metadata immediately so classifyEmbedFreshness's merge path
 * (and every subsequent read of this mod this run) sees it. Returns the
 * restored `MergedModInfo`.
 */
function recoverMergedModInfo(mod: Mod, reconstructed: ReconstructedMergeManifest): MergedModInfo {
    const merged: MergedModInfo = {
        id: randomUUID(),
        createdAt: reconstructed.createdAt,
        shareCode: encodeShareCode(
            JSON.stringify(buildPortableForMergeSources(reconstructed.sources, reconstructed.modName))
        ),
        sources: reconstructed.sources,
    };
    setModMetadata(mod.metaKey, { modName: reconstructed.modName, merged });
    return merged;
}

/**
 * Retroactively imprint the whole installed library in place. Runs under the
 * mod-mutation lock; loaded mods are skipped and reported (never silently
 * failed), and per-mod failures are collected rather than aborting the batch.
 * Locker-managed artifacts (rebuilt automatically) are excluded, but merged
 * mods are NOT: a merge whose embed has gone stale (never migrated to the
 * current format, or its title/source list drifted from the sidecar) is
 * pending work like any other stale embed, and processOne routes it through
 * the merge-refresh path (imprintMergeCore) rather than a plain re-imprint,
 * so the richer kind:"merge" record is refreshed in place, never clobbered
 * with kind:"mod". Mods whose embed is current-format AND fresh (refreshable
 * fields still match the sidecar) are counted as imprinted without a
 * redundant re-pack; stale embeds (legacy-only, or the sidecar changed after
 * imprinting) are re-imprinted, which refreshes the descriptive fields and
 * migrates the format (identity + firstImprintedAt carried).
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
            if (meta.lockerCosmetics || meta.lockerSounds || meta.lockerColors || meta.lockerTrippySkins) {
                return false;
            }
            return true;
        });

        const result: ImprintAllInstalledResult = { imprinted: 0, skipped: [], failed: [] };
        const total = candidates.length;
        let done = 0;

        // Bounded worker pool: the dominant per-mod cost is the vpkmerge repack
        // subprocess in embedImprintInPlace, so overlapping several across cores
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
            let meta = getModMetadata(mod.metaKey);
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
                    // NEVER FLATTEN: no `merged` sidecar entry, but the file's own
                    // embed/legacy companion says it IS a merge. Recover the
                    // manifest (persisting it to metadata) before any freshness
                    // classification, since classifyEmbedFreshness's merge path
                    // reads meta.merged. An unreconstructable orphan is reported
                    // and skipped, never re-imprinted as a flattened kind:"mod".
                    if (!meta?.merged) {
                        const orphan = classifyOrphanMerge(mod);
                        if (orphan === 'orphan-merge') {
                            result.failed.push({ fileName: mod.fileName, modName, reason: 'orphan-merge' });
                            return;
                        }
                        if (orphan !== null) {
                            recoverMergedModInfo(mod, orphan);
                            meta = getModMetadata(mod.metaKey);
                        }
                    }

                    // ADOPTION: a non-merged candidate's own embed may know
                    // gamebananaId/author/category/etc. the sidecar doesn't (an
                    // imported already-imprinted orphan, or metadata loss). Persist
                    // the patch BEFORE classifying, synchronously (no await in
                    // between), so classifyEmbedFreshness compares the embed
                    // against the now-adopted sidecar, not the impoverished one -
                    // otherwise the embed would read as stale and the next line
                    // would re-imprint FROM the impoverished sidecar, destroying
                    // exactly the data adoption just recovered. imprintPreflight
                    // mirrors this via the same computeAdoptionPatch helper
                    // without writing, so the two can never diverge.
                    if (!meta?.merged) {
                        const adoptionPatch = computeAdoptionPatch(mod, meta);
                        if (hasAdoptionFields(adoptionPatch)) {
                            setModMetadata(mod.metaKey, adoptionPatch);
                            meta = getModMetadata(mod.metaKey);
                        }
                    }

                    if (classifyEmbedFreshness(mod, meta) === 'fresh') {
                        // Current-format and in step with the sidecar: no repack.
                        // Self-heal the UI hints: the embed is the truth, but the
                        // flag may be missing (embed written by a build that did
                        // not persist it, or by another install) or the stale hint
                        // may be lingering. They drive the toolbar button's pending
                        // count and the View imprint menu.
                        if (!meta?.imprinted || meta?.imprintStale) {
                            setModMetadata(mod.metaKey, { imprinted: true, imprintStale: false });
                        }
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
                    if (meta?.merged) {
                        await imprintMergeCore(mod, meta.merged, meta.modName);
                    } else {
                        await imprintModCore(mod);
                    }
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
 *   1. locker-managed          -> auto-managed (excluded from bulk imprint).
 *   1b. merged + FRESH         -> auto-managed (merge already reflects the
 *                                 sidecar; no repack pending).
 *   2. blocked-loaded          -> the running game has it memory-mapped.
 *   3. already-imprinted       -> carries a CURRENT-format embed (modinfo.json)
 *                                 that is FRESH (refreshable fields match the
 *                                 sidecar). A legacy-only or stale embed
 *                                 classifies eligible: it IS pending work, the
 *                                 same way the bulk run treats it. A merged
 *                                 mod whose embed is stale (never migrated, or
 *                                 the source list/title drifted) ALSO lands
 *                                 here: merged is no longer a blanket auto-
 *                                 managed exclusion, only a fresh merge is.
 *   4. anomalous               -> anomaly guard flagged it (skip + report),
 *                                 including 'orphan-merge': the sidecar has no
 *                                 `merged` entry but the file's own embed/
 *                                 legacy companion positively looks like an
 *                                 unreconstructable merge (NEVER FLATTEN).
 *   5. eligible                -> safe to imprint (includes stale re-imprints,
 *                                 merged or not).
 *
 * Ordering locker before already-imprinted matches imprintAllInstalled, which
 * excludes Locker-managed artifacts from its candidate set entirely (merged
 * mods are no longer excluded there either, mirroring this). Ordering
 * blocked-loaded before already-imprinted mirrors the bulk loop (loaded is
 * checked first, so a loaded-but-already-imprinted mod reports as loaded,
 * consistent across both). The anomaly guard never re-records any canonical
 * identity (KEYSTONE).
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

            // 1. Locker-managed: excluded from bulk imprint (rebuilt automatically).
            if (
                meta?.lockerCosmetics ||
                meta?.lockerSounds ||
                meta?.lockerColors ||
                meta?.lockerTrippySkins
            ) {
                result.counts.lockerManaged++;
                continue;
            }

            // 1b. Merged + fresh: auto-managed, no pending work. A merged mod
            // whose embed is STALE falls through (it is pending work, handled
            // by bucket 3 below, same shape as a stale single-mod embed).
            if (meta?.merged && classifyEmbedFreshness(mod, meta) === 'fresh') {
                result.counts.merged++;
                continue;
            }

            // 2. Loaded by the running game (a hard imprint refusal).
            if (isLoadedGameModLocked(mod)) {
                result.counts.blockedLoaded++;
                result.blockedLoaded.push({ fileName: mod.fileName, modName, reason: 'loaded' });
                continue;
            }

            // 3. Already carries a current-format embed that is still fresh
            //    (single mod; a fresh merge was already caught at 1b, so
            //    reaching here with meta.merged set means it was stale).
            //    Stale (legacy-only or sidecar-drifted) falls through: the
            //    anomaly guard exempts valid embeds, so it lands in eligible.
            //    ADOPTION: classify against (sidecar + hypothetical adoption
            //    patch), NEVER persisted here - preflight is read-only by
            //    contract. imprintAllInstalled's processOne computes the exact
            //    same patch via computeAdoptionPatch and actually writes it
            //    before classifying, so the two share one source of truth for
            //    what adoption would do and can never disagree about which
            //    bucket a mod lands in.
            const adoptedMeta = !meta?.merged ? applyAdoptionPatch(meta, computeAdoptionPatch(mod, meta)) : meta;
            if (!meta?.merged && classifyEmbedFreshness(mod, adoptedMeta) === 'fresh') {
                result.counts.alreadyImprinted++;
                continue;
            }

            // NEVER FLATTEN: no `merged` sidecar entry, but the file's own
            // embed/legacy companion says otherwise. Checked before the
            // anomaly guard so an unreconstructable orphan merge reports as
            // 'orphan-merge' specifically, not a generic anomaly reason.
            if (!meta?.merged) {
                const orphan = classifyOrphanMerge(mod);
                if (orphan === 'orphan-merge') {
                    result.counts.anomalous++;
                    result.anomalous.push({ fileName: mod.fileName, modName, reason: 'orphan-merge' });
                    continue;
                }
                // A reconstructable manifest (or null, a genuine plain mod)
                // both proceed to the normal anomaly guard + eligible bucket:
                // preflight never mutates metadata, so the reconstruction
                // itself happens only when the bulk run actually imprints.
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
 * Startup reconcile: keep the two metadata UI hints honest against the embed
 * truth for every installed VPK. `imprinted` marks any imprint at all (legacy
 * format included: the file is still self-identifying, and the flag gates the
 * View imprint menu); `imprintStale` marks pending re-imprint work (legacy
 * format, or refreshable fields drifted from the sidecar) and feeds the
 * toolbar button's pending count. Without this pass, files imprinted by a
 * build that never persisted the flag, or files whose staleness changed while
 * the app was closed, would mislead both surfaces indefinitely.
 *
 * Read-only toward the FILES (no repack, no hash writes: KEYSTONE untouched);
 * writes only the metadata hints, and only when they changed. Cost is one
 * cached VPK directory parse plus small entry reads per imprinted mod each
 * startup; the preflight modal remains the source of truth for what a bulk
 * run actually does.
 */
export async function backfillImprintedFlags(deadlockPath: string): Promise<number> {
    return runExclusiveModMutation(async () => {
        const installed = await scanMods(deadlockPath);
        let updated = 0;
        for (const mod of installed) {
            try {
                let meta = getModMetadata(mod.metaKey);
                if (!meta?.imprinted && !hasAnyImprint(mod.path)) continue;

                // ADOPTION: same fill-missing pass as the bulk run, so a mod
                // whose sidecar is impoverished relative to its own embed (an
                // imported orphan that was never routed through import-time
                // adoption, or older metadata loss) self-heals here too,
                // BEFORE the freshness check - otherwise it would read as
                // stale and stay that way until the next full bulk imprint.
                // Persisted only when non-empty (the existing only-write-when-
                // changed discipline extends naturally: an empty patch is a
                // no-op merge).
                if (!meta?.merged) {
                    const adoptionPatch = computeAdoptionPatch(mod, meta);
                    if (hasAdoptionFields(adoptionPatch)) {
                        setModMetadata(mod.metaKey, adoptionPatch);
                        meta = getModMetadata(mod.metaKey);
                        updated++;
                    }
                }

                const stale = classifyEmbedFreshness(mod, meta) === 'stale';
                if (meta?.imprinted !== true || (meta?.imprintStale ?? false) !== stale) {
                    setModMetadata(mod.metaKey, { imprinted: true, imprintStale: stale });
                    updated++;
                }
            } catch (err) {
                // Best-effort: an unreadable file just keeps its current hints.
                console.warn(`[imprintMods] Imprint-flag backfill skipped ${mod.fileName}:`, err);
            }
        }
        return updated;
    });
}
