import { promises as fs, existsSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { metaKeyFor } from './deadlock';
import { loadSettings } from './settings';
import {
    scanMods,
    disableModUnlocked,
    enableModUnlocked,
    allocateEnabledVpkPath,
    runExclusiveModMutation,
    type Mod,
} from './mods';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { resolveVpkIdentity, type OriginalIdentity } from './vpkIdentity';
import {
    computeOriginalIdentity,
    serializeAddonInfo,
    serializeModinfo,
    hasLegacyGrimoireMergeMetaEntry,
    ADDONINFO_ENTRY,
    MODINFO_ENTRY,
    LEGACY_GRIMOIRE_META_ENTRY,
    MODINFO_FORMAT,
    MODINFO_GAME,
    MODINFO_SCHEMA_VERSION,
    type ModinfoMergeRecord,
    type ModinfoMergeSource,
} from './modinfoFormat';
import { encodeShareCode } from './portableProfile';
import {
    assertCanMoveLoadedGameMod,
    assertCanMoveLoadedGameMods,
    syncRunningGameModSnapshotFromMods,
} from './gameSessionMods';
import {
    PORTABLE_PROFILE_FORMAT,
    PORTABLE_PROFILE_SCHEMA_VERSION,
    type PortableProfile,
    type PortableModEntry,
} from '../../../src/types/portableProfile';
import type {
    MergedModInfo,
    MergedModSource,
    UnmergeModResult,
    ExtractMergeSourceResult,
} from '../../../src/types/mod';

const DEADLOCK_STEAM_APP_ID = 1422450;
const DEADLOCK_GAMEBANANA_GAME_ID = 20948;

/** Verbose merge-lifecycle trace, gated on the same `verboseModTrace` setting as
 *  services/mods.ts. Merge/rebuild operations were previously silent, so an
 *  interrupted rebuild left a half-written manifest with no record of how it got
 *  that way. A `start` line with no matching `done` line localizes the crash. */
function mergeTrace(message: string): void {
    try {
        if (loadSettings().verboseModTrace) console.log(`[modTrace] ${message}`);
    } catch {
        /* never let tracing break a merge */
    }
}

/** Compact one-line render of a source list for the trace: each source's
 *  recorded fileName plus whether we captured the stable identities (gb id /
 *  sha) that the Installed-list hide logic needs to avoid a pakNN collision. */
function describeSources(sources: MergedModSource[]): string {
    return sources
        .map(
            (s) =>
                `${s.fileName}(${s.gameBananaId ? `gb=${s.gameBananaId}` : 'local'},${s.sha256AtMergeTime ? 'sha' : 'NO-sha'})`
        )
        .join(', ');
}

/** Source filenames recorded as a bare enabled slot (pakNN_dir.vpk). A finished
 *  merge rewrites these to the disabled free-form name; a leftover means the
 *  disable/rebuild loop was interrupted, and that recyclable name can later
 *  collide with an unrelated mod that lands in the slot. */
function stalePakSources(sources: MergedModSource[]): MergedModSource[] {
    return sources.filter((s) => /^pak\d+_dir\.vpk$/i.test(s.fileName));
}

type SupportedPlatform = 'linux-x64' | 'darwin-arm64' | 'win32-x64';

const VPKMERGE_BINARY_BY_PLATFORM: Record<SupportedPlatform, string> = {
    'linux-x64':    'vpkmerge-linux-x86_64',
    'darwin-arm64': 'vpkmerge-macos-aarch64',
    'win32-x64':    'vpkmerge-windows-x86_64.exe',
};

function firstExistingPath(paths: string[]): string | null {
    for (const path of paths) {
        if (existsSync(path)) return path;
    }
    return null;
}

function devVpkmergeBinaryPath(): string | null {
    const explicit = process.env['VPKMERGE_BINARY'];
    if (explicit && existsSync(explicit)) return explicit;

    const repoRoot = app.getAppPath();
    const siblingRoot = resolve(repoRoot, '..', 'vpkmerge', 'target');
    const exeName = process.platform === 'win32' ? 'vpkmerge.exe' : 'vpkmerge';
    return firstExistingPath([
        join(siblingRoot, 'release', exeName),
        join(siblingRoot, 'debug', exeName),
    ]);
}

/**
 * Resolve the bundled vpkmerge binary path. In dev the binary lives under
 * the repo's resources/; in a packaged build electron-builder's
 * extraResources places it at process.resourcesPath/vpkmerge/.
 */
export function vpkmergeBinaryPath(): string {
    if (!app.isPackaged) {
        const local = devVpkmergeBinaryPath();
        if (local) return local;
    }

    const key = `${process.platform}-${process.arch}` as SupportedPlatform;
    const assetName = VPKMERGE_BINARY_BY_PLATFORM[key];
    if (!assetName) {
        throw new Error(
            `Mod merging is not available on ${process.platform}-${process.arch}. Supported: linux x64, macOS arm64, Windows x64.`
        );
    }
    const baseDir = app.isPackaged
        ? join(process.resourcesPath, 'vpkmerge')
        : join(app.getAppPath(), 'resources', 'vpkmerge');
    const full = join(baseDir, assetName);
    if (!existsSync(full)) {
        throw new Error(
            `vpkmerge binary missing at ${full}. Run \`pnpm install\` (or \`pnpm fetch-vpkmerge\`) to fetch it.`
        );
    }
    return full;
}

export function runVpkmerge(args: string[], timeoutMs = 300000): Promise<void> {
    return new Promise((resolve, reject) => {
        const bin = vpkmergeBinaryPath();
        const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        let killed = false;

        const timeoutId = setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
            setTimeout(() => {
                if (!proc.killed) proc.kill('SIGKILL');
            }, 5000);
            reject(new Error(`vpkmerge timed out after ${timeoutMs / 1000} seconds`));
        }, timeoutMs);

        proc.stdout?.on('data', (d) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (killed) return;
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`vpkmerge exited with code ${code}: ${stderr || stdout || '(no output)'}`));
            }
        });
        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            if (killed) return;
            reject(new Error(`Failed to spawn vpkmerge: ${err.message}`));
        });
    });
}

