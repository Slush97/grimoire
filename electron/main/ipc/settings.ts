import { ipcMain } from 'electron';
import { getActiveDeadlockPath, loadSettings, saveSettings, type AppSettings } from '../services/settings';
import { auditInstalledSafety } from '../services/modSafetyAudit';
import { syncWindowBackgroundWithSettings } from '../services/windowBackground';
import { detectDeadlockPath, looksLikeDeadlockPath } from '../services/deadlock';
import { ensureDevDeadlockPath } from '../services/dev';
import { copyModsToDev } from '../services/devMods';
import { syncForgeBridgeWithSettings } from '../services/forgeBridge';
import { assertUpdateChannelChange, syncUpdaterWithSettings } from '../services/updater';
import { hydrateOnBoot as hydrateSocialSession } from '../services/socialAuth';
import { runExclusiveModMutation } from '../services/mods';
import { prebuildHideoutScene } from '../services/hideoutScene';
import { assertModUpdateSettingsChange, assertNoModUpdates } from '../services/modUpdates';

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

ipcMain.handle('copy-mods-to-dev', (event) => {
    assertNoModUpdates();
    return copyModsToDev((percent) => {
        if (!event.sender.isDestroyed()) event.sender.send('copy-mods-to-dev-progress', percent);
    });
});

// get-settings
ipcMain.handle('get-settings', (): AppSettings => {
    return loadSettings();
});

// set-settings
ipcMain.handle('set-settings', async (_, patch: Partial<AppSettings>): Promise<AppSettings> => {
    const current = loadSettings();
    const settings = { ...current, ...patch };
    assertModUpdateSettingsChange(current, settings);
    assertUpdateChannelChange(settings.updateChannel);
    const persist = () => {
        const previous = loadSettings();
        // A path switch can wait behind mod writes while other preferences save.
        const saved = { ...previous, ...patch, lastDialogDirectory: previous.lastDialogDirectory };
        assertModUpdateSettingsChange(previous, saved);
        assertUpdateChannelChange(saved.updateChannel);
        saveSettings(saved);
        return { previous, saved };
    };
    // Finish in-flight mod writes before changing their metadata destination.
    const changesInstallation = settings.devMode !== current.devMode ||
        settings.devDeadlockPath !== current.devDeadlockPath || settings.deadlockPath !== current.deadlockPath;
    const { previous, saved } = changesInstallation
        ? await runExclusiveModMutation(async () => persist())
        : persist();
    syncUpdaterWithSettings();
    syncWindowBackgroundWithSettings();
    // Bring the DeadlockForge bridge up or down to match. Toggling it off must
    // actually close the socket, not just start refusing requests on it.
    void syncForgeBridgeWithSettings();
    // Startup skips the installed-mod check while the review is off, so turning
    // it on checks the library now instead of at the next launch.
    const deadlockPath = getActiveDeadlockPath();
    if (saved.experimentalModSafety && !previous.experimentalModSafety && deadlockPath) {
        auditInstalledSafety(deadlockPath).catch(err => console.error('[mod-safety] Inspection failed:', err));
    }
    // Launch skips the saved-session check while Social is off, so turning it
    // on restores the session now instead of at the next launch.
    if (saved.experimentalSocial && !previous.experimentalSocial) void hydrateSocialSession();
    // Startup builds the hideout cache for everyone only while the hideout is
    // the default, so turning that on builds it now.
    if (saved.experimentalHideoutDefault && !previous.experimentalHideoutDefault && deadlockPath) {
        prebuildHideoutScene(deadlockPath, { everyone: true }).catch(error => console.warn('[hideout] Prebuild failed:', error));
    }
    return saved;
});
