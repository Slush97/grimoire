import { ipcMain } from 'electron';
import { getActiveDeadlockPath } from '../services/settings';
import { migrateDmmInstall } from '../services/dmmMigration';
import type { DmmMigrationReport, DmmMigrationRequest } from '../../../src/lib/dmmMigration';

function requireDeadlockPath(): string {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured. Set it in Settings first.');
    }
    return deadlockPath;
}

// Non-mutating preview: build the adoption plan and return what WOULD be
// adopted, without copying anything. Safe to run repeatedly against a real
// DMM install.
ipcMain.handle('dmm-migrate:scan', (_, req: DmmMigrationRequest): Promise<DmmMigrationReport> => {
    return migrateDmmInstall({ ...req, deadlockPath: requireDeadlockPath(), planOnly: true });
});

// Execute the migration: copy each VPK into Grimoire's layout and write its
// metadata. Non-destructive (DMM's files are left in place).
ipcMain.handle('dmm-migrate:execute', (_, req: DmmMigrationRequest): Promise<DmmMigrationReport> => {
    return migrateDmmInstall({ ...req, deadlockPath: requireDeadlockPath() });
});
