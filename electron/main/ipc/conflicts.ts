import { ipcMain } from 'electron';
import { loadSettings, saveSettings } from '../services/settings';
import {
    detectConflicts,
    conflictPairKey,
    modConflictIdentity,
    migrateIgnoredConflictKeysForMods,
    ModConflict,
} from '../services/conflicts';
import { scanMods } from '../services/mods';

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

function sameKeys(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((key, index) => key === b[index]);
}

async function loadMigratedIgnoredConflicts(): Promise<string[]> {
    const settings = loadSettings();
    const current = settings.ignoredConflicts ?? [];
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath || current.length === 0) {
        return current;
    }

    const mods = await scanMods(deadlockPath);
    const migrated = migrateIgnoredConflictKeysForMods(current, mods);
    if (!sameKeys(migrated, current)) {
        saveSettings({ ...settings, ignoredConflicts: migrated });
    }
    return migrated;
}

// get-ignored-conflicts — returns the raw list of ignored pair keys. The
// Conflicts page uses this to render an "Ignored" panel with Unignore actions.
ipcMain.handle('get-ignored-conflicts', async (): Promise<string[]> => {
    return await loadMigratedIgnoredConflicts();
});

// ignore-conflict — adds a pair to the ignored list. Idempotent — adding
// the same pair twice is a no-op.
async function ignoredKeyForMods(modA: string, modB: string): Promise<string | null> {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) return null;
    const mods = await scanMods(deadlockPath);
    const a = mods.find((mod) => mod.id === modA);
    const b = mods.find((mod) => mod.id === modB);
    if (!a || !b) return null;
    return conflictPairKey(modConflictIdentity(a), modConflictIdentity(b));
}

ipcMain.handle('ignore-conflict', async (_, modA: string, modB: string): Promise<string[]> => {
    const key = await ignoredKeyForMods(modA, modB) ?? conflictPairKey(modA, modB);
    const current = await loadMigratedIgnoredConflicts();
    if (current.includes(key)) {
        return current;
    }
    const settings = loadSettings();
    const next = [...current, key];
    saveSettings({ ...settings, ignoredConflicts: next });
    return next;
});

// unignore-conflict — removes a pair from the ignored list. No-op if the
// pair wasn't ignored.
ipcMain.handle('unignore-conflict', async (_, modA: string, modB: string): Promise<string[]> => {
    const key = conflictPairKey(modA, modB);
    const stableKey = await ignoredKeyForMods(modA, modB);
    const current = await loadMigratedIgnoredConflicts();
    const next = current.filter((k) => k !== key && k !== stableKey);
    if (next.length !== current.length) {
        const settings = loadSettings();
        saveSettings({ ...settings, ignoredConflicts: next });
    }
    return next;
});
