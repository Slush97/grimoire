import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import {
    writeSnapshot,
    listSnapshots,
    loadSnapshot,
    deleteSnapshot,
    type SnapshotSummary,
    type SnapshotTrigger,
} from '../services/snapshots';

function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

// snapshot-create — capture the current installed mod set as a recovery
// snapshot. Used automatically by the update path (trigger = "pre-update").
ipcMain.handle('snapshot-create', async (_, trigger: SnapshotTrigger): Promise<SnapshotSummary> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const snap = await writeSnapshot(deadlockPath, trigger);
    return {
        snapshotId: snap.snapshotId,
        createdAt: snap.createdAt,
        trigger: snap.trigger,
        modCount: snap.modCount,
        profileName: snap.profile.profile.name,
    };
});

// snapshot-list — newest first; bad files are dropped silently.
ipcMain.handle('snapshot-list', (): SnapshotSummary[] => listSnapshots());

// snapshot-load — returns the embedded PortableProfile JSON so the renderer
// can feed it to the existing portable-import flow.
ipcMain.handle('snapshot-load', (_, snapshotId: string): string => loadSnapshot(snapshotId));

// snapshot-delete
ipcMain.handle('snapshot-delete', (_, snapshotId: string): void => {
    deleteSnapshot(snapshotId);
});
