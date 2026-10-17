import { app, dialog } from 'electron';
import { existsSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { loadSettings, saveSettings } from './settings';

function defaultDialogPath(defaultPath?: string): string {
    if (defaultPath && isAbsolute(defaultPath)) return defaultPath;
    // A deleted folder makes the Windows dialog open in its parent with the
    // folder's name in the filename box.
    const remembered = loadSettings().lastDialogDirectory;
    const directory = remembered && existsSync(remembered) ? remembered : app.getPath('downloads');
    return defaultPath ? join(directory, defaultPath) : directory;
}

function rememberDialogPath(selectedPath: string, directory: boolean): void {
    saveSettings({
        ...loadSettings(),
        lastDialogDirectory: directory ? selectedPath : dirname(selectedPath),
    });
}

export async function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
    const result = await dialog.showOpenDialog({
        ...options,
        defaultPath: defaultDialogPath(options.defaultPath),
    });
    if (!result.canceled && result.filePaths[0]) {
        rememberDialogPath(result.filePaths[0], options.properties?.includes('openDirectory') ?? false);
    }
    return result;
}

export async function showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
    const result = await dialog.showSaveDialog({
        ...options,
        defaultPath: defaultDialogPath(options.defaultPath),
    });
    if (!result.canceled && result.filePath) {
        rememberDialogPath(result.filePath, false);
    }
    return result;
}
