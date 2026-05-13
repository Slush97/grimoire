import { ipcMain } from 'electron';
import {
    getAppVersion,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    getUpdateStatus,
    getInstallSource,
} from '../services/updater';

// Get current app version
ipcMain.handle('updater:getVersion', () => {
    return getAppVersion();
});

// Tell the renderer whether in-app updates are available, so apt/AUR users
// see a "use your package manager" message instead of broken update buttons.
ipcMain.handle('updater:getInstallSource', () => {
    return getInstallSource();
});

// Get current update status
ipcMain.handle('updater:getStatus', () => {
    return getUpdateStatus();
});

// Check for updates (manual trigger)
ipcMain.handle('updater:check', async () => {
    return await checkForUpdates();
});

// Download the available update
ipcMain.handle('updater:download', async () => {
    return await downloadUpdate();
});

// Quit and install the update
ipcMain.handle('updater:install', () => {
    quitAndInstall();
});