/**
 * Like runVpkmerge but resolves with the process stdout. Used by the soundevents
 * decode (`soundevents <entry> --from-vpk <vpk>`), which prints JSON to stdout
 * and a human summary to stderr.
 */
export function runVpkmergeStdout(args: string[], timeoutMs = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
        const bin = vpkmergeBinaryPath();
        const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        let killed = false;

        const timeoutId = setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
            setTimeout(() => {
                if (!proc.killed) proc.kill('SIGKILL');
            }, 5000);
            reject(new Error(`vpkmerge timed out after ${timeoutMs / 1000} seconds`));
        }, timeoutMs);

        proc.stdout?.on('data', (d) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (killed) return;
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`vpkmerge exited with code ${code}: ${stderr || stdout || '(no output)'}`));
            }
        });
        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            if (killed) return;
            reject(new Error(`Failed to spawn vpkmerge: ${err.message}`));
        });
    });
}

/** Valve Pak v1/v2 magic: little-endian 0x55aa1234 at file offset 0. */
const VPK_MAGIC = 0x55aa1234;

/**
 * Sanity-check vpkmerge's output before we stamp metadata onto it. A
 * non-zero exit code from vpkmerge does not, on its own, prove the output
 * is a real VPK: catches truncated writes, empty files, and any future
 * vpkmerge bug that exits 0 with junk on disk.
 */
export async function verifyVpkOutput(path: string): Promise<void> {
    const stats = await fs.stat(path);
    if (stats.size < 4) {
        throw new Error(`vpkmerge output is too small to be a VPK (${stats.size} bytes).`);
    }
    const fh = await fs.open(path, 'r');
    try {
        const buf = Buffer.alloc(4);
        await fh.read(buf, 0, 4, 0);
        const magic = buf.readUInt32LE(0);
        if (magic !== VPK_MAGIC) {
            throw new Error(
                `vpkmerge output is not a valid VPK (magic 0x${magic.toString(16).padStart(8, '0')}, expected 0x55aa1234).`
            );
        }
    } finally {
        await fh.close();
    }
}

/** Author string stamped into a merged VPK's embedded addoninfo.txt (a merge
 *  has many real authors, so there is no single one). */
const MERGE_ADDON_AUTHOR = 'Multiple (merged)';

/**
 * Embed the self-identifying vpk-modinfo entries into an already-merged VPK
 * (path A, see docs/vpk-metadata-embed-integration.md). Serializes
 * `addoninfo.txt` (carrying the merge's canonical-identity triple) and
 * `modinfo.json` (the kind:"merge" machine record with the source list),
 * writes both to temp files, and runs a vpkmerge `--extra-file` pass that
 * re-packs the merged VPK with the two blobs embedded at its root, then
 * atomically swaps it into place. A DB-wiped Grimoire reads the record back
 * to repopulate the merged-mod metadata and drive unmerge / extractMergeSource.
 *
 * `original` is the merged output's identity captured from the PRE-EMBED bytes
 * (the spec's option (a)): it is the stable self-identity stored in metadata,
 * addoninfo, and modinfo alike, and is never re-derived from the post-embed
 * file.
 *
 * Exported so imprintMods.ts's merge-refresh path (a merged mod's embed gone
 * stale, or the identity carried forward from an existing embed rather than
 * freshly captured) can reuse the exact same pass-2 machinery mergeModsLocked
 * and extractMergeSourceLocked use, rather than re-deriving a second embed
 * writer with its own bugs.
 *
 * `firstImprintedAt` defaults to `createdAt` when omitted, which is exactly
 * right for a brand-new merge (mergeModsLocked) or a from-scratch rebuild
 * (extractMergeSourceLocked): the merge output never existed before, so its
 * first and current imprint are the same moment. A re-imprint of an EXISTING
 * merge (imprintMods.ts's merge refresh) passes the carried-forward value
 * explicitly, per the KEYSTONE carry-forward rule: firstImprintedAt must
 * never advance on a refresh, only writtenAt does.
 */
