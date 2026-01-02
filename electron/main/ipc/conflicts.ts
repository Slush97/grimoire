import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import { detectConflicts, ModConflict } from '../services/conflicts';

/**
 * Get the active deadlock path from settings
 */
function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

// get-conflicts
ipcMain.handle('get-conflicts', async (): Promise<ModConflict[]> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        return [];
    }
    return await detectConflicts(deadlockPath);
});
