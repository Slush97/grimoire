import { BrowserWindow } from 'electron';
import { fetchSubmissions } from './gamebanana';
import { upsertMods, getSyncState, updateSyncState, getModCount, CachedMod } from './modDatabase';
import type { GameBananaMod } from '../../../src/types/gamebanana';

const SYNC_PER_PAGE = 50;
const SECTIONS = ['Mod', 'Sound', 'Gui', 'Model'] as const;
type SectionType = typeof SECTIONS[number];

export interface SyncProgress {
    section: string;
    currentPage: number;
    totalPages: number;
    modsProcessed: number;
    totalMods: number;
    phase: 'fetching' | 'complete' | 'error';
    error?: string;
}

let isSyncing = false;

/**
 * Check if a sync is currently in progress
 */
export function isSyncInProgress(): boolean {
    return isSyncing;
}

/**
 * Get sync status for all sections
 */
export function getSyncStatus(): Record<string, { lastSync: number; count: number } | null> {
    const status: Record<string, { lastSync: number; count: number } | null> = {};
    for (const section of SECTIONS) {
        const state = getSyncState(section);
        if (state) {
            status[section] = {
                lastSync: state.lastSync,
                count: getModCount(section),
            };
        } else {
            status[section] = null;
        }
    }
    return status;
}

/**
 * Emit sync progress to all renderer windows
 */
function emitProgress(progress: SyncProgress): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
        win.webContents.send('sync-progress', progress);
    }
}

/**
 * Convert GameBananaMod to CachedMod
 */
function mapToCache(mod: GameBananaMod, section: string): CachedMod {
    const thumbnail = mod.previewMedia?.images?.[0];
    const thumbnailUrl = thumbnail
        ? `${thumbnail.baseUrl}/${thumbnail.file530 || thumbnail.file || thumbnail.file220}`
        : null;

    return {
        id: mod.id,
        name: mod.name,
        section,
        categoryId: mod.rootCategory?.id ?? null,
        categoryName: mod.rootCategory?.name ?? null,
        submitterName: mod.submitter?.name ?? null,
        submitterId: mod.submitter?.id ?? null,
        likeCount: mod.likeCount ?? 0,
        viewCount: mod.viewCount ?? 0,
        dateAdded: mod.dateAdded ?? 0,
        dateModified: mod.dateModified ?? 0,
        hasFiles: mod.hasFiles ?? true,
        isNsfw: mod.nsfw ?? false,
        thumbnailUrl,
        profileUrl: mod.profileUrl,
        cachedAt: Math.floor(Date.now() / 1000),
    };
}

/**
 * Sync a single section
 */
async function syncSection(section: SectionType): Promise<void> {
    console.log(`[SyncService] Starting sync for section: ${section}`);

    let page = 1;
    let totalCount = 0;
    let modsProcessed = 0;

    try {
        // First fetch to get total count
        const first = await fetchSubmissions(section, 1, SYNC_PER_PAGE);
        totalCount = first.totalCount;
        const totalPages = Math.ceil(totalCount / SYNC_PER_PAGE);

        console.log(`[SyncService] ${section}: Total ${totalCount} mods, ${totalPages} pages`);

        // Process first page
        const cachedMods = first.records.map(mod => mapToCache(mod, section));
        upsertMods(cachedMods);
        modsProcessed += cachedMods.length;

        emitProgress({
            section,
            currentPage: 1,
            totalPages,
            modsProcessed,
            totalMods: totalCount,
            phase: 'fetching',
        });

        // Fetch remaining pages
        for (page = 2; page <= totalPages; page++) {
            const response = await fetchSubmissions(section, page, SYNC_PER_PAGE);
            const mods = response.records.map(mod => mapToCache(mod, section));
            upsertMods(mods);
            modsProcessed += mods.length;

            emitProgress({
                section,
                currentPage: page,
                totalPages,
                modsProcessed,
                totalMods: totalCount,
                phase: 'fetching',
            });

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Update sync state
        updateSyncState({
            section,
            lastSync: Math.floor(Date.now() / 1000),
            totalCount,
            pagesSynced: totalPages,
        });

        emitProgress({
            section,
            currentPage: totalPages,
            totalPages,
            modsProcessed,
            totalMods: totalCount,
            phase: 'complete',
        });

        console.log(`[SyncService] ${section}: Sync complete, ${modsProcessed} mods cached`);
    } catch (error) {
        console.error(`[SyncService] ${section}: Sync error`, error);
        emitProgress({
            section,
            currentPage: page,
            totalPages: Math.ceil(totalCount / SYNC_PER_PAGE) || 1,
            modsProcessed,
            totalMods: totalCount,
            phase: 'error',
            error: String(error),
        });
        throw error;
    }
}

/**
 * Sync all sections
 */
export async function syncAllSections(): Promise<void> {
    if (isSyncing) {
        console.log('[SyncService] Sync already in progress');
        return;
    }

    isSyncing = true;
    console.log('[SyncService] Starting full sync for all sections');

    try {
        for (const section of SECTIONS) {
            await syncSection(section);
        }
        console.log('[SyncService] Full sync complete');
    } finally {
        isSyncing = false;
    }
}

/**
 * Sync a single section
 */
export async function syncSingleSection(section: string): Promise<void> {
    if (isSyncing) {
        console.log('[SyncService] Sync already in progress');
        return;
    }

    if (!SECTIONS.includes(section as SectionType)) {
        throw new Error(`Invalid section: ${section}`);
    }

    isSyncing = true;
    try {
        await syncSection(section as SectionType);
    } finally {
        isSyncing = false;
    }
}

/**
 * Check if database needs sync (never synced or stale)
 */
export function needsSync(): boolean {
    for (const section of SECTIONS) {
        const state = getSyncState(section);
        if (!state) return true;

        // Consider stale if older than 24 hours
        const staleThreshold = 24 * 60 * 60; // 24 hours in seconds
        const age = Math.floor(Date.now() / 1000) - state.lastSync;
        if (age > staleThreshold) return true;
    }
    return false;
}
