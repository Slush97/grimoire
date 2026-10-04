import { BrowserWindow } from 'electron';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { OutdatedVdata } from '../../../src/types/mod';
import { getCitadelPath } from './deadlock';
import { runVpkmergeStdout } from './modMerger';
import { parseVpkDirectoriesAsync } from './vpk';

/**
 * Flags mods that ship a stale copy of a game `.vdata_c` (`scripts/heroes.vdata_c`
 * and friends). The shipped copy replaces the whole file in game, so anything
 * Valve added after the mod was built goes missing. Results are keyed on the
 * mod's path, size and mtime, follow the file through renames, and are dropped
 * wholesale when pak01 changes (a game update).
 */

const SAMPLE_SIZE = 8;
// Keeps one spawn's argv far below the ~32K character Windows command line cap.
const BATCH_SIZE = 50;

interface FileStat { size: number; mtimeMs: number }
interface Snapshot extends FileStat { outdated: OutdatedVdata[] }
interface CliResult {
    mod: string;
    reports?: Array<{ entry: string; missing: string[] }>;
}

const snapshots = new Map<string, Snapshot>();
let baseKey = '';
let queue: Promise<void> = Promise.resolve();

export function outdatedVdataSnapshot(path: string): OutdatedVdata[] | undefined {
    const entry = snapshots.get(path);
    if (!entry?.outdated.length) return undefined;
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat?.size === entry.size && stat.mtimeMs === entry.mtimeMs ? entry.outdated : undefined;
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

function shown(modPaths: string[]): string {
    return JSON.stringify(modPaths.map((path) => outdatedVdataSnapshot(path) ?? null));
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

    const trees = await parseVpkDirectoriesAsync([...pending.keys()]);
    const candidates: string[] = [];
    for (const [path, stat] of pending) {
        if (trees.get(path)?.some((entry) => entry.endsWith('.vdata_c'))) candidates.push(path);
        else snapshots.set(path, { ...stat, outdated: [] });
    }
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        await checkBatch(base, candidates.slice(i, i + BATCH_SIZE), pending);
    }

    if (shown(modPaths) !== before) {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mod-vdata-checked');
    }
}

async function checkBatch(base: string, paths: string[], stats: Map<string, FileStat>): Promise<void> {
    let results: CliResult[] = [];
    try {
        results = JSON.parse(await runVpkmergeStdout(['vdata-check', '--base', base, '--json', ...paths], 60000));
    } catch (err) {
        // Includes bundled binaries that predate the subcommand. Marked as checked
        // so a failure costs one spawn per file version, not one per scan.
        console.warn('[vdata-check] vpkmerge failed:', err);
    }
    // A mod that failed to open comes back with an `error` and no reports.
    // Only fields the mod deletes are flagged: fields it has that the game
    // dropped are left alone.
    const byMod = new Map(results.map((result) => [result.mod, result]));
    for (const path of paths) {
        const outdated = (byMod.get(path)?.reports ?? [])
            .filter((r) => r.missing.length > 0)
            .map((r) => ({ entry: r.entry, missing: r.missing.length, sample: r.missing.slice(0, SAMPLE_SIZE) }));
        snapshots.set(path, { ...stats.get(path)!, outdated });
    }
}