export async function embedMergeIdentity(
    mergedPath: string,
    title: string,
    createdAt: string,
    original: OriginalIdentity,
    sources: ModinfoMergeSource[],
    firstImprintedAt: string = createdAt
): Promise<void> {
    const addonText = serializeAddonInfo({
        title,
        author: MERGE_ADDON_AUTHOR,
        buildDate: createdAt,
        originalSha256: original.sha256,
        originalSize: original.size,
        originalCrc32: original.crc32,
    });
    const record: ModinfoMergeRecord = {
        format: MODINFO_FORMAT,
        schemaVersion: MODINFO_SCHEMA_VERSION,
        kind: 'merge',
        writtenBy: { tool: 'grimoire', version: app.getVersion() },
        writtenAt: createdAt,
        firstImprintedAt,
        game: MODINFO_GAME,
        identity: { sha256: original.sha256, size: original.size, crc32: original.crc32 },
        title,
        author: MERGE_ADDON_AUTHOR,
        merge: { title },
        sources,
    };
    const metaText = serializeModinfo(record);

    const addonTmp = join(tmpdir(), `grimoire-addoninfo-${randomUUID()}.txt`);
    const metaTmp = join(tmpdir(), `grimoire-modinfo-${randomUUID()}.json`);
    // Build the embed output as a dotfile in the merged mod's OWN folder (a
    // non-`_dir.vpk` name, so it is neither scanned as a mod nor counted as a
    // slot), then swap it over the original. Same-folder keeps the rename on one
    // volume (no cross-device EXDEV), exactly like extractMergeSource's rebuild.
    const embedOut = join(dirname(mergedPath), `.merge-embed-${randomUUID()}.vpk`);

    try {
        await fs.writeFile(addonTmp, addonText);
        await fs.writeFile(metaTmp, metaText);
        // The new merge record lives entirely in modinfo.json, so a legacy
        // grimoire_meta.json companion (pre-redo files) is superseded, not
        // merely shadowed: drop it in the same repack rather than leaving
        // residue an old reader might still trust.
        const dropLegacyMeta = hasLegacyGrimoireMergeMetaEntry(mergedPath);
        await runVpkmerge([
            'metadata',
            '--vpk',
            mergedPath,
            '--output',
            embedOut,
            '--extra-file',
            `${ADDONINFO_ENTRY}=${addonTmp}`,
            '--extra-file',
            `${MODINFO_ENTRY}=${metaTmp}`,
            ...(dropLegacyMeta ? ['--drop-entry', LEGACY_GRIMOIRE_META_ENTRY] : []),
        ]);
        await verifyVpkOutput(embedOut);
        // Atomic replace (rename over the existing file, the metadata.ts write
        // idiom): either the embedded VPK fully takes the slot or, if the rename
        // fails, the original un-embedded merged VPK is left untouched. Avoids a
        // window where the merged slot is missing on disk.
        await fs.rename(embedOut, mergedPath);
    } catch (err) {
        try { await fs.unlink(embedOut); } catch { /* ignore partial-output cleanup */ }
        throw err;
    } finally {
        try { await fs.unlink(addonTmp); } catch { /* best-effort temp cleanup */ }
        try { await fs.unlink(metaTmp); } catch { /* best-effort temp cleanup */ }
    }
}

/**
 * Extract a hero's ability-VFX layer from a skin VPK into a standalone addon
 * VPK via `vpkmerge split`, routing only the ability/weapon_fx particle dirs
 * (`prefixes` from detectVfxLayer in vpk.ts) and dropping everything else (no
 * residual). The result overrides the base particles in-place, so it can be
 * layered onto a different body skin. Pass the prefixes from a non-null
 * detectVfxLayer() result; an empty/non-matching set yields a useless VPK.
 */
export async function extractVfxLayer(
    srcVpkPath: string,
    outVpkPath: string,
    prefixes: string[]
): Promise<void> {
    if (prefixes.length === 0) {
        throw new Error('No VFX prefixes to extract.');
    }
    // `split` writes each output to the path named INSIDE the plan, so the
    // destination lives in the plan JSON rather than argv. With no residual,
    // unmatched entries (body model, dragon material, shared masks) are dropped.
    await fs.mkdir(dirname(outVpkPath), { recursive: true });
    const plan = { outputs: [{ path: outVpkPath, prefixes }] };
    const planPath = join(tmpdir(), `grimoire-vfx-split-${randomUUID()}.json`);
    await fs.writeFile(planPath, JSON.stringify(plan));
    try {
        await runVpkmerge(['split', srcVpkPath, '--plan', planPath]);
        await verifyVpkOutput(outVpkPath);
    } finally {
        try { await fs.unlink(planPath); } catch { /* best-effort temp cleanup */ }
    }
}

/**
 * Exclusively create an empty file at `path` so the priority slot is
 * reserved on disk before we hand it to vpkmerge. Closes the TOCTOU
 * window between slot allocation (allocateEnabledVpkPath) and runVpkmerge()
 * where a concurrent download or 1-Click install could otherwise claim the slot.
 * Throws a friendly error if the slot was lost to a race.
 */
export async function reserveOutputSlot(path: string): Promise<void> {
    try {
        const fd = await fs.open(path, 'wx');
        await fd.close();
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
            throw new Error(
                `Cannot create merged mod: ${path.split(/[\\/]/).pop()} was claimed by another operation. Try again.`
            );
        }
        throw err;
    }
}

