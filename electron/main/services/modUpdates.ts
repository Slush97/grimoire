import { BrowserWindow } from 'electron';
import { resolve } from 'path';
import type { AppSettings } from '../../../src/types/mod';
import { createModUpdateController } from './modUpdateController';
import { getActiveDeadlockPath, loadSettings } from './settings';
import { fetchModDetails } from './gamebanana';
import { getCurrentDownload, getDownloadQueue, isDownloadCancelled, isDownloadTargetQueued } from './download';
import { queueModReplacement, readReplacementMods } from './modReplacement';
import { writeSnapshot } from './snapshots';
import { isCopyingModsToDev } from './devMods';

export const modUpdates = createModUpdateController({
    context: () => {
        if (isCopyingModsToDev()) throw new Error('Wait for the developer library copy to finish before updating mods.');
        const deadlockPath = getActiveDeadlockPath();
        if (!deadlockPath) throw new Error('No Deadlock path configured');
        return { deadlockPath, devMode: loadSettings().devMode };
    },
    mods: readReplacementMods,
    details: fetchModDetails,
    autoMatchRemainingFiles: () => loadSettings().autoMatchRemainingFiles,
    snapshot: path => writeSnapshot(path, 'pre-update'),
    replace: (path, args, sources, promote, expectedSources) => queueModReplacement(path, args, sources, BrowserWindow.getAllWindows().find(window => !window.isDestroyed()) ?? null, { promoteExisting: promote, expectedSources }),
    targetQueued: isDownloadTargetQueued,
    cancelled: isDownloadCancelled,
    publish: state => {
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send('mod-update-state-updated', state);
        }
    },
});

function activePath(settings: AppSettings): string | null {
    const path = getActiveDeadlockPath(settings);
    return path ? resolve(path) : null;
}

function hasDownloadWork(): boolean {
    return modUpdates.isBusy() || getCurrentDownload() !== null || getDownloadQueue().length > 0;
}

/** Pending downloads and manual choices retain their original metadata mode. */
export function assertModUpdateSettingsChange(current: AppSettings, next: AppSettings): void {
    if (current.devMode === next.devMode && activePath(current) === activePath(next)) return;
    if (hasDownloadWork()) {
        throw new Error('Finish or cancel mod downloads and updates before changing the active installation or developer mode.');
    }
}

export function assertNoModUpdates(): void {
    if (hasDownloadWork()) throw new Error('Finish or cancel mod downloads and updates before replacing the developer library.');
}
