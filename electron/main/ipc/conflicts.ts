import { ipcMain } from 'electron';
import { loadSettings, saveSettings } from '../services/settings';
import { detectConflicts, conflictPairKey, ModConflict } from '../services/conflicts';

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

// get-ignored-conflicts — returns the raw list of ignored pair keys. The
// Conflicts page uses this to render an "Ignored" panel with Unignore actions.
ipcMain.handle('get-ignored-conflicts', (): string[] => {
    return loadSettings().ignoredConflicts ?? [];
});

// ignore-conflict — adds a pair to the ignored list. Idempotent — adding
// the same pair twice is a no-op.
ipcMain.handle('ignore-conflict', (_, modA: string, modB: string): string[] => {
    const settings = loadSettings();
    const key = conflictPairKey(modA, modB);
    const current = settings.ignoredConflicts ?? [];
    if (current.includes(key)) {
        return current;
    }
    const next = [...current, key];
    saveSettings({ ...settings, ignoredConflicts: next });
    return next;
});

// unignore-conflict — removes a pair from the ignored list. No-op if the
// pair wasn't ignored.
ipcMain.handle('unignore-conflict', (_, modA: string, modB: string): string[] => {
    const settings = loadSettings();
    const key = conflictPairKey(modA, modB);
    const current = settings.ignoredConflicts ?? [];
    const next = current.filter((k) => k !== key);
    if (next.length !== current.length) {
        saveSettings({ ...settings, ignoredConflicts: next });
    }
    return next;
});