export interface MergeOptions {
    name: string;
    /** PNG/JPEG data URL for the collage thumbnail. Generated by the renderer
     *  from the source mod thumbnails. */
    thumbnailDataUrl?: string;
    /** Pass --strict to vpkmerge so any file-path collision aborts the merge
     *  instead of silently picking a winner. Off by default to match Deadlock's
     *  runtime model, where the LOWER pakNN wins a file collision. */
    strict?: boolean;
}

export interface MergeResult {
    mod: Mod;
    disabledSources: Mod[];
}

export async function mergeMods(
    deadlockPath: string,
    modIds: string[],
    options: MergeOptions
): Promise<MergeResult> {
    const trimmedName = options.name.trim();
    if (!trimmedName) throw new Error('A name is required for the merged mod.');
    if (modIds.length < 2) throw new Error('Select at least two mods to merge.');

    return runExclusiveModMutation(() => mergeModsLocked(deadlockPath, modIds, options, trimmedName));
}

async function mergeModsLocked(
    deadlockPath: string,
    modIds: string[],
    options: MergeOptions,
    trimmedName: string
): Promise<MergeResult> {
    const installed = await scanMods(deadlockPath);
    await syncRunningGameModSnapshotFromMods(installed);
    const sources: Mod[] = [];
    for (const id of modIds) {
        const found = installed.find((m) => m.id === id);
        if (!found) throw new Error(`Selected mod not found (id: ${id}).`);
        const meta = getModMetadata(found.metaKey);
        if (meta?.merged) {
            throw new Error(
                `"${meta.modName || found.name}" is already a merged mod. Unmerge it first.`
            );
        }
        sources.push(found);
    }
    assertCanMoveLoadedGameMods(sources.filter((source) => source.enabled));

    // In Deadlock a LOWER pakNN wins a file collision (pak09 overrides pak10),
    // so the lowest-pakNN source is the highest priority. vpkmerge is
    // last-input-wins, so sort DESCENDING to put that highest-priority
    // (lowest-pakNN) source LAST in the argv and reproduce the in-game winner.
    sources.sort((a, b) => b.priority - a.priority);

    mergeTrace(
        `merge start "${trimmedName}": ${sources.length} sources -> ${sources
            .map((s) => `${s.fileName}(pri ${s.priority}${s.enabled ? '' : ',disabled'})`)
            .join(', ')}`
    );

    // Hash every source BEFORE any filesystem mutation. sha256AtMergeTime
    // is the content-identity fallback unmerge uses when the manifest
    // fileName lookup misses (file renamed by reconcile, partial-disable
    // recovery, etc). Parallel because the files are independent.
    const sourceHashes = await Promise.all(
        sources.map((src) => resolveVpkIdentity(src.path).then((id) => id.sha256))
    );

    const portable = buildPortableForSources(sources, trimmedName);
    const shareCode = encodeShareCode(JSON.stringify(portable));

    // The merged VPK installs ENABLED, so reserve a slot via the overflow-aware
    // allocator: it fills base addons first and spills into an overflow folder
    // (creating one + patching gameinfo) when base is full, so a merge still
    // works for a >99 user whose citadel/addons is already saturated. The
    // metadata key is the destination's metaKey (folder-prefixed for overflow).
    const mergedPath = await allocateEnabledVpkPath(deadlockPath);
    const mergedMetaKey = metaKeyFor(mergedPath);

    // Reserve the slot on disk before spawning vpkmerge so a concurrent
    // download or 1-Click install can't claim it mid-spawn. wx errors with
    // EEXIST if anything else got there first.
    await reserveOutputSlot(mergedPath);

    const args: string[] = [];
    if (options.strict) args.push('--strict');
    args.push(mergedPath);
    for (const src of sources) args.push(src.path);

    try {
        await runVpkmerge(args);
        await verifyVpkOutput(mergedPath);
    } catch (err) {
        try { await fs.unlink(mergedPath); } catch { /* ignore partial-output cleanup */ }
        throw err;
    }

    // Capture the merged output's canonical identity from its PRE-EMBED bytes.
    // A merged VPK never existed before, so its "original" is the hash of the
    // freshly-merged-but-not-yet-embedded output. This is the spec's option (a)
    // (two passes: merge -> hash -> embed) chosen for a stable self-identity
    // that does not depend on re-deriving a hash from the post-embed file. The
    // same value is stored as metadata.sha256 AND inside addoninfo.txt /
    // grimoire_meta.json, so resolveVpkIdentity returns it whether or not the
    // embed pass below succeeds (the un-embedded file's live hash equals it too).
    const mergedOriginal = await computeOriginalIdentity(mergedPath);
    const sha256 = mergedOriginal.sha256;

    // Each source's stamped vpkIndex, captured BEFORE the disable loop renames
    // files (and migrates their metadata keys). Embedded into the modinfo
    // record's source list so a shared profile can rebind multi-VPK variants.
    const sourceVpkIndexes = sources.map((src) => getModMetadata(src.metaKey)?.vpkIndex);

    const preDisableSnapshot: MergedModSource[] = sources.map((src, i) => {
        const meta = getModMetadata(src.metaKey);
        return {
            fileName: src.fileName,
            modName: meta?.modName || src.name,
            thumbnailUrl: meta?.thumbnailUrl,
            gameBananaId: meta?.gameBananaId,
            gameBananaFileId: meta?.gameBananaFileId,
            section: meta?.sourceSection,
            enabledAtMergeTime: src.enabled,
            priorityAtMergeTime: src.priority,
            sha256AtMergeTime: sourceHashes[i],
        };
    });

    const merged: MergedModInfo = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        shareCode,
        sources: preDisableSnapshot,
    };

    // Stamp the metadata BEFORE the disable loop. If disable fails partway
    // through, the manifest still points at every source by sha256 and
    // unmerge can find them whether they're enabled or disabled. The
    // fileName fields here are pre-disable; they're updated after each
    // successful disable so the contents-modal UI shows the actual on-disk
    // name. Scrub any orphan metadata from a prior occupant first.
    removeModMetadata(mergedMetaKey);
    setModMetadata(mergedMetaKey, {
        modName: trimmedName,
        thumbnailUrl: options.thumbnailDataUrl,
        sha256,
        merged,
    });

    // Disable each enabled source so its priority slot frees up and the
    // engine stops loading the original. The disable helper returns the
    // post-move Mod so we record the actual on-disk filename (it may have been
    // renamed by reconcileEnabledDisabledCollisions). We re-stamp the
    // manifest after each successful disable so a mid-loop failure leaves
    // the manifest as up-to-date as it can be: sources processed already
    // have their post-disable fileName, the rest fall back to sha256.
    const disabledSources: Mod[] = [];
    for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (src.enabled) {
            const after = await disableModUnlocked(deadlockPath, src.id);
            disabledSources.push(after);
            preDisableSnapshot[i].fileName = after.fileName;
            setModMetadata(mergedMetaKey, {
                modName: trimmedName,
                thumbnailUrl: options.thumbnailDataUrl,
                sha256,
                merged: { ...merged, sources: preDisableSnapshot },
            });
        } else {
            disabledSources.push(src);
        }
    }

    const stale = stalePakSources(preDisableSnapshot);
    if (stale.length > 0) {
        mergeTrace(
            `merge WARNING "${trimmedName}": ${stale.length} source(s) still recorded under a recyclable pakNN name (${stale
                .map((s) => s.fileName)
                .join(', ')}) -> a future slot reuse can collide with merge-source reconciliation`
        );
    }
    mergeTrace(`merge done "${trimmedName}" key=${mergedMetaKey} sources: ${describeSources(preDisableSnapshot)}`);

    // Pass 2: embed the self-identifying addoninfo.txt + modinfo.json into
    // the merged VPK. Done AFTER the disable loop so the recorded source
    // fileNames match the metadata manifest's final (post-disable) names. The
    // merge itself already succeeded; a failed embed only costs the self-
    // describing metadata, never the merged mod, and metadata.sha256 stays
    // correct (it equals the un-embedded file's live hash), so on failure we
    // log and keep the un-embedded merged VPK rather than unwinding the merge.
    try {
        await embedMergeIdentity(
            mergedPath,
            trimmedName,
            merged.createdAt,
            mergedOriginal,
            preDisableSnapshot.map((s, i) => ({
                title: s.modName,
                identity: { sha256: s.sha256AtMergeTime },
                gamebananaId: s.gameBananaId,
                gamebananaFileId: s.gameBananaFileId,
                section: s.section,
                priorityAtMergeTime: s.priorityAtMergeTime,
                enabledAtMergeTime: s.enabledAtMergeTime,
                fileNameAtMergeTime: s.fileName,
                vpkIndex: sourceVpkIndexes[i],
            }))
        );
        await verifyVpkOutput(mergedPath);
        mergeTrace(`merge embed done "${trimmedName}" key=${mergedMetaKey}`);
    } catch (err) {
        mergeTrace(`merge WARNING "${trimmedName}": embed pass failed: ${String(err)} (merged mod left un-embedded)`);
        console.warn(`[modMerger] Failed to embed identity into merged VPK ${mergedPath}:`, err);
    }

    const finalMods = await scanMods(deadlockPath);
    const newMod = finalMods.find((m) => m.metaKey === mergedMetaKey);
    if (!newMod) {
        throw new Error('Merged mod was created on disk but could not be located in the rescan.');
    }
    return { mod: newMod, disabledSources };
}

