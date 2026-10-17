import { ipcMain } from 'electron';
import { getActiveDeadlockPath, loadSettings, saveSettings, type AppSettings } from '../services/settings';
import { auditInstalledSafety } from '../services/modSafetyAudit';
import { syncWindowBackgroundWithSettings } from '../services/windowBackground';
import { detectDeadlockPath, looksLikeDeadlockPath } from '../services/deadlock';
import { ensureDevDeadlockPath } from '../services/dev';
import { syncForgeBridgeWithSettings } from '../services/forgeBridge';
import { assertUpdateChannelChange, syncUpdaterWithSettings } from '../services/updater';
import { hydrateOnBoot as hydrateSocialSession } from '../services/socialAuth';

// detect-deadlock
ipcMain.handle('detect-deadlock', (): string | null => {
    return detectDeadlockPath();
});

// validate-deadlock-path: loose check so users can configure a path even
// when gameinfo.gi is missing; the Settings page surfaces a recovery
// affordance in that state.
ipcMain.handle('validate-deadlock-path', (_, path: string): boolean => {
    return looksLikeDeadlockPath(path);
});

// create-dev-deadlock-path
ipcMain.handle('create-dev-deadlock-path', (): string => {
    return ensureDevDeadlockPath();
});

// get-settings
ipcMain.handle('get-settings', (): AppSettings => {
    return loadSettings();
});

// set-settings
ipcMain.handle('set-settings', (_, settings: AppSettings): void => {
    const current = loadSettings();
    const safetyWasOn = current.experimentalModSafety;
    const socialWasOn = current.experimentalSocial;
    assertUpdateChannelChange(settings.updateChannel);
    saveSettings({ ...settings, lastDialogDirectory: current.lastDialogDirectory });
    syncUpdaterWithSettings();
    syncWindowBackgroundWithSettings();
    // Bring the DeadlockForge bridge up or down to match. Toggling it off must
    // actually close the socket, not just start refusing requests on it.
    void syncForgeBridgeWithSettings();
    // Startup skips the installed-mod check while the review is off, so turning
    // it on checks the library now instead of at the next launch.
    const deadlockPath = getActiveDeadlockPath();
    if (settings.experimentalModSafety && !safetyWasOn && deadlockPath) {
        auditInstalledSafety(deadlockPath).catch(err => console.error('[mod-safety] Inspection failed:', err));
    }
    // Launch skips the saved-session check while Social is off, so turning it
    // on restores the session now instead of at the next launch.
    if (settings.experimentalSocial && !socialWasOn) void hydrateSocialSession();
});
