import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import {
    launchModded,
    launchVanilla,
    isDeadlockRunning,
    readStash,
    restoreFromStash,
    recoverFromStashOnStartup,
    stopDeadlockGame,
    type RestoreResult,
    type StopDeadlockResult,
} from '../services/launch';
import { readLaunchOptions, isSteamRunning } from '../services/launchOptions';
import { getMainWindow } from '../index';

function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
}

function emitRestore(result: RestoreResult): void {
    const win = getMainWindow();
    win?.webContents.send('vanilla-restore-complete', result);
}

ipcMain.handle('launch-modded', async (): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    await launchModded({ deadlockPath, onRestoreComplete: emitRestore });
});

ipcMain.handle('launch-vanilla', async (): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    await launchVanilla({ deadlockPath, onRestoreComplete: emitRestore });
});

ipcMain.handle('get-game-running-status', async (): Promise<{ running: boolean }> => {
    return { running: await isDeadlockRunning() };
});

ipcMain.handle('stop-game', async (): Promise<StopDeadlockResult & {
    restoreResult?: RestoreResult;
}> => {
    const stopResult = await stopDeadlockGame();
    const deadlockPath = getActiveDeadlockPath();
    const stash = await readStash();

    if (!deadlockPath || !stash || !stopResult.stopped) {
        return stopResult;
    }

    const restoreResult = await restoreFromStash(deadlockPath, stash);
    return { ...stopResult, restoreResult };
});

ipcMain.handle('get-vanilla-stash-status', async (): Promise<{
    active: boolean;
    startedAt?: string;
    modCount?: number;
}> => {
    const stash = await readStash();
    if (!stash) return { active: false };
    return {
        active: true,
        startedAt: stash.startedAt,
        modCount: stash.mods.length,
    };
});

ipcMain.handle('get-steam-launch-options-status', async (): Promise<{
    available: boolean;
    configPath: string | null;
    currentValue: string | null;
    steamRunning: boolean;
}> => {
    const [lookup, running] = await Promise.all([
        readLaunchOptions(),
        isSteamRunning(),
    ]);
    if (!lookup) {
        return { available: false, configPath: null, currentValue: null, steamRunning: running };
    }
    return {
        available: true,
        configPath: lookup.configPath,
        currentValue: lookup.currentValue,
        steamRunning: running,
    };
});

ipcMain.handle('restore-vanilla-stash', async (): Promise<RestoreResult> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const stash = await readStash();
    if (!stash) {
        return { restored: 0, skipped: 0, failed: [] };
    }
    return restoreFromStash(deadlockPath, stash);
});

/**
 * Called from main on app startup to auto-recover a half-finished vanilla
 * session. Exposed here so index.ts has somewhere to hang the call.
 */
export async function runStartupRecovery(): Promise<void> {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) return;
    try {
        const result = await recoverFromStashOnStartup(deadlockPath);
        if (result) {
            console.log('[launch] Startup recovery:', result);
            // Notify the renderer once it's ready.
            const win = getMainWindow();
            if (win) {
                // Delay slightly so renderer has mounted listeners.
                setTimeout(() => emitRestore(result), 2000);
            }
        }
    } catch (err) {
        console.error('[launch] Startup recovery failed:', err);
    }
}
