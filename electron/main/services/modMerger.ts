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
import { parseVpkEntryStats } from './vpk';
import {
    computeOriginalIdentity,
    serializeAddonInfo,
    serializeModinfo,
    hasLegacyGrimoireMergeMetaEntry,
    findImprintRepackMismatch,
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
    AddMergeSourcesResult,
    MergeSourceReplacement,
    ReplaceMergeSourcesResult,
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
    // An explicit override wins in dev AND packaged builds. Distro packages
    // (e.g. nix) that run the app outside electron-builder's layout cannot
    // rely on process.resourcesPath and point this at their own binary.
    const explicit = process.env['VPKMERGE_BINARY'];
    if (explicit && existsSync(explicit)) return explicit;

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
    await repackWithEmbeddedEntries(mergedPath, addonText, metaText);
}

/**
 * Re-pack `vpkPath` in place with BOTH imprint entries (`addoninfo.txt` +
 * `modinfo.json`) embedded at its root in one `vpkmerge metadata` pass, then
 * atomically swap it over the original. The single shared embed writer: the
 * merge pass (embedMergeIdentity above) and the single-mod imprint
 * (imprintMods.ts) both go through here, so the parity check and the legacy
 * residue retirement cannot drift between them.
 *
 * The temp output is a dotfile in the VPK's OWN folder (a non-`_dir.vpk`
 * name, so it is neither scanned as a mod nor counted as a slot), keeping the
 * rename on one volume; on any failure the original VPK is left untouched.
 *
 * Before the swap the repacked output must pass a real parity check against
 * the input's entry tree (findImprintRepackMismatch): every carried entry
 * present with an unchanged logical size (except an expected `--drop-entry`
 * removal), nothing added beyond the two imprint entries. A magic-bytes check
 * alone (verifyVpkOutput) would accept a structurally valid VPK that silently
 * dropped or corrupted game content. Any mismatch throws (landing in the
 * caller's fail-soft handling) and the original VPK keeps its slot.
 *
 * When the input still carries a legacy grimoire_meta.json companion, it is
 * passed to vpkmerge's `--drop-entry` so the residue is retired in the same
 * repack that writes its replacement (the new record fully supersedes it).
 */