function buildPortableForSources(sources: Mod[], profileName: string): PortableProfile {
    const entries: MergedModSource[] = sources.map((src) => {
        const meta = getModMetadata(src.metaKey);
        return {
            fileName: src.fileName,
            modName: meta?.modName || src.name,
            thumbnailUrl: meta?.thumbnailUrl,
            gameBananaId: meta?.gameBananaId ?? src.gameBananaId,
            gameBananaFileId: meta?.gameBananaFileId ?? src.gameBananaFileId,
            section: meta?.sourceSection,
            enabledAtMergeTime: true,
            priorityAtMergeTime: src.priority,
        };
    });
    return buildPortableForMergeSources(entries, profileName);
}

/**
 * Build a portable profile (the unmerge-fallback share code payload) straight
 * from a merge's own source snapshots, with no live Mod/metadata lookup. Pure
 * projection of MergedModSource -> PortableModEntry: every field this reads
 * already lives on the snapshot, which is what lets it double as the DB-wipe
 * reconstruction path (see reconstructMergedModInfo/imprintMods.ts) where the
 * sources come from an embedded modinfo.json or legacy grimoire_meta.json
 * record, not a live scan. Local sources (no GameBanana id) are omitted, same
 * as buildPortableForSources: the share code is best-effort, not authoritative
 * (the merge's own metadata.merged manifest is authoritative for unmerge).
 */
