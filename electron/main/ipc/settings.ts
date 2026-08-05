import { ipcMain, nativeTheme } from 'electron';
import {
    loadSettings,
    normalizeColorScheme,
    saveSettings,
    type AppSettings,
} from '../services/settings';
import { detectDeadlockPath, looksLikeDeadlockPath } from '../services/deadlock';
import { ensureDevDeadlockPath } from '../services/dev';

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
    const colorScheme = normalizeColorScheme(settings.colorScheme);
    saveSettings({ ...settings, colorScheme });
    // This updates native chrome and the renderer's prefers-color-scheme query.
    // The renderer mirrors that resolved query onto <html data-theme>.
    nativeTheme.themeSource = colorScheme;
});