export async function repackWithEmbeddedEntries(
    vpkPath: string,
    addonText: string,
    modinfoText: string
): Promise<void> {
    const inputEntries = parseVpkEntryStats(vpkPath);
    if (!inputEntries) {
        throw new Error('Cannot verify the repack: the input VPK entry tree is unreadable.');
    }
    const addonTmp = join(tmpdir(), `grimoire-imprint-addoninfo-${randomUUID()}.txt`);
    const modinfoTmp = join(tmpdir(), `grimoire-imprint-modinfo-${randomUUID()}.json`);
    const embedOut = join(dirname(vpkPath), `.imprint-embed-${randomUUID()}.vpk`);
    const droppedEntries = hasLegacyGrimoireMergeMetaEntry(vpkPath) ? [LEGACY_GRIMOIRE_META_ENTRY] : [];
    try {
        await fs.writeFile(addonTmp, addonText);
        await fs.writeFile(modinfoTmp, modinfoText);
        await runVpkmerge([
            'metadata',
            '--vpk',
            vpkPath,
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
        // Atomic replace (rename over the existing file, the metadata.ts write
        // idiom): either the embedded VPK fully takes the slot or, if the rename
        // fails, the original un-embedded VPK is left untouched. Avoids a
        // window where the slot is missing on disk.
        await fs.rename(embedOut, vpkPath);
    } catch (err) {
        try { await fs.unlink(embedOut); } catch { /* ignore partial-output cleanup */ }
        throw err;
    } finally {
        try { await fs.unlink(addonTmp); } catch { /* best-effort temp cleanup */ }
        try { await fs.unlink(modinfoTmp); } catch { /* best-effort temp cleanup */ }
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
    if (new Set(modIds).size !== modIds.length) {
        throw new Error('The same mod was selected more than once.');
    }

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
    const selected = modIds.map((id) => {
        const mod = installed.find((candidate) => candidate.id === id);
        if (!mod) throw new Error(`Selected mod not found (id: ${id}).`);
        return { mod, metadata: getModMetadata(mod.metaKey) };
    });
    const parentMerges = selected
        .filter((entry) => !!entry.metadata?.merged)
        .map((entry) => entry.mod);
    const parentIds = new Set(parentMerges.map((parent) => parent.id));
    const locatedSources: LocatedMergeSource[] = [];
    const missingSources: string[] = [];

    const addUniqueSource = (source: LocatedMergeSource): void => {
        if (locatedSources.some((candidate) =>
            sameMergeSourceIdentity(candidate.snapshot, source.snapshot)
        )) return;
        locatedSources.push(source);
    };

    // Standalone selections become leaves directly. Capture their provenance
    // before any source is disabled or renamed.
    for (const { mod, metadata } of selected) {
        if (metadata?.merged) continue;
        const identity = await resolveVpkIdentity(mod.path);
        addUniqueSource({
            mod,
            snapshot: {
                fileName: mod.fileName,
                modName: metadata?.modName || mod.name,
                thumbnailUrl: metadata?.thumbnailUrl,
                gameBananaId: metadata?.gameBananaId ?? mod.gameBananaId,
                gameBananaFileId: metadata?.gameBananaFileId ?? mod.gameBananaFileId,
                section: metadata?.sourceSection ?? mod.sourceSection,
                enabledAtMergeTime: mod.enabled,
                priorityAtMergeTime: mod.priority,
                sha256AtMergeTime: identity.sha256,
            },
            vpkIndex: metadata?.vpkIndex,
        });
    }

    // A merged selection contributes its real leaf VPKs, never the parent VPK
    // itself. Use a fresh one-shot locator for each parent so a source shared
    // by two merges is recognized as a duplicate rather than reported missing.
    for (const { mod: parent, metadata } of selected) {
        const manifest = metadata?.merged;
        if (!manifest) continue;
        const locator = makeSourceLocator(
            installed.filter((candidate) => !parentIds.has(candidate.id))
        );
        for (const snapshot of manifest.sources) {
            const onDisk = await locator.locate(snapshot);
            if (!onDisk) {
                missingSources.push(snapshot.fileName);
                continue;
            }
            const identity = await resolveVpkIdentity(onDisk.path);
            addUniqueSource({
                mod: onDisk,
                snapshot: {
                    ...snapshot,
                    fileName: onDisk.fileName,
                    sha256AtMergeTime: snapshot.sha256AtMergeTime || identity.sha256,
                },
                vpkIndex: getModMetadata(onDisk.metaKey)?.vpkIndex,
            });
        }
        mergeTrace(
            `flatten parent ${manifest.id} "${metadata.modName || parent.name}": ${manifest.sources.length} manifest sources`
        );
    }

    if (missingSources.length > 0) {
        const missing = Array.from(new Set(missingSources));
        throw new Error(
            `Can't flatten the selected merge: ${missing.join(', ')} `
            + `${missing.length === 1 ? 'is' : 'are'} no longer on disk. `
            + 'The original merges were left unchanged. Unmerge first to recover the missing sources.'
        );
    }

    if (locatedSources.length < 2) {
        throw new Error("Can't create the flattened merge: too few unique source VPKs remain on disk.");
    }

    assertCanMoveLoadedGameMods([
        ...parentMerges,
        ...locatedSources.filter((source) => source.mod.enabled).map((source) => source.mod),
    ]);

    // In Deadlock a LOWER pakNN wins a file collision (pak09 overrides pak10),
    // so the lowest-priority-number leaf must be last for vpkmerge's
    // last-input-wins behavior. Parent merge VPKs never enter this list, which
    // also prevents their embedded modinfo.json/addoninfo.txt from nesting.
    locatedSources.sort(
        (a, b) => b.snapshot.priorityAtMergeTime - a.snapshot.priorityAtMergeTime
    );
    const sources = locatedSources.map((source) => source.mod);

    mergeTrace(
        `merge start "${trimmedName}": ${sources.length} sources -> ${sources
            .map((s) => `${s.fileName}(pri ${s.priority}${s.enabled ? '' : ',disabled'})`)
            .join(', ')}`
    );

    // Keep the resolved manifest snapshots aligned with the sorted leaf paths.
    // Their captured priority and provenance, rather than the disabled files'
    // current fallback priority, must drive both the manifest and share code.
    const preDisableSnapshot: MergedModSource[] = locatedSources.map((source) => ({
        ...source.snapshot,
        fileName: source.mod.fileName,
    }));
    const portable = buildPortableForSources(sources, trimmedName, preDisableSnapshot);
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
    const sourceVpkIndexes = locatedSources.map((source) => source.vpkIndex);

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

    // Only consume selected parent merges after the new flattened VPK has
    // built, verified, been stamped, and completed its embed attempt. Their
    // leaf sources are already represented above and remain disabled.
    for (const parent of parentMerges) {
        await fs.unlink(parent.path);
        removeModMetadata(parent.metaKey);
    }

    const finalMods = await scanMods(deadlockPath);
    const newMod = finalMods.find((m) => m.metaKey === mergedMetaKey);
    if (!newMod) {
        throw new Error('Merged mod was created on disk but could not be located in the rescan.');
    }
    return { mod: newMod, disabledSources };
}

function buildPortableForSources(
    sources: Mod[],
    profileName: string,
    snapshots?: MergedModSource[]
): PortableProfile {
    const entries: PortableMergeSourceEntry[] = sources.map((src, index) => {
        const meta = getModMetadata(src.metaKey);
        const snapshot = snapshots?.[index];
        return {
            fileName: snapshot?.fileName ?? src.fileName,
            modName: snapshot?.modName ?? meta?.modName ?? src.name,
            thumbnailUrl: snapshot?.thumbnailUrl ?? meta?.thumbnailUrl,
            gameBananaId: snapshot?.gameBananaId ?? meta?.gameBananaId ?? src.gameBananaId,
            gameBananaFileId:
                snapshot?.gameBananaFileId ?? meta?.gameBananaFileId ?? src.gameBananaFileId,
            section: snapshot?.section ?? meta?.sourceSection,
            enabledAtMergeTime: snapshot?.enabledAtMergeTime ?? true,
            priorityAtMergeTime: snapshot?.priorityAtMergeTime ?? src.priority,
            sha256AtMergeTime: snapshot?.sha256AtMergeTime,
            // Hint extras the snapshot shape cannot carry: the merge-time
            // caller has full metadata, so the share code keeps the same hint
            // a plain (non-merge) export would. nsfw in particular drives the
            // import dialog's skip filter and thumbnail blur.
            nsfw: meta?.nsfw,
            categoryName: meta?.categoryName,
            fileLabel: meta?.variantLabel || meta?.fileDescription || meta?.sourceFileName,
            originalFileName: meta?.sourceFileName,
            isArchived: meta?.isArchived,
        };
    });
    return buildPortableForMergeSources(entries, profileName);
}

/**
 * A merge-source snapshot, optionally enriched with the hint-only fields a
 * live metadata lookup can supply (nsfw / category / file labels). The
 * snapshot shape itself stays lean: these extras exist only to round-trip
 * into PortableModHint when the caller has them.
 */
export type PortableMergeSourceEntry = MergedModSource & {
    nsfw?: boolean;
    categoryName?: string;
    fileLabel?: string;
    originalFileName?: string;
    isArchived?: boolean;
};

/**
 * Build a portable profile (the unmerge-fallback share code payload) straight
 * from a merge's own source snapshots, with no live Mod/metadata lookup. Pure
 * projection of the snapshot -> PortableModEntry: every field this reads
 * already lives on the entry, which is what lets it double as the DB-wipe
 * reconstruction path (see reconstructMergedModInfo/imprintMods.ts) where the
 * sources come from an embedded modinfo.json or legacy grimoire_meta.json
 * record, not a live scan (those bare snapshots simply omit the hint extras).
 * Local sources (no GameBanana id) are omitted, same as
 * buildPortableForSources: the share code is best-effort, not authoritative
 * (the merge's own metadata.merged manifest is authoritative for unmerge).
 */
export function buildPortableForMergeSources(
    sources: PortableMergeSourceEntry[],
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
                category: src.categoryName,
                fileLabel: src.fileLabel,
                originalFileName: src.originalFileName,
                thumbnailUrl: src.thumbnailUrl,
                nsfw: src.nsfw,
                isArchived: src.isArchived,
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
            if (onDisk && src.sha256AtMergeTime) {
                const wanted = src.sha256AtMergeTime.toLowerCase();
                if ((await getHash(onDisk)) !== wanted) onDisk = undefined;
            }
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

export interface AddMergeSourcesOptions {
    /** Pass --strict to vpkmerge so any file collision aborts before the
     *  existing merge is replaced. */
    strict?: boolean;
}

interface LocatedMergeSource {
    mod: Mod;
    snapshot: MergedModSource;
    vpkIndex?: number;
}

function sameMergeSourceIdentity(
    left: Pick<MergedModSource, 'sha256AtMergeTime' | 'gameBananaFileId'>,
    right: Pick<MergedModSource, 'sha256AtMergeTime' | 'gameBananaFileId'>
): boolean {
    const leftSha = left.sha256AtMergeTime?.toLowerCase();
    const rightSha = right.sha256AtMergeTime?.toLowerCase();
    if (leftSha && rightSha && leftSha === rightSha) return true;
    return typeof left.gameBananaFileId === 'number'
        && typeof right.gameBananaFileId === 'number'
        && left.gameBananaFileId === right.gameBananaFileId;
}

/**
 * Add standalone VPKs to an existing merge without changing the merge's slot,
 * metadata key, or stable manifest id. All expensive/fallible work targets a
 * dotfile first; the original merged VPK is replaced only after vpkmerge,
 * verification, identity capture, and the updated embed have succeeded.
 */
export async function addMergeSources(
    deadlockPath: string,
    mergedModId: string,
    addModIds: string[],
    options: AddMergeSourcesOptions = {}
): Promise<AddMergeSourcesResult> {
    if (addModIds.length === 0) throw new Error('Select at least one mod to add.');
    if (new Set(addModIds).size !== addModIds.length) {
        throw new Error('The same mod was selected more than once.');
    }
    return runExclusiveModMutation(() =>
        addMergeSourcesLocked(deadlockPath, mergedModId, addModIds, options)
    );
}

async function addMergeSourcesLocked(
    deadlockPath: string,
    mergedModId: string,
    addModIds: string[],
    options: AddMergeSourcesOptions
): Promise<AddMergeSourcesResult> {
    const installed = await scanMods(deadlockPath);
    await syncRunningGameModSnapshotFromMods(installed);

    const target = installed.find((mod) => mod.id === mergedModId);
    if (!target) throw new Error(`Merged mod not found (id: ${mergedModId}).`);
    const targetMeta = getModMetadata(target.metaKey);
    if (!targetMeta?.merged) {
        throw new Error(`"${targetMeta?.modName || target.name}" is not a merged mod.`);
    }
    const oldManifest = targetMeta.merged;

    const additions: Mod[] = addModIds.map((id) => {
        const mod = installed.find((candidate) => candidate.id === id);
        if (!mod) throw new Error(`Selected mod not found (id: ${id}).`);
        if (mod.id === target.id) throw new Error('A merge cannot be added to itself.');
        const metadata = getModMetadata(mod.metaKey);
        if (metadata?.merged) {
            throw new Error(`"${metadata.modName || mod.name}" is already a merged mod.`);
        }
        return mod;
    });

    // Capture and validate every addition before resolving existing leaves.
    // Comparing against the manifest itself rejects a hidden absorbed source
    // passed directly over IPC, even though it is intentionally excluded from
    // the source locator below.
    const additionSnapshots: LocatedMergeSource[] = [];
    for (const mod of additions) {
        const metadata = getModMetadata(mod.metaKey);
        const identity = await resolveVpkIdentity(mod.path);
        const snapshot: MergedModSource = {
            fileName: mod.fileName,
            modName: metadata?.modName || mod.name,
            thumbnailUrl: metadata?.thumbnailUrl,
            gameBananaId: metadata?.gameBananaId ?? mod.gameBananaId,
            gameBananaFileId: metadata?.gameBananaFileId ?? mod.gameBananaFileId,
            section: metadata?.sourceSection ?? mod.sourceSection,
            enabledAtMergeTime: mod.enabled,
            priorityAtMergeTime: mod.priority,
            sha256AtMergeTime: identity.sha256,
        };
        const duplicate = oldManifest.sources.some((source) =>
            sameMergeSourceIdentity(source, snapshot)
        ) || additionSnapshots.some((source) =>
            sameMergeSourceIdentity(source.snapshot, snapshot)
        );
        if (duplicate) {
            throw new Error(`"${snapshot.modName}" is already present in this merge.`);
        }
        additionSnapshots.push({ mod, snapshot, vpkIndex: metadata?.vpkIndex });
    }

    // Resolve the existing sources without letting a newly selected mod be
    // accidentally claimed by a legacy filename-only manifest entry.
    const additionIds = new Set(additions.map((mod) => mod.id));
    const locator = makeSourceLocator(
        installed.filter((mod) => mod.id !== target.id && !additionIds.has(mod.id))
    );
    const existing: LocatedMergeSource[] = [];
    const missingSources: string[] = [];
    for (const source of oldManifest.sources) {
        const onDisk = await locator.locate(source);
        if (!onDisk) {
            missingSources.push(source.fileName);
            continue;
        }
        const identity = await resolveVpkIdentity(onDisk.path);
        existing.push({
            mod: onDisk,
            snapshot: {
                ...source,
                fileName: onDisk.fileName,
                sha256AtMergeTime: source.sha256AtMergeTime || identity.sha256,
            },
            vpkIndex: getModMetadata(onDisk.metaKey)?.vpkIndex,
        });
    }

    if (missingSources.length > 0) {
        const missing = Array.from(new Set(missingSources));
        throw new Error(
            `Can't add mods to this merge: ${missing.join(', ')} `
            + `${missing.length === 1 ? 'is' : 'are'} no longer on disk. `
            + 'The merge was left unchanged. Unmerge first to recover the missing sources.'
        );
    }

    if (existing.length + additionSnapshots.length < 2) {
        throw new Error("Can't rebuild the merge: too few source VPKs remain on disk.");
    }

    // Both the existing merge and enabled additions will move/change below.
    // Refuse before touching disk when the running game has any of them loaded.
    assertCanMoveLoadedGameMods([
        target,
        ...additionSnapshots.filter((source) => source.mod.enabled).map((source) => source.mod),
    ]);

    const targetDir = dirname(target.path);
    const buildPath = join(targetDir, `.merge-rebuild-${randomUUID()}.vpk`);
    const disabledForRollback: Mod[] = [];
    let swapped = false;

    try {
        // Move enabled additions out of their live slots before building. On
        // any pre-swap failure they are restored, so --strict remains atomic
        // from the user's point of view.
        for (const source of additionSnapshots) {
            if (!source.mod.enabled) continue;
            const disabled = await disableModUnlocked(deadlockPath, source.mod.id);
            disabledForRollback.push(disabled);
            source.mod = disabled;
            source.snapshot.fileName = disabled.fileName;
        }

        const ordered = [...existing, ...additionSnapshots].sort(
            (a, b) => b.snapshot.priorityAtMergeTime - a.snapshot.priorityAtMergeTime
        );
        const args: string[] = [];
        if (options.strict) args.push('--strict');
        args.push(buildPath, ...ordered.map((source) => source.mod.path));

        mergeTrace(
            `add-sources start merge=${oldManifest.id} key=${target.metaKey}: `
            + `+${additionSnapshots.length} -> ${basename(buildPath)}`
        );
        await runVpkmerge(args);
        await verifyVpkOutput(buildPath);

        const rebuiltOriginal = await computeOriginalIdentity(buildPath);
        const snapshots = ordered.map((source) => source.snapshot);
        const portable = buildPortableForSources(
            ordered.map((source) => source.mod),
            targetMeta.modName || target.name,
            snapshots
        );
        const newManifest: MergedModInfo = {
            id: oldManifest.id,
            createdAt: oldManifest.createdAt,
            shareCode: encodeShareCode(JSON.stringify(portable)),
            sources: snapshots,
        };

        // Embed before the swap so sidecar and in-VPK provenance advance as a
        // unit. An embed/parity failure leaves the original merge untouched.
        await embedMergeIdentity(
            buildPath,
            targetMeta.modName || target.name,
            newManifest.createdAt,
            rebuiltOriginal,
            ordered.map((source) => ({
                title: source.snapshot.modName,
                identity: { sha256: source.snapshot.sha256AtMergeTime },
                gamebananaId: source.snapshot.gameBananaId,
                gamebananaFileId: source.snapshot.gameBananaFileId,
                section: source.snapshot.section,
                priorityAtMergeTime: source.snapshot.priorityAtMergeTime,
                enabledAtMergeTime: source.snapshot.enabledAtMergeTime,
                fileNameAtMergeTime: source.snapshot.fileName,
                vpkIndex: source.vpkIndex,
            }))
        );
        await verifyVpkOutput(buildPath);

        // Atomic same-directory replacement preserves filename, slot, mod id,
        // and metaKey. The metadata setter merges this patch with unrelated
        // fields already stored for the merge.
        await fs.rename(buildPath, target.path);
        swapped = true;
        setModMetadata(target.metaKey, {
            modName: targetMeta.modName,
            thumbnailUrl: targetMeta.thumbnailUrl,
            sha256: rebuiltOriginal.sha256,
            merged: newManifest,
        });
        mergeTrace(
            `add-sources done merge=${oldManifest.id} key=${target.metaKey}: ${describeSources(snapshots)}`
        );
        return {
            merged: newManifest,
            addedFileNames: additionSnapshots.map((source) => source.snapshot.fileName),
        };
    } catch (err) {
        if (!swapped) {
            try { await fs.unlink(buildPath); } catch { /* best-effort temp cleanup */ }
            // Restore only additions that this operation moved. Reverse order
            // minimizes load-slot churn when several sources were enabled.
            for (const disabled of disabledForRollback.reverse()) {
                try {
                    await enableModUnlocked(deadlockPath, disabled.id);
                } catch (restoreErr) {
                    console.error(`[modMerger] Failed to restore ${disabled.fileName} after add-source failure:`, restoreErr);
                }
            }
        }
        mergeTrace(`add-sources FAILED merge=${oldManifest.id}: ${String(err)}`);
        throw err;
    }
}

/**
 * Swap one or more absorbed sources for freshly downloaded replacements and
 * rebuild the merge in its current slot. This is what makes a merged mod
 * updatable: a source's GameBanana file gets replaced by its author, the
 * renderer downloads the new file as a normal standalone mod, and this hands
 * the merge a new leaf in the old one's place.
 *
 * Every replacement inherits the OLD snapshot's priorityAtMergeTime and
 * enabledAtMergeTime. That is what keeps the rebuilt VPK's internal collision
 * order byte-for-byte equivalent to the original (vpkmerge is last-input-wins
 * over a descending-priority argv) and what lets a later unmerge restore each
 * source to the enabled state the user actually had.
 *
 * All replacements are applied in ONE rebuild. Calling this per source would
 * rewrite the whole merged VPK once per source.
 *
 * The old source VPKs are deleted only after the atomic swap succeeds, so a
 * failed rebuild leaves both the merge and the old sources exactly as found.
 */
export async function replaceMergeSources(
    deadlockPath: string,
    mergedModId: string,
    replacements: MergeSourceReplacement[],
    options: AddMergeSourcesOptions = {}
): Promise<ReplaceMergeSourcesResult> {
    if (replacements.length === 0) throw new Error('Select at least one source to update.');
    const oldNames = replacements.map((r) => r.oldFileName);
    if (new Set(oldNames).size !== oldNames.length) {
        throw new Error('The same source was selected more than once.');
    }
    const newIds = replacements.map((r) => r.newModId);
    if (new Set(newIds).size !== newIds.length) {
        throw new Error('The same replacement mod was selected more than once.');
    }
    return runExclusiveModMutation(() =>
        replaceMergeSourcesLocked(deadlockPath, mergedModId, replacements, options)
    );
}

async function replaceMergeSourcesLocked(
    deadlockPath: string,
    mergedModId: string,
    replacements: MergeSourceReplacement[],
    options: AddMergeSourcesOptions
): Promise<ReplaceMergeSourcesResult> {
    const installed = await scanMods(deadlockPath);
    await syncRunningGameModSnapshotFromMods(installed);

    const target = installed.find((mod) => mod.id === mergedModId);
    if (!target) throw new Error(`Merged mod not found (id: ${mergedModId}).`);
    const targetMeta = getModMetadata(target.metaKey);
    if (!targetMeta?.merged) {
        throw new Error(`"${targetMeta?.modName || target.name}" is not a merged mod.`);
    }
    const oldManifest = targetMeta.merged;

    // Validate every replacement against the manifest and the install list
    // before anything on disk moves.
    const replacedByFileName = new Map<string, Mod>();
    for (const { oldFileName, newModId } of replacements) {
        const oldSnapshot = oldManifest.sources.find((s) => s.fileName === oldFileName);
        if (!oldSnapshot) {
            throw new Error(`"${oldFileName}" is not a source of this merge.`);
        }
        const replacement = installed.find((mod) => mod.id === newModId);
        if (!replacement) throw new Error(`Replacement mod not found (id: ${newModId}).`);
        if (replacement.id === target.id) {
            throw new Error('A merge cannot replace one of its own sources with itself.');
        }
        const replacementMeta = getModMetadata(replacement.metaKey);
        if (replacementMeta?.merged) {
            throw new Error(
                `"${replacementMeta.modName || replacement.name}" is a merged mod and can't be used as a source.`
            );
        }
        replacedByFileName.set(oldFileName, replacement);
    }

    // Resolve the whole existing source list first. Replacements are excluded
    // from the candidate pool so a legacy filename-only manifest entry can't
    // claim the freshly downloaded VPK as one of the surviving sources.
    const replacementIds = new Set(Array.from(replacedByFileName.values(), (mod) => mod.id));
    const locator = makeSourceLocator(
        installed.filter((mod) => mod.id !== target.id && !replacementIds.has(mod.id))
    );

    // The old VPKs being swapped out, resolved so they can be deleted after the
    // rebuild. Missing-on-disk is tolerated here: the replacement supplies the
    // content either way, and there is simply nothing left to clean up.
    const retiredMods: Mod[] = [];
    const pending: LocatedMergeSource[] = [];
    const missingSources: string[] = [];

    for (const source of oldManifest.sources) {
        const replacement = replacedByFileName.get(source.fileName);
        if (replacement) {
            const retired = await locator.locate(source);
            if (retired) retiredMods.push(retired);
            const replacementMeta = getModMetadata(replacement.metaKey);
            const identity = await resolveVpkIdentity(replacement.path);
            pending.push({
                mod: replacement,
                snapshot: {
                    fileName: replacement.fileName,
                    modName: replacementMeta?.modName || replacement.name,
                    thumbnailUrl: replacementMeta?.thumbnailUrl ?? source.thumbnailUrl,
                    gameBananaId: replacementMeta?.gameBananaId ?? replacement.gameBananaId,
                    gameBananaFileId:
                        replacementMeta?.gameBananaFileId ?? replacement.gameBananaFileId,
                    section: replacementMeta?.sourceSection ?? replacement.sourceSection,
                    // Inherited, NOT taken from the replacement's current slot:
                    // the download landed in whatever pakNN was free, which says
                    // nothing about where this source belongs in the merge.
                    enabledAtMergeTime: source.enabledAtMergeTime,
                    priorityAtMergeTime: source.priorityAtMergeTime,
                    sha256AtMergeTime: identity.sha256,
                },
                vpkIndex: replacementMeta?.vpkIndex,
            });
            continue;
        }
        const onDisk = await locator.locate(source);
        if (!onDisk) {
            missingSources.push(source.fileName);
            continue;
        }
        const identity = await resolveVpkIdentity(onDisk.path);
        pending.push({
            mod: onDisk,
            snapshot: {
                ...source,
                fileName: onDisk.fileName,
                sha256AtMergeTime: source.sha256AtMergeTime || identity.sha256,
            },
            vpkIndex: getModMetadata(onDisk.metaKey)?.vpkIndex,
        });
    }

    if (missingSources.length > 0) {
        const missing = Array.from(new Set(missingSources));
        throw new Error(
            `Can't update this merge: ${missing.join(', ')} `
            + `${missing.length === 1 ? 'is' : 'are'} no longer on disk. `
            + 'The merge was left unchanged. Unmerge first to recover the missing sources.'
        );
    }

    if (pending.length < 2) {
        throw new Error("Can't rebuild the merge: too few source VPKs remain on disk.");
    }

    // Both the merge and any enabled replacement will move below. Refuse before
    // touching disk when the running game has one of them loaded.
    assertCanMoveLoadedGameMods([
        target,
        ...pending.filter((source) => source.mod.enabled).map((source) => source.mod),
    ]);

    const targetDir = dirname(target.path);
    const buildPath = join(targetDir, `.merge-rebuild-${randomUUID()}.vpk`);
    const disabledForRollback: Mod[] = [];
    let swapped = false;

    try {
        // A freshly downloaded replacement installs ENABLED into a live pakNN
        // slot. Move it out before building, tracking it for rollback so a
        // pre-swap failure leaves the user's load order untouched.
        for (const source of pending) {
            if (!source.mod.enabled) continue;
            const disabled = await disableModUnlocked(deadlockPath, source.mod.id);
            disabledForRollback.push(disabled);
            source.mod = disabled;
            source.snapshot.fileName = disabled.fileName;
        }

        const ordered = [...pending].sort(
            (a, b) => b.snapshot.priorityAtMergeTime - a.snapshot.priorityAtMergeTime
        );
        const args: string[] = [];
        if (options.strict) args.push('--strict');
        args.push(buildPath, ...ordered.map((source) => source.mod.path));

        mergeTrace(
            `replace-sources start merge=${oldManifest.id} key=${target.metaKey}: `
            + `${replacements.length} swapped -> ${basename(buildPath)}`
        );
        await runVpkmerge(args);
        await verifyVpkOutput(buildPath);

        const rebuiltOriginal = await computeOriginalIdentity(buildPath);
        const snapshots = ordered.map((source) => source.snapshot);
        const portable = buildPortableForSources(
            ordered.map((source) => source.mod),
            targetMeta.modName || target.name,
            snapshots
        );
        const newManifest: MergedModInfo = {
            id: oldManifest.id,
            createdAt: oldManifest.createdAt,
            shareCode: encodeShareCode(JSON.stringify(portable)),
            sources: snapshots,
        };

        // Embed before the swap so sidecar and in-VPK provenance advance as a
        // unit. An embed or parity failure leaves the original merge untouched.
        await embedMergeIdentity(
            buildPath,
            targetMeta.modName || target.name,
            newManifest.createdAt,
            rebuiltOriginal,
            ordered.map((source) => ({
                title: source.snapshot.modName,
                identity: { sha256: source.snapshot.sha256AtMergeTime },
                gamebananaId: source.snapshot.gameBananaId,
                gamebananaFileId: source.snapshot.gameBananaFileId,
                section: source.snapshot.section,
                priorityAtMergeTime: source.snapshot.priorityAtMergeTime,
                enabledAtMergeTime: source.snapshot.enabledAtMergeTime,
                fileNameAtMergeTime: source.snapshot.fileName,
                vpkIndex: source.vpkIndex,
            }))
        );
        await verifyVpkOutput(buildPath);

        await fs.rename(buildPath, target.path);
        swapped = true;
        setModMetadata(target.metaKey, {
            modName: targetMeta.modName,
            thumbnailUrl: targetMeta.thumbnailUrl,
            sha256: rebuiltOriginal.sha256,
            merged: newManifest,
        });

        // Only now is the old content redundant. Best-effort: the merge is
        // already correct, and a leftover disabled VPK is cosmetic next to
        // failing an update that actually landed.
        const retiredFileNames: string[] = [];
        for (const retired of retiredMods) {
            try {
                await fs.unlink(retired.path);
                removeModMetadata(retired.metaKey);
                retiredFileNames.push(retired.fileName);
            } catch (err) {
                console.error(`[modMerger] Failed to remove retired source ${retired.fileName}:`, err);
            }
        }

        mergeTrace(
            `replace-sources done merge=${oldManifest.id} key=${target.metaKey}: ${describeSources(snapshots)}`
        );
        return {
            merged: newManifest,
            replacedFileNames: pending
                .filter((source) => replacementIds.has(source.mod.id))
                .map((source) => source.snapshot.fileName),
            retiredFileNames,
        };
    } catch (err) {
        if (!swapped) {
            try { await fs.unlink(buildPath); } catch { /* best-effort temp cleanup */ }
            // Reverse order minimizes load-slot churn when several were enabled.
            for (const disabled of disabledForRollback.reverse()) {
                try {
                    await enableModUnlocked(deadlockPath, disabled.id);
                } catch (restoreErr) {
                    console.error(`[modMerger] Failed to restore ${disabled.fileName} after replace-source failure:`, restoreErr);
                }
            }
        }
        mergeTrace(`replace-sources FAILED merge=${oldManifest.id}: ${String(err)}`);
        throw err;
    }
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