export function buildPortableForMergeSources(
    sources: MergedModSource[],
    profileName: string
): PortableProfile {
    const mods: PortableModEntry[] = [];
    for (const src of sources) {
        if (!src.gameBananaId || !src.gameBananaFileId) continue; // local mod: fast-path unmerge still works
        mods.push({
            source: 'gamebanana',
            ref: {
                submissionId: src.gameBananaId,
                fileId: src.gameBananaFileId,
                section: src.section || 'Mod',
            },
            enabled: true,
            priority: src.priorityAtMergeTime,
            hint: {
                name: src.modName,
                thumbnailUrl: src.thumbnailUrl,
            },
        });
    }
    return {
        format: PORTABLE_PROFILE_FORMAT,
        schemaVersion: PORTABLE_PROFILE_SCHEMA_VERSION,
        game: {
            steamAppId: DEADLOCK_STEAM_APP_ID,
            gameBananaGameId: DEADLOCK_GAMEBANANA_GAME_ID,
            name: 'Deadlock',
        },
        exportedAt: new Date().toISOString(),
        exportedBy: { tool: 'grimoire', version: app.getVersion() },
        profile: { name: profileName },
        mods,
    };
}

interface SourceLocator {
    /** Find a manifest source on disk and mark it consumed so a later lookup
     *  can't claim the same file. Returns undefined when nothing matches. */
    locate(src: MergedModSource): Promise<Mod | undefined>;
}

/**
 * Build a one-shot locator that maps merged-mod manifest entries back to the
 * VPKs still on disk. Resolution order per source: disabled folder by exact
 * fileName, then a sha256 content match in the disabled folder (covers a
 * reconcile rename), then a sha256 match in the enabled folder (covers a
 * partial-disable or a user re-enable). Each on-disk file is claimed at most
 * once. Hashes are cached and prefer the metadata-recorded sha256 over a fresh
 * fingerprint. `candidates` should exclude the merged mod itself.
 */
function makeSourceLocator(candidates: Mod[]): SourceLocator {
    const disabledCandidates = candidates.filter((m) => !m.enabled);
    const enabledCandidates = candidates.filter((m) => m.enabled);

    const hashCache = new Map<string, string>();
    const getHash = async (mod: Mod): Promise<string> => {
        const cached = hashCache.get(mod.metaKey);
        if (cached) return cached;
        const fromMeta = getModMetadata(mod.metaKey)?.sha256;
        if (fromMeta) {
            const lower = fromMeta.toLowerCase();
            hashCache.set(mod.metaKey, lower);
            return lower;
        }
        const id = await resolveVpkIdentity(mod.path);
        const lower = id.sha256.toLowerCase();
        hashCache.set(mod.metaKey, lower);
        return lower;
    };

    const consumedIds = new Set<string>();

    const matchBySha = async (pool: Mod[], wanted: string): Promise<Mod | undefined> => {
        for (const m of pool) {
            if (consumedIds.has(m.id)) continue;
            if ((await getHash(m)) === wanted) return m;
        }
        return undefined;
    };

    return {
        async locate(src: MergedModSource): Promise<Mod | undefined> {
            let onDisk: Mod | undefined = disabledCandidates.find(
                (m) => !consumedIds.has(m.id) && m.fileName === src.fileName
            );
            if (!onDisk && src.sha256AtMergeTime) {
                const wanted = src.sha256AtMergeTime.toLowerCase();
                onDisk = (await matchBySha(disabledCandidates, wanted))
                    ?? (await matchBySha(enabledCandidates, wanted));
            }
            if (onDisk) consumedIds.add(onDisk.id);
            return onDisk;
        },
    };
}

/**
 * Reverse a merge: re-enable the source VPKs (if they're still on disk) and
 * delete the merged VPK. Sources that are missing are reported via
 * missingSourceFileNames so the caller can offer the share code via the
 * existing portable-profile import flow.
 */
export async function unmergeMod(
    deadlockPath: string,
    mergedModId: string
): Promise<UnmergeModResult> {
    return runExclusiveModMutation(() => unmergeModLocked(deadlockPath, mergedModId));
}

async function unmergeModLocked(
    deadlockPath: string,
    mergedModId: string
): Promise<UnmergeModResult> {
    const installed = await scanMods(deadlockPath);
    await syncRunningGameModSnapshotFromMods(installed);
    const target = installed.find((m) => m.id === mergedModId);
    if (!target) throw new Error(`Merged mod not found (id: ${mergedModId}).`);

    const meta = getModMetadata(target.metaKey);
    if (!meta?.merged) {
        throw new Error(`"${meta?.modName || target.name}" is not a merged mod.`);
    }
    assertCanMoveLoadedGameMod(target);
    const manifest = meta.merged;

    // Recover each source from disk via the shared locator (disabled folder by
    // fileName, then a content-hash fallback, then the enabled folder). The
    // merged mod itself is excluded so it can't be misidentified as a source.
    const locator = makeSourceLocator(installed.filter((m) => m.id !== target.id));
    const recovered: Mod[] = [];
    const missingSourceFileNames: string[] = [];

    for (const src of manifest.sources) {
        const onDisk = await locator.locate(src);
        if (!onDisk) {
            missingSourceFileNames.push(src.fileName);
            continue;
        }
        if (src.enabledAtMergeTime && !onDisk.enabled) {
            recovered.push(await enableModUnlocked(deadlockPath, onDisk.id));
        } else {
            recovered.push(onDisk);
        }
    }

    await fs.unlink(target.path);
    removeModMetadata(target.metaKey);

    return {
        recovered,
        missingSourceFileNames,
        shareCode: manifest.shareCode,
    };
}

