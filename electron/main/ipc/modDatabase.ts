import { ipcMain } from 'electron';
import { initDatabase, getModById, getModCount, wipeDatabase } from '../services/modDatabase';
import { searchMods, getCategories, getSectionStats, SearchOptions } from '../services/searchService';
import { syncAllSections, syncSingleSection, getSyncStatus, needsSync, isSyncInProgress } from '../services/syncService';

// Initialize database on module load
initDatabase();

// Sync handlers
ipcMain.handle('sync-all-mods', async () => {
    await syncAllSections();
    return { success: true };
});

ipcMain.handle('sync-section', async (_, section: string) => {
    await syncSingleSection(section);
    return { success: true };
});

ipcMain.handle('wipe-mod-cache', () => {
    if (isSyncInProgress()) {
        throw new Error('Cannot wipe cache while sync is in progress.');
    }
    wipeDatabase();
    return { success: true };
});

ipcMain.handle('get-sync-status', () => {
    return getSyncStatus();
});

ipcMain.handle('needs-sync', () => {
    return needsSync();
});

ipcMain.handle('is-sync-in-progress', () => {
    return isSyncInProgress();
});

// Search handlers
ipcMain.handle('search-local-mods', (_, options: SearchOptions) => {
    return searchMods(options);
});

ipcMain.handle('get-cached-mod', (_, id: number) => {
    return getModById(id);
});

ipcMain.handle('get-local-mod-count', (_, section?: string) => {
    return getModCount(section);
});

ipcMain.handle('get-local-categories', (_, section?: string) => {
    return getCategories(section);
});

ipcMain.handle('get-section-stats', () => {
    return getSectionStats();
});

console.log('[ModDatabase] IPC handlers registered');
