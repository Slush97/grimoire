import { ipcMain } from 'electron';
import {
    getAppVersion,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    getUpdateStatus,
} from '../services/updater';

// Get current app version
ipcMain.handle('updater:getVersion', () => {
    return getAppVersion();
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
