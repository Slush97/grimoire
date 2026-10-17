import { BrowserWindow, ipcMain } from 'electron';
import { deleteModBackup, listModBackups, observeModBackupChanges } from '../services/modBackups';
import { restoreModBackup } from '../services/modBackupRestore';
import { getActiveDeadlockPath } from '../services/settings';

ipcMain.handle('list-mod-backups', () => listModBackups());
ipcMain.handle('delete-mod-backup', (_, backupId: string) => deleteModBackup(backupId));
ipcMain.handle('restore-mod-backup', async (_, backupId: string) => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) throw new Error('No Deadlock path configured');
    await restoreModBackup(deadlockPath, backupId);
});

observeModBackupChanges(() => {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('mod-backups-changed');
    }
});
