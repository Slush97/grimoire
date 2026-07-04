import { ipcMain } from 'electron';
import { getActiveDeadlockPath } from '../services/settings';
import { migrateDmmInstall } from '../services/dmmMigration';
import { getModById, getModCount } from '../services/modDatabase';
import { writeSnapshot } from '../services/snapshots';
import type { DmmMigrationReport, DmmMigrationRequest } from '../../../src/lib/dmmMigration';

function requireDeadlockPath(): string {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured. Set it in Settings first.');
    }
    return deadlockPath;
}

// Submission-id validator backed by the local GameBanana catalog
// (mods-cache.db). Returns undefined when the catalog is empty or unavailable
// (fresh install, sync disabled): an empty catalog can't distinguish a wrong
// id from an unsynced one, so the migration then skips the check rather than
// rejecting everything.
function catalogSubmissionLookup(): ((id: number) => boolean) | undefined {
    try {
        if (getModCount() === 0) return undefined;
    } catch {
        return undefined;
    }
    return (id: number) => {
        try {
            return getModById(id) !== null;
        } catch {
            // A lookup failure must not reject a legitimate mod: fail open.
            return true;
        }
    };
}

// Non-mutating preview: build the adoption plan and return what WOULD be
// adopted, without copying anything. Safe to run repeatedly against a real
// DMM install. Runs the same already-managed + catalog filters as execute,
// so the preview matches what execute will actually do.
ipcMain.handle('dmm-migrate:scan', (_, req: DmmMigrationRequest): Promise<DmmMigrationReport> => {
    return migrateDmmInstall({
        ...req,
        deadlockPath: requireDeadlockPath(),
        planOnly: true,
        isKnownSubmission: catalogSubmissionLookup(),
    });
});

// Execute the migration: copy each VPK into Grimoire's layout and write its
// metadata. Non-destructive (DMM's files are left in place). A recovery
// snapshot is taken first, like the update path; its failure is non-fatal.
ipcMain.handle('dmm-migrate:execute', async (_, req: DmmMigrationRequest): Promise<DmmMigrationReport> => {
    const deadlockPath = requireDeadlockPath();
    try {
        await writeSnapshot(deadlockPath, 'pre-dmm-import');
    } catch (err) {
        console.warn('[DMM] pre-import snapshot failed (continuing):', err);
    }
    return migrateDmmInstall({
        ...req,
        deadlockPath,
        isKnownSubmission: catalogSubmissionLookup(),
    });
});
