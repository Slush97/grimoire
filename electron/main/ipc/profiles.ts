import { ipcMain } from 'electron';
import { loadSettings, saveSettings } from '../services/settings';
import {
    loadProfiles,
    createProfile,
    updateProfile,
    applyProfile,
    deleteProfile,
    renameProfile,
    Profile,
    ProfileCrosshairSettings,
} from '../services/profiles';

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

// get-profiles
ipcMain.handle('get-profiles', (): Profile[] => {
    return loadProfiles();
});

// create-profile
ipcMain.handle('create-profile', (_, name: string, crosshairSettings?: ProfileCrosshairSettings): Profile => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const profile = createProfile(deadlockPath, name, crosshairSettings);

    // Set as active profile
    const settings = loadSettings();
    settings.activeProfileId = profile.id;
    saveSettings(settings);

    return profile;
});

// update-profile
ipcMain.handle('update-profile', (_, profileId: string, crosshairSettings?: ProfileCrosshairSettings): Profile => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    return updateProfile(deadlockPath, profileId, crosshairSettings);
});

// apply-profile
ipcMain.handle('apply-profile', (_, profileId: string): Profile => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const profile = applyProfile(deadlockPath, profileId);

    // Save as active profile
    const settings = loadSettings();
    settings.activeProfileId = profileId;
    saveSettings(settings);

    return profile;
});

// delete-profile
ipcMain.handle('delete-profile', (_, profileId: string): void => {
    deleteProfile(profileId);
});

// rename-profile
ipcMain.handle('rename-profile', (_, profileId: string, newName: string): Profile => {
    return renameProfile(profileId, newName);
});
