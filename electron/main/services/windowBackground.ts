import { BrowserWindow, nativeTheme } from 'electron';
import { loadSettings } from './settings';
import { nativeThemeSource, windowBackgroundColor } from '../../../src/lib/theme';

/**
 * Match the OS chrome (title bar, native menus) and every window's native
 * background to the saved theme. Called after any settings save, like
 * syncForgeBridgeWithSettings; new windows get both at construction.
 */
export function syncWindowBackgroundWithSettings(): void {
    const { theme } = loadSettings();
    const source = nativeThemeSource(theme);
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
    const color = windowBackgroundColor(theme);
    for (const window of BrowserWindow.getAllWindows()) {
        window.setBackgroundColor(color);
    }
}
