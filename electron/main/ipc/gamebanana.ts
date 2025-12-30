import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import {
    fetchSections,
    fetchCategoryTree,
    fetchSubmissions,
    fetchModDetails,
    GameBananaSection,
    GameBananaCategoryNode,
    GameBananaModsResponse,
    GameBananaModDetails,
} from '../services/gamebanana';
import { downloadMod, DownloadModArgs } from '../services/download';
import { getMainWindow } from '../index';

interface BrowseModsArgs {
    page: number;
    perPage: number;
    search?: string;
    section?: string;
    categoryId?: number;
    sort?: string;
}

interface GetModDetailsArgs {
    modId: number;
    section?: string;
}

interface GetCategoriesArgs {
    categoryModelName: string;
}

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

// browse-mods
ipcMain.handle(
    'browse-mods',
    async (_, args: BrowseModsArgs): Promise<GameBananaModsResponse> => {
        const { page, perPage, search, section = 'Mod', categoryId, sort } = args;
        return fetchSubmissions(section, page, perPage, search, categoryId, sort);
    }
);

// get-mod-details
ipcMain.handle(
    'get-mod-details',
    async (_, args: GetModDetailsArgs): Promise<GameBananaModDetails> => {
        const { modId, section = 'Mod' } = args;
        return fetchModDetails(modId, section);
    }
);

// download-mod
ipcMain.handle('download-mod', async (_, args: DownloadModArgs): Promise<void> => {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured');
    }
    const mainWindow = getMainWindow();
    await downloadMod(deadlockPath, args, mainWindow);
});

// get-gamebanana-sections
ipcMain.handle(
    'get-gamebanana-sections',
    async (): Promise<GameBananaSection[]> => {
        return fetchSections();
    }
);

// get-gamebanana-categories
ipcMain.handle(
    'get-gamebanana-categories',
    async (_, args: GetCategoriesArgs): Promise<GameBananaCategoryNode[]> => {
        return fetchCategoryTree(args.categoryModelName);
    }
);
