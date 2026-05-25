import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import { app } from 'electron';
import { getAddonsPath } from './deadlock';
import { scanMods, disableMod, enableMod, findNextAvailablePriority, type Mod } from './mods';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { fingerprintFile } from './fileMatch';
import { encodeShareCode } from './portableProfile';
import {
    PORTABLE_PROFILE_FORMAT,
    PORTABLE_PROFILE_SCHEMA_VERSION,
    type PortableProfile,
    type PortableModEntry,
} from '../../../src/types/portableProfile';
import type { MergedModInfo, MergedModSource, UnmergeModResult } from '../../../src/types/mod';

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
 * Exclusively create an empty file at `path` so the priority slot is
 * reserved on disk before we hand it to vpkmerge. Closes the TOCTOU
 * window between findNextAvailablePriority() and runVpkmerge() where a
 * concurrent download or 1-Click install could otherwise claim the slot.
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
        const meta = getModMetadata(found.fileName);
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

    const priority = await findNextAvailablePriority(deadlockPath);
    const priorityStr = String(priority).padStart(2, '0');
    const mergedFileName = `pak${priorityStr}_dir.vpk`;
    const addonsPath = getAddonsPath(deadlockPath);
    const mergedPath = join(addonsPath, mergedFileName);

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
        const meta = getModMetadata(src.fileName);
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
    removeModMetadata(mergedFileName);
    setModMetadata(mergedFileName, {
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
            setModMetadata(mergedFileName, {
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
    const newMod = finalMods.find((m) => m.fileName === mergedFileName);
    if (!newMod) {
        throw new Error('Merged mod was created on disk but could not be located in the rescan.');
    }
    return { mod: newMod, disabledSources };
}

function buildPortableForSources(sources: Mod[], profileName: string): PortableProfile {
    const mods: PortableModEntry[] = [];
    for (const src of sources) {
        const meta = getModMetadata(src.fileName);
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

    const meta = getModMetadata(target.fileName);
    if (!meta?.merged) {
        throw new Error(`"${meta?.modName || target.name}" is not a merged mod.`);
    }
    const manifest = meta.merged;

    // Candidates for source recovery, split by folder. Absorbed sources
    // should live in `.disabled/` so we look there first; the `enabled`
    // fallback handles partial-disable failures and external tampering.
    // The merged mod itself is filtered out so the target VPK can never
    // be misidentified as one of its own sources.
    const otherMods = installed.filter((m) => m.id !== target.id);
    const disabledCandidates: Mod[] = otherMods.filter((m) => !m.enabled);
    const enabledCandidates: Mod[] = otherMods.filter((m) => m.enabled);

    // Lazy fileName -> sha256 cache (lowercased) so we hash each candidate
    // at most once across the loop. Prefers the metadata-recorded hash
    // (set at install / merge time) over a fresh fingerprint.
    const hashCache = new Map<string, string>();
    const getHash = async (mod: Mod): Promise<string> => {
        const cached = hashCache.get(mod.fileName);
        if (cached) return cached;
        const fromMeta = getModMetadata(mod.fileName)?.sha256;
        if (fromMeta) {
            const lower = fromMeta.toLowerCase();
            hashCache.set(mod.fileName, lower);
            return lower;
        }
        const fp = await fingerprintFile(mod.path);
        const lower = fp.sha256.toLowerCase();
        hashCache.set(mod.fileName, lower);
        return lower;
    };

    const consumedIds = new Set<string>();
    const recovered: Mod[] = [];
    const missingSourceFileNames: string[] = [];

    for (const src of manifest.sources) {
        // 1. Happy path: disabled folder, fileName matches the manifest.
        let onDisk: Mod | undefined = disabledCandidates.find(
            (m) => !consumedIds.has(m.id) && m.fileName === src.fileName
        );

        // 2. Content fallback: disabled folder, sha256 matches. Covers the
        //    case where reconcileEnabledDisabledCollisions renamed the
        //    source between merge and unmerge.
        if (!onDisk && src.sha256AtMergeTime) {
            const wanted = src.sha256AtMergeTime.toLowerCase();
            for (const m of disabledCandidates) {
                if (consumedIds.has(m.id)) continue;
                if ((await getHash(m)) === wanted) {
                    onDisk = m;
                    break;
                }
            }
        }

        // 3. Content fallback in the enabled folder. Covers partial-disable
        //    failures (merge wrote the manifest but didn't finish disabling
        //    every source) and user-driven re-enables. The source is
        //    already enabled, so we leave it where it is.
        if (!onDisk && src.sha256AtMergeTime) {
            const wanted = src.sha256AtMergeTime.toLowerCase();
            for (const m of enabledCandidates) {
                if (consumedIds.has(m.id)) continue;
                if ((await getHash(m)) === wanted) {
                    onDisk = m;
                    break;
                }
            }
        }

        if (!onDisk) {
            missingSourceFileNames.push(src.fileName);
            continue;
        }

        consumedIds.add(onDisk.id);

        if (src.enabledAtMergeTime && !onDisk.enabled) {
            recovered.push(await enableMod(deadlockPath, onDisk.id));
        } else {
            recovered.push(onDisk);
        }
    }

    await fs.unlink(target.path);
    removeModMetadata(target.fileName);

    return {
        recovered,
        missingSourceFileNames,
        shareCode: manifest.shareCode,
    };
}
