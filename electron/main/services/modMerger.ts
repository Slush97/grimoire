import { promises as fs, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import { app } from 'electron';
import { metaKeyFor } from './deadlock';
import { scanMods, disableMod, enableMod, allocateEnabledVpkPath, type Mod } from './mods';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { fingerprintFile } from './fileMatch';
import { encodeShareCode } from './portableProfile';
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

type SupportedPlatform = 'linux-x64' | 'darwin-arm64' | 'win32-x64';

const VPKMERGE_BINARY_BY_PLATFORM: Record<SupportedPlatform, string> = {
    'linux-x64':    'vpkmerge-linux-x86_64',
    'darwin-arm64': 'vpkmerge-macos-aarch64',
    'win32-x64':    'vpkmerge-windows-x86_64.exe',
};

/**
 * Resolve the bundled vpkmerge binary path. In dev the binary lives under
 * the repo's resources/; in a packaged build electron-builder's
 * extraResources places it at process.resourcesPath/vpkmerge/.
 */
export function vpkmergeBinaryPath(): string {
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

async function hashFile(path: string): Promise<string> {
    const hash = createHash('sha256');
    hash.update(await fs.readFile(path));
    return hash.digest('hex');
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

    const installed = await scanMods(deadlockPath);
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

    // In Deadlock a LOWER pakNN wins a file collision (pak09 overrides pak10),
    // so the lowest-pakNN source is the highest priority. vpkmerge is
    // last-input-wins, so sort DESCENDING to put that highest-priority
    // (lowest-pakNN) source LAST in the argv and reproduce the in-game winner.
    sources.sort((a, b) => b.priority - a.priority);

    // Hash every source BEFORE any filesystem mutation. sha256AtMergeTime
    // is the content-identity fallback unmerge uses when the manifest
    // fileName lookup misses (file renamed by reconcile, partial-disable
    // recovery, etc). Parallel because the files are independent.
    const sourceHashes = await Promise.all(
        sources.map((src) => fingerprintFile(src.path).then((fp) => fp.sha256))
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

    const sha256 = await hashFile(mergedPath);
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
    // engine stops loading the original. disableMod returns the post-move
    // Mod so we record the actual on-disk filename (it may have been
    // renamed by reconcileEnabledDisabledCollisions). We re-stamp the
    // manifest after each successful disable so a mid-loop failure leaves
    // the manifest as up-to-date as it can be: sources processed already
    // have their post-disable fileName, the rest fall back to sha256.
    const disabledSources: Mod[] = [];
    for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (src.enabled) {
            const after = await disableMod(deadlockPath, src.id);
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

    const finalMods = await scanMods(deadlockPath);
    const newMod = finalMods.find((m) => m.metaKey === mergedMetaKey);
    if (!newMod) {
        throw new Error('Merged mod was created on disk but could not be located in the rescan.');
    }
    return { mod: newMod, disabledSources };
}

function buildPortableForSources(sources: Mod[], profileName: string): PortableProfile {
    const mods: PortableModEntry[] = [];
    for (const src of sources) {
        const meta = getModMetadata(src.metaKey);
        const gbId = meta?.gameBananaId ?? src.gameBananaId;
        const fileId = meta?.gameBananaFileId ?? src.gameBananaFileId;
        if (!gbId || !fileId) continue; // local mod — fast-path unmerge still works
        mods.push({
            source: 'gamebanana',
            ref: {
                submissionId: gbId,
                fileId,
                section: meta?.sourceSection || 'Mod',
            },
            enabled: true,
            priority: src.priority,
            hint: {
                name: meta?.modName || src.name,
                category: meta?.categoryName,
                fileLabel: meta?.variantLabel || meta?.fileDescription || meta?.sourceFileName,
                originalFileName: meta?.sourceFileName,
                thumbnailUrl: meta?.thumbnailUrl,
                nsfw: meta?.nsfw,
                isArchived: meta?.isArchived,
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
        const fp = await fingerprintFile(mod.path);
        const lower = fp.sha256.toLowerCase();
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
    const installed = await scanMods(deadlockPath);
    const target = installed.find((m) => m.id === mergedModId);
    if (!target) throw new Error(`Merged mod not found (id: ${mergedModId}).`);

    const meta = getModMetadata(target.metaKey);
    if (!meta?.merged) {
        throw new Error(`"${meta?.modName || target.name}" is not a merged mod.`);
    }
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
            recovered.push(await enableMod(deadlockPath, onDisk.id));
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
    const installed = await scanMods(deadlockPath);
    const target = installed.find((m) => m.id === mergedModId);
    if (!target) throw new Error(`Merged mod not found (id: ${mergedModId}).`);

    const meta = getModMetadata(target.metaKey);
    if (!meta?.merged) {
        throw new Error(`"${meta?.modName || target.name}" is not a merged mod.`);
    }
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
            restored.push(await enableMod(deadlockPath, removedOnDisk.id));
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
                    restored.push(await enableMod(deadlockPath, onDisk.id));
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
    try {
        await runVpkmerge([buildPath, ...ordered.map((m) => m.path)]);
        await verifyVpkOutput(buildPath);
    } catch (err) {
        try { await fs.unlink(buildPath); } catch { /* ignore partial-output cleanup */ }
        throw err;
    }

    const sha256 = await hashFile(buildPath);

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
