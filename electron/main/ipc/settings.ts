import { ipcMain } from 'electron';
import { loadSettings, saveSettings, AppSettings } from '../services/settings';
import { detectDeadlockPath, isValidDeadlockPath } from '../services/deadlock';
import { ensureDevDeadlockPath } from '../services/dev';

// detect-deadlock
ipcMain.handle('detect-deadlock', (): string | null => {
    return detectDeadlockPath();
});

// validate-deadlock-path
ipcMain.handle('validate-deadlock-path', (_, path: string): boolean => {
    return isValidDeadlockPath(path);
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
    saveSettings(settings);
});
