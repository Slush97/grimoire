import { ipcMain } from 'electron';
import { dismissCrashAdvisory, getCrashAdvisories, refreshCrashAdvisories } from '../services/crashAdvisories';

ipcMain.handle('get-crash-advisories', () => {
    void refreshCrashAdvisories();
    return getCrashAdvisories();
});
ipcMain.handle('dismiss-crash-advisory', (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return getCrashAdvisories();
    return dismissCrashAdvisory(id);
});
