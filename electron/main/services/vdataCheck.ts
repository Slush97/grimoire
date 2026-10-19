import { BrowserWindow } from 'electron';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { OutdatedVdata, StaleModel } from '../../../src/types/mod';
import { getCitadelPath } from './deadlock';
import { runVpkmergeStdout } from './modMerger';
import { parseVpkDirectoriesAsync } from './vpk';

/**
 * Flags mods built against an older game. Two checks share one cache:
 * - a stale copy of a game `.vdata_c` (`scripts/heroes.vdata_c` and friends).
 *   The shipped copy replaces the whole file in game, so anything Valve added
 *   after the mod was built goes missing.
 * - a hero model whose camera and aim attachments predate Deadlock's camera
 *   change (`vpkmerge attachments check`), which breaks the hero's camera.
 * Results are keyed on the mod's path, size and mtime, follow the file through
 * renames, and are dropped wholesale when pak01 changes (a game update).
 */

const SAMPLE_SIZE = 8;
// Keeps one spawn's argv far below the ~32K character Windows command line cap.
const BATCH_SIZE = 50;
/** Calico's playable cat form lives with abilities rather than hero models. */
const CAMERA_MODEL = /^models\/(?:heroes[^/]*\/.+|abilities\/nano_catform_model)\.vmdl_c$/;

interface FileStat { size: number; mtimeMs: number }
interface Snapshot extends FileStat { outdated: OutdatedVdata[]; staleModels: StaleModel[] }
interface CliResult<R> { mod: string; reports?: R[] }
interface VdataReport { entry: string; missing: string[] }
interface ModelReport { entry: string; status: string; stale: string[] }

const snapshots = new Map<string, Snapshot>();
let baseKey = '';
let queue: Promise<void> = Promise.resolve();

function isCurrent(path: string, entry: FileStat): boolean {
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat?.size === entry.size && stat.mtimeMs === entry.mtimeMs;
}

export function outdatedVdataSnapshot(path: string): OutdatedVdata[] | undefined {
    const entry = snapshots.get(path);
    return entry?.outdated.length && isCurrent(path, entry) ? entry.outdated : undefined;
}

export function staleModelsSnapshot(path: string): StaleModel[] | undefined {
    const entry = snapshots.get(path);
    return entry?.staleModels.length && isCurrent(path, entry) ? entry.staleModels : undefined;
}

export function moveVdataSnapshot(from: string, to: string): void {
    const value = snapshots.get(from);
    snapshots.delete(from);
    if (value) snapshots.set(to, value);
    else snapshots.delete(to);
}

export function forgetVdataSnapshot(path: string): void { snapshots.delete(path); }

/** Checks mods with no current result in the background. Sends
 *  `mod-vdata-checked` when that changes what any of their cards show. */
export function checkOutdatedVdata(deadlockPath: string, modPaths: string[]): Promise<void> {
    queue = queue
        .then(() => check(deadlockPath, modPaths))
        .catch((err) => console.warn('[vdata-check] Check failed:', err));
    return queue;
}

/** Valve's build keeps these but the game never reads them, and community
 *  compilers strip them: `_editor` blocks and the root `_include` list of
 *  `.vdata_inc` sources, which pak01 doesn't ship. */
function isEditorOnly(field: string): boolean {
    return field === '_include' || /(^|\/)_editor(\/|$)/.test(field);
}

function shown(modPaths: string[]): string {
    return JSON.stringify(modPaths.map((path) => [outdatedVdataSnapshot(path) ?? null, staleModelsSnapshot(path) ?? null]));
}

async function check(deadlockPath: string, modPaths: string[]): Promise<void> {
    const base = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    const baseStat = statSync(base, { throwIfNoEntry: false });
    if (!baseStat) return;
    const before = shown(modPaths);
    const key = `${base}:${baseStat.size}:${baseStat.mtimeMs}`;
    if (key !== baseKey) {
        snapshots.clear();
        baseKey = key;
    }

    const pending = new Map<string, FileStat>();
    for (const path of modPaths) {
        const stat = statSync(path, { throwIfNoEntry: false });
        if (!stat) continue;
        const entry = snapshots.get(path);
        if (entry?.size === stat.size && entry.mtimeMs === stat.mtimeMs) continue;
        pending.set(path, { size: stat.size, mtimeMs: stat.mtimeMs });
    }
    if (pending.size === 0) return;

    // Each mod is marked checked before its spawns run, so a failed spawn
    // costs one run per file version, not one per scan. Results land on these
    // objects, which follow the file if it is renamed meanwhile.
    const trees = await parseVpkDirectoriesAsync([...pending.keys()]);
    const fresh = new Map<string, Snapshot>();
    const vdataMods: string[] = [];
    const modelMods: string[] = [];
    for (const [path, stat] of pending) {
        const snapshot: Snapshot = { ...stat, outdated: [], staleModels: [] };
        snapshots.set(path, snapshot);
        fresh.set(path, snapshot);
        const entries = trees.get(path) ?? [];
        if (entries.some((entry) => entry.endsWith('.vdata_c'))) vdataMods.push(path);
        if (entries.some((entry) => CAMERA_MODEL.test(entry))) modelMods.push(path);
    }
    // Only fields the mod deletes are flagged: fields it has that the game
    // dropped are left alone.
    for (let i = 0; i < vdataMods.length; i += BATCH_SIZE) {
        const results = await runCheck<VdataReport>(['vdata-check', '--base', base, '--json'], vdataMods.slice(i, i + BATCH_SIZE));
        for (const [path, reports] of results) {
            const snapshot = fresh.get(path);
            if (!snapshot) continue;
            snapshot.outdated = reports
                .map((r) => ({ entry: r.entry, missing: r.missing.filter((field) => !isEditorOnly(field)) }))
                .filter((r) => r.missing.length > 0)
                .map((r) => ({ entry: r.entry, missing: r.missing.length, sample: r.missing.slice(0, SAMPLE_SIZE) }));
        }
    }
    for (let i = 0; i < modelMods.length; i += BATCH_SIZE) {
        const results = await runCheck<ModelReport>(['attachments', 'check', '--base', base, '--json'], modelMods.slice(i, i + BATCH_SIZE));
        for (const [path, reports] of results) {
            const snapshot = fresh.get(path);
            if (!snapshot) continue;
            snapshot.staleModels = reports
                .filter((r) => r.status === 'stale')
                .map((r) => ({ entry: r.entry, attachments: r.stale }));
        }
    }

    if (shown(modPaths) !== before) {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mod-vdata-checked');
    }
}

/** Reports per mod path from one `--json` check spawn. A mod that failed to
 *  open comes back with an `error` and no reports. */
async function runCheck<R>(args: string[], paths: string[]): Promise<Map<string, R[]>> {
    try {
        const results = JSON.parse(await runVpkmergeStdout([...args, ...paths], 60000)) as CliResult<R>[];
        return new Map(results.map((result) => [result.mod, result.reports ?? []]));
    } catch (err) {
        // Includes bundled binaries that predate the subcommand.
        console.warn(`[vdata-check] vpkmerge ${args[0]} failed:`, err);
        return new Map();
    }
}
