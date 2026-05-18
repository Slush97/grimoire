import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'fs';
import { join } from 'path';
import { getUserDataPath } from '../utils/paths';
import { buildPortableProfileFromInstalled } from './portableProfile';
import type { PortableProfile } from '../../../src/types/portableProfile';
import type { SnapshotSummary, SnapshotTrigger } from '../../../src/types/snapshot';
export type { SnapshotSummary, SnapshotTrigger };

/** Persisted snapshot envelope. Carries the full portable profile inline so
 *  the file is self-contained — a user can copy it out and re-import without
 *  the surrounding metadata. */
export interface Snapshot {
    snapshotId: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    modCount: number;
    profile: PortableProfile;
}

function getSnapshotsDir(): string {
    return join(getUserDataPath(), 'snapshots');
}

function ensureDir(): string {
    const dir = getSnapshotsDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/** ISO timestamp safe for use in a filename across Windows/macOS/Linux:
 *  replaces `:` with `-` so Windows tolerates it. */
function filenameTimestamp(iso: string): string {
    return iso.replace(/:/g, '-');
}

function snapshotFilename(snapshot: Snapshot): string {
    return `${filenameTimestamp(snapshot.createdAt)}_${snapshot.trigger}_${snapshot.snapshotId}.json`;
}

function snapshotPath(filename: string): string {
    return join(getSnapshotsDir(), filename);
}

function generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Atomic write via temp+rename, matching the pattern in metadata.ts so a
 *  crash mid-write can't leave a half-written snapshot on disk. */
function writeSnapshotFile(snapshot: Snapshot): string {
    const dir = ensureDir();
    const filename = snapshotFilename(snapshot);
    const finalPath = join(dir, filename);
    const tempPath = `${finalPath}.tmp`;
    try {
        writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), 'utf-8');
        renameSync(tempPath, finalPath);
    } catch (err) {
        try {
            if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch {
            /* ignore cleanup failure */
        }
        throw err;
    }
    return filename;
}

function readSnapshotFile(filename: string): Snapshot | null {
    const full = snapshotPath(filename);
    try {
        const raw = readFileSync(full, 'utf-8');
        const parsed = JSON.parse(raw) as Snapshot;
        if (!parsed.snapshotId || !parsed.createdAt || !parsed.profile) {
            return null;
        }
        return parsed;
    } catch (err) {
        console.warn(`[Snapshots] Failed to parse ${filename}:`, err);
        return null;
    }
}

function listSnapshotFiles(): string[] {
    const dir = getSnapshotsDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json'));
}

/** Capture the current installed mod set as a recovery snapshot.
 *  Builds a portable profile from the live install state (not a stored
 *  profile), wraps it with trigger metadata, and writes atomically.
 *  Returns the snapshot for callers that want to log it.
 *
 *  Each file is tiny (a JSON manifest of GameBanana IDs per mod, no VPK
 *  bytes), so we don't auto-prune — the user deletes what they want from
 *  the Snapshots UI.
 *
 *  Failure is intentionally not silent here — the caller decides whether to
 *  swallow (e.g., the update path treats snapshot failure as non-fatal). */
export async function writeSnapshot(
    deadlockPath: string,
    trigger: SnapshotTrigger
): Promise<Snapshot> {
    const createdAt = new Date().toISOString();
    const friendlyTimestamp = createdAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
    const profileName =
        trigger === 'pre-update'
            ? `Auto-snapshot (before update) ${friendlyTimestamp}`
            : `Snapshot ${friendlyTimestamp}`;

    const { profile, warnings } = await buildPortableProfileFromInstalled(
        deadlockPath,
        profileName
    );
    if (warnings.length > 0) {
        console.log(`[Snapshots] ${warnings.length} local mods skipped:`, warnings);
    }

    const snapshot: Snapshot = {
        snapshotId: generateSnapshotId(),
        createdAt,
        trigger,
        modCount: profile.mods.length,
        profile,
    };

    writeSnapshotFile(snapshot);
    return snapshot;
}

/** Newest-first list of snapshot summaries. Files with unparseable JSON are
 *  skipped rather than thrown — a broken snapshot file shouldn't block the
 *  Profiles page from rendering. */
export function listSnapshots(): SnapshotSummary[] {
    const summaries: SnapshotSummary[] = [];
    for (const filename of listSnapshotFiles()) {
        const snap = readSnapshotFile(filename);
        if (!snap) continue;
        summaries.push({
            snapshotId: snap.snapshotId,
            createdAt: snap.createdAt,
            trigger: snap.trigger,
            modCount: snap.modCount,
            profileName: snap.profile.profile.name,
        });
    }
    summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return summaries;
}

/** Return the embedded PortableProfile JSON string so the renderer can hand
 *  it straight to parsePortableProfile + the existing import dialog. */
export function loadSnapshot(snapshotId: string): string {
    for (const filename of listSnapshotFiles()) {
        const snap = readSnapshotFile(filename);
        if (snap?.snapshotId === snapshotId) {
            return JSON.stringify(snap.profile, null, 2);
        }
    }
    throw new Error(`Snapshot not found: ${snapshotId}`);
}

export function deleteSnapshot(snapshotId: string): void {
    for (const filename of listSnapshotFiles()) {
        const snap = readSnapshotFile(filename);
        if (snap?.snapshotId === snapshotId) {
            try {
                unlinkSync(snapshotPath(filename));
            } catch (err) {
                throw new Error(`Failed to delete snapshot: ${String(err)}`);
            }
            return;
        }
    }
    throw new Error(`Snapshot not found: ${snapshotId}`);
}

