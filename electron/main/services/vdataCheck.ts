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
 * mod's size and mtime and dropped wholesale when pak01 changes (a game update).
 */

const SAMPLE_SIZE = 8;

interface Snapshot { size: number; mtimeMs: number; outdated: OutdatedVdata[] }
interface CliResult {
    reports?: Array<{ entry: string; status: string; missing: string[]; extra: string[] }>;
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

/** Checks mods with no current result in the background. Sends
 *  `mod-vdata-checked` when a new warning turns up. */
export function checkOutdatedVdata(deadlockPath: string, modPaths: string[]): void {
    queue = queue
        .then(() => check(deadlockPath, modPaths))
        .catch((err) => console.warn('[vdata-check] Check failed:', err));
}

async function check(deadlockPath: string, modPaths: string[]): Promise<void> {
    const base = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    const baseStat = statSync(base, { throwIfNoEntry: false });
    if (!baseStat) return;
    const key = `${base}:${baseStat.size}:${baseStat.mtimeMs}`;
    if (key !== baseKey) {
        snapshots.clear();
        baseKey = key;
    }

    const pending = new Map<string, { size: number; mtimeMs: number }>();
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
    if (candidates.length === 0) return;

    let results: CliResult[];
    try {
        results = JSON.parse(
            await runVpkmergeStdout(['vdata-check', '--base', base, '--json', ...candidates], 60000)
        );
    } catch (err) {
        // Includes bundled binaries that predate the subcommand. Marked as checked
        // so a failure costs one spawn per file version, not one per scan.
        console.warn('[vdata-check] vpkmerge failed:', err);
        for (const path of candidates) snapshots.set(path, { ...pending.get(path)!, outdated: [] });
        return;
    }

    let flagged = false;
    candidates.forEach((path, i) => {
        const outdated = (results[i]?.reports ?? [])
            .filter((r) => r.status === 'outdated')
            .map((r) => ({
                entry: r.entry,
                missing: r.missing.length,
                extra: r.extra.length,
                sample: r.missing.slice(0, SAMPLE_SIZE),
            }));
        snapshots.set(path, { ...pending.get(path)!, outdated });
        flagged ||= outdated.length > 0;
    });
    if (flagged) {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mod-vdata-checked');
    }
}
