import { ipcMain } from 'electron';
import { loadSettings, saveSettings, getActiveDeadlockPath } from '../services/settings';
import {
    detectConflicts,
    conflictPairKey,
    modConflictIdentity,
    migrateIgnoredConflictKeysForMods,
    type ModConflict,
} from '../services/conflicts';
import { scanMods } from '../services/mods';

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

// --- Per-file ignores ---------------------------------------------------
// Finer-grained than whole-pair ignores: dismiss individual overlapping file
// paths while keeping the pair flagged for any files that still overlap. Keyed
// by the same stable identity pair key (ignoreKey) the detector emits, so the
// renderer passes that key straight back rather than re-resolving mod ids.

// get-ignored-conflict-files — the full pairKey -> ignored-paths map, used to
// render the "Ignored files" management panel.
ipcMain.handle('get-ignored-conflict-files', async (): Promise<Record<string, string[]>> => {
    return loadSettings().ignoredConflictFiles ?? {};
});

// ignore-conflict-file — add one overlapping path to a pair's ignore list.
// Idempotent. Returns the updated map.
ipcMain.handle(
    'ignore-conflict-file',
    async (_, ignoreKey: string, filePath: string): Promise<Record<string, string[]>> => {
        const settings = loadSettings();
        const map = { ...(settings.ignoredConflictFiles ?? {}) };
        const existing = map[ignoreKey] ?? [];
        if (!existing.includes(filePath)) {
            map[ignoreKey] = [...existing, filePath];
            saveSettings({ ...settings, ignoredConflictFiles: map });
        }
        return map;
    }
);

// unignore-conflict-file — remove a single path, or the whole pair entry when
// filePath is null. Empties prune themselves so the map stays clean. Accepts
// the stable key directly so the panel can clear entries even after a mod was
// uninstalled.
ipcMain.handle(
    'unignore-conflict-file',
    async (_, ignoreKey: string, filePath: string | null): Promise<Record<string, string[]>> => {
        const settings = loadSettings();
        const current = settings.ignoredConflictFiles ?? {};
        if (!(ignoreKey in current)) {
            return current;
        }
        const map = { ...current };
        if (filePath === null) {
            delete map[ignoreKey];
        } else {
            const next = (map[ignoreKey] ?? []).filter((f) => f !== filePath);
            if (next.length === 0) {
                delete map[ignoreKey];
            } else {
                map[ignoreKey] = next;
            }
        }
        saveSettings({ ...settings, ignoredConflictFiles: map });
        return map;
    }
);

// --- Global file ignores ------------------------------------------------
// Silence a path for EVERY pair, not just one (the user-curated companion to
// the built-in compiler-artifact filter). For files that are never a real
// conflict no matter which mods ship them.

ipcMain.handle('get-ignored-conflict-files-global', async (): Promise<string[]> => {
    return loadSettings().ignoredConflictFilesGlobal ?? [];
});

// ignore-conflict-file-global — add a path to the global ignore list.
// Idempotent. Returns the updated list.
ipcMain.handle('ignore-conflict-file-global', async (_, filePath: string): Promise<string[]> => {
    const settings = loadSettings();
    const current = settings.ignoredConflictFilesGlobal ?? [];
    if (current.includes(filePath)) {
        return current;
    }
    const next = [...current, filePath];
    saveSettings({ ...settings, ignoredConflictFilesGlobal: next });
    return next;
});

// unignore-conflict-file-global — drop a path from the global ignore list.
ipcMain.handle('unignore-conflict-file-global', async (_, filePath: string): Promise<string[]> => {
    const settings = loadSettings();
    const current = settings.ignoredConflictFilesGlobal ?? [];
    const next = current.filter((f) => f !== filePath);
    if (next.length !== current.length) {
        saveSettings({ ...settings, ignoredConflictFilesGlobal: next });
    }
    return next;
});
