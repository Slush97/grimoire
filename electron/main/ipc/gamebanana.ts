import { ipcMain } from 'electron';
import { loadSettings } from '../services/settings';
import {
    fetchSections,
    fetchCategoryTreeCached,
    fetchSubmissions,
    fetchModDetails,
    fetchModFileList,
    fetchModComments,
    fetchModUpdates,
    fetchSubmitterLinks,
    fetchCollection,
    fetchCollectionItems,
    type GameBananaSection,
    type GameBananaCategoryNode,
    type GameBananaModsResponse,
    type GameBananaModDetails,
    type GameBananaModFileList,
    type GameBananaModUpdatesResponse,
    type GameBananaCollection,
    type GameBananaCollectionItemsResponse,
} from '../services/gamebanana';
import { downloadMod, getDownloadQueue, getCurrentDownload, removeFromQueue, cancelActiveDownload, resolveSuspiciousFileDecision, resolveMultiVpkPick, type DownloadModArgs } from '../services/download';
import { getMainWindow } from '../index';
import type {
    BrowseModsArgs,
    GetModDetailsArgs,
    GetModCommentsArgs,
    GetModUpdatesArgs,
    GetCategoriesArgs,
} from '../../../src/types/electron';
import { updateModNsfw } from '../services/modDatabase';

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
        const { page, perPage, search, section = 'Mod', categoryId, sort, submitterId } = args;
        return fetchSubmissions(section, page, perPage, search, categoryId, sort, submitterId);
    }
);

// get-mod-details (enriches local cache with NSFW flag)
ipcMain.handle(
    'get-mod-details',
    async (_, args: GetModDetailsArgs): Promise<GameBananaModDetails> => {
        const { modId, section = 'Mod', includeSubmitter } = args;
        const details = await fetchModDetails(modId, section, { includeSubmitter });

        // Enrich local cache with the NSFW flag from detail response
        try {
            updateModNsfw(modId, details.nsfw);
        } catch (err) {
            // Don't fail the request if cache update fails
            console.warn('[get-mod-details] Failed to update NSFW cache:', err);
        }

        return details;
    }
);

// get-mod-file-list (slim variant used by the Installed-page update check)
ipcMain.handle(
    'get-mod-file-list',
    async (_, args: GetModDetailsArgs): Promise<GameBananaModFileList> => {
        const { modId, section = 'Mod' } = args;
        return fetchModFileList(modId, section);
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

// get-download-queue
ipcMain.handle('get-download-queue', () => {
    return getDownloadQueue();
});

// get-current-download
ipcMain.handle('get-current-download', () => {
    return getCurrentDownload();
});

// remove-from-queue (cancel a queued download)
ipcMain.handle('remove-from-queue', (_, modId: number): boolean => {
    return removeFromQueue(modId);
});

// cancel-active-download (abort the currently-running download)
ipcMain.handle('cancel-active-download', (): boolean => {
    return cancelActiveDownload();
});

// one-click-suspicious-response (renderer relays user's modal decision)
ipcMain.handle(
    'one-click-suspicious-response',
    (_, args: { requestId: string; accepted: boolean }): void => {
        resolveSuspiciousFileDecision(args.requestId, args.accepted);
    }
);

// multi-vpk-pick-response (renderer hands back the user's VPK selection)
ipcMain.handle(
    'multi-vpk-pick-response',
    (_, args: { requestId: string; selected: string[] | null }): void => {
        resolveMultiVpkPick(args.requestId, args.selected === null ? null : { selected: args.selected });
    }
);

// get-mod-comments
ipcMain.handle(
    'get-mod-comments',
    async (_, args: GetModCommentsArgs) => {
        const { modId, section = 'Mod', page = 1 } = args;
        return fetchModComments(modId, section, page);
    }
);

// get-mod-updates
ipcMain.handle(
    'get-mod-updates',
    async (_, args: GetModUpdatesArgs): Promise<GameBananaModUpdatesResponse> => {
        const { modId, section = 'Mod', page = 1 } = args;
        return fetchModUpdates(modId, section, page);
    }
);

// get-submitter-links — artist social/contact links from their member profile
ipcMain.handle(
    'get-submitter-links',
    async (_, memberId: number) => {
        return fetchSubmitterLinks(memberId);
    }
);

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
        return fetchCategoryTreeCached(args.categoryModelName);
    }
);

// get-collection — metadata only
ipcMain.handle(
    'get-collection',
    async (_, args: { collectionId: number }): Promise<GameBananaCollection> => {
        return fetchCollection(args.collectionId);
    }
);

// get-collection-items — one page (15 records, server-capped)
ipcMain.handle(
    'get-collection-items',
    async (
        _,
        args: { collectionId: number; page?: number }
    ): Promise<GameBananaCollectionItemsResponse> => {
        return fetchCollectionItems(args.collectionId, args.page ?? 1);
    }
);