/**
 * Pull a single source VPK out of a merged mod and restore it as a standalone
 * mod, without dissolving the whole merge. The remaining sources are re-merged
 * into a fresh VPK that reclaims the original's load-order slot, so the merge
 * keeps its priority.
 *
 * When extracting would leave fewer than two sources behind, a "merge of one"
 * is meaningless, so the merge collapses: the lone survivor is restored too and
 * the merged VPK is deleted (a normal full unmerge for what's left).
 */
export async function extractMergeSource(
    deadlockPath: string,
    mergedModId: string,
    sourceFileName: string
): Promise<ExtractMergeSourceResult> {
    return runExclusiveModMutation(() =>
        extractMergeSourceLocked(deadlockPath, mergedModId, sourceFileName)
    );
}

async function extractMergeSourceLocked(
    deadlockPath: string,
    mergedModId: string,
    sourceFileName: string
): Promise<ExtractMergeSourceResult> {
    const installed = await scanMods(deadlockPath);
    await syncRunningGameModSnapshotFromMods(installed);
    const target = installed.find((m) => m.id === mergedModId);
    if (!target) throw new Error(`Merged mod not found (id: ${mergedModId}).`);

    const meta = getModMetadata(target.metaKey);
    if (!meta?.merged) {
        throw new Error(`"${meta?.modName || target.name}" is not a merged mod.`);
    }
    assertCanMoveLoadedGameMod(target);
    const manifest = meta.merged;

    const removedSnapshot = manifest.sources.find((s) => s.fileName === sourceFileName);
    if (!removedSnapshot) {
        throw new Error(`"${sourceFileName}" is not a source of this merge.`);
    }
    const remainingSnapshots = manifest.sources.filter((s) => s.fileName !== sourceFileName);

    const locator = makeSourceLocator(installed.filter((m) => m.id !== target.id));

    // Locate the source being extracted first so it can't be claimed as one of
    // the remaining sources. Missing-on-disk is tolerated: its content drops
    // from the rebuild regardless, there's just nothing left to restore.
    const removedOnDisk = await locator.locate(removedSnapshot);

    const restored: Mod[] = [];

    // Restore the extracted source to its pre-merge enabled state. Deferred
    // until after the rebuild/collapse so the slot math below sees a stable
    // disabled set.
    const restoreExtracted = async (): Promise<void> => {
        if (!removedOnDisk) return;
        if (removedSnapshot.enabledAtMergeTime && !removedOnDisk.enabled) {
            restored.push(await enableModUnlocked(deadlockPath, removedOnDisk.id));
        } else {
            restored.push(removedOnDisk);
        }
    };

    // ---- Collapse: fewer than two sources would remain, so fully unmerge. ----
    if (remainingSnapshots.length < 2) {
        const survivor = remainingSnapshots[0];
        if (survivor) {
            const onDisk = await locator.locate(survivor);
            if (onDisk) {
                if (survivor.enabledAtMergeTime && !onDisk.enabled) {
                    restored.push(await enableModUnlocked(deadlockPath, onDisk.id));
                } else {
                    restored.push(onDisk);
                }
            }
        }
        await fs.unlink(target.path);
        removeModMetadata(target.metaKey);
        await restoreExtracted();
        return { collapsed: true, merged: null, restored };
    }

    // ---- Rebuild: re-merge the remaining sources into a fresh VPK. ----
    // Every remaining source must be present on disk to faithfully reproduce
    // the merge; refuse rather than silently dropping a source's content.
    const remainingOnDisk: Mod[] = [];
    const missing: string[] = [];
    for (const snap of remainingSnapshots) {
        const onDisk = await locator.locate(snap);
        if (onDisk) remainingOnDisk.push(onDisk);
        else missing.push(snap.modName || snap.fileName);
    }
    if (missing.length > 0) {
        throw new Error(
            `Can't rebuild the merge: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer on disk. Unmerge instead to recover what's left.`
        );
    }

    // Order DESCENDING by merge-time priority so the highest-priority (lowest
    // pakNN) source lands LAST in argv; vpkmerge is last-input-wins, matching
    // mergeMods and Deadlock's lower-pakNN-wins collision rule. (remainingOnDisk
    // is index-aligned with remainingSnapshots: the missing check above
    // guarantees every snapshot resolved.)
    const ordered = remainingOnDisk
        .map((mod, i) => ({ mod, priority: remainingSnapshots[i].priorityAtMergeTime }))
        .sort((a, b) => b.priority - a.priority)
        .map((p) => p.mod);

    // Rebuild IN PLACE: build to a dotfile in the merged mod's OWN folder (a
    // non-`_dir.vpk` name, so it isn't scanned as a mod or counted as a slot),
    // then swap it into the target's exact path. Staying in-folder keeps the
    // merge at its original load-order position (folder + pakNN) and needs no free
    // slot elsewhere, which matters once the merge lives in an overflow folder:
    // a base-only "next free pakNN" + setModPriority path would wrongly fail (or
    // move the merge to the base folder) for a merge that lives in an overflow folder.
    const targetDir = dirname(target.path);
    const buildPath = join(targetDir, `.merge-rebuild-${randomUUID()}.vpk`);
    mergeTrace(
        `rebuild start merge=${manifest.id} key=${target.metaKey}: ${ordered.length} sources -> ${basename(buildPath)} (removed "${sourceFileName}")`
    );
    try {
        await runVpkmerge([buildPath, ...ordered.map((m) => m.path)]);
        await verifyVpkOutput(buildPath);
    } catch (err) {
        try { await fs.unlink(buildPath); } catch { /* ignore partial-output cleanup */ }
        mergeTrace(`rebuild FAILED merge=${manifest.id}: ${String(err)} (build temp removed)`);
        throw err;
    }

    // Capture the rebuilt output's canonical identity from its PRE-EMBED bytes,
    // exactly like mergeModsLocked does for a fresh merge: the rebuilt VPK is a
    // new file, so its "original" is the hash of the freshly-rebuilt-but-not-
    // yet-embedded output. Stored as metadata.sha256 AND embedded below, so
    // resolveVpkIdentity returns it whether or not the embed pass succeeds.
    const rebuiltOriginal = await computeOriginalIdentity(buildPath);
    const sha256 = rebuiltOriginal.sha256;

    // Each remaining source's stamped vpkIndex, same capture the merge path
    // does. remainingOnDisk is index-aligned with remainingSnapshots (the
    // missing check above guarantees every snapshot resolved).
    const remainingVpkIndexes = remainingOnDisk.map((m) => getModMetadata(m.metaKey)?.vpkIndex);

    // Fresh manifest: keep the surviving source snapshots (still accurate),
    // regenerate the share code from the on-disk survivors, preserve createdAt.
    const portable = buildPortableForSources(remainingOnDisk, meta.modName || target.name);
    const newManifest: MergedModInfo = {
        id: manifest.id,
        createdAt: manifest.createdAt,
        shareCode: encodeShareCode(JSON.stringify(portable)),
        sources: remainingSnapshots,
    };

    // Swap: drop the old merged VPK, then move the freshly built one into its
    // exact path. Same folder + pakNN means the metaKey (and load order) is
    // preserved, so the metadata re-stamps under the unchanged key.
    await fs.unlink(target.path);
    removeModMetadata(target.metaKey);
    await fs.rename(buildPath, target.path);
    setModMetadata(target.metaKey, {
        modName: meta.modName,
        thumbnailUrl: meta.thumbnailUrl,
        sha256,
        merged: newManifest,
    });
    mergeTrace(`rebuild done merge=${manifest.id} key=${target.metaKey}: ${describeSources(remainingSnapshots)}`);

    // Pass 2: re-embed the self-identifying entries with the UPDATED remaining
    // source list, mirroring mergeModsLocked's embed pass. Without this the
    // rebuild would permanently strip the imprint the original merge carried.
    // Fail-soft exactly like the merge path: the rebuild already succeeded, a
    // failed embed only costs the self-describing metadata, and the stamped
    // sha256 equals the un-embedded file's live hash, so identity stays sound.
    try {
        await embedMergeIdentity(
            target.path,
            meta.modName || target.name,
            newManifest.createdAt,
            rebuiltOriginal,
            remainingSnapshots.map((s, i) => ({
                title: s.modName,
                identity: { sha256: s.sha256AtMergeTime },
                gamebananaId: s.gameBananaId,
                gamebananaFileId: s.gameBananaFileId,
                section: s.section,
                priorityAtMergeTime: s.priorityAtMergeTime,
                enabledAtMergeTime: s.enabledAtMergeTime,
                fileNameAtMergeTime: s.fileName,
                vpkIndex: remainingVpkIndexes[i],
            }))
        );
        await verifyVpkOutput(target.path);
        mergeTrace(`rebuild embed done merge=${manifest.id} key=${target.metaKey}`);
    } catch (err) {
        mergeTrace(`rebuild WARNING merge=${manifest.id}: embed pass failed: ${String(err)} (rebuilt merge left un-embedded)`);
        console.warn(`[modMerger] Failed to embed identity into rebuilt merged VPK ${target.path}:`, err);
    }

    await restoreExtracted();

    // Re-read so the returned merged mod reflects on-disk state; the IPC layer
    // enriches it with the manifest. The slot/metaKey is unchanged by the swap.
    const finalScan = await scanMods(deadlockPath);
    const finalMerged = finalScan.find((m) => m.metaKey === target.metaKey);
    if (!finalMerged) {
        throw new Error('Rebuilt merged VPK was created but could not be located in the rescan.');
    }
    return { collapsed: false, merged: finalMerged, restored };
}
