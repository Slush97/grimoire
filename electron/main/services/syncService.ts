import { BrowserWindow } from 'electron';
import { fetchSubmissions } from './gamebanana';
import { upsertMods, getSyncState, updateSyncState, getModCount, type CachedMod } from './modDatabase';
import type { GameBananaMod } from '../../../src/types/gamebanana';

const SYNC_PER_PAGE = 50;
// Deadlock only has these three submission sections. 'Gui' and 'Model' were
// listed here once and both failed without losing any content, so don't add
// them back: GameBanana's Game/20948 record (_aSections) has no Gui or Model
// entry at all. What they look like they cover is already synced as Mod root
// categories ('HUD' and 'Model Replacement' respectively).
//
// They also failed in two different ways, the second one silently:
//   Gui   -> apiv11 500s server-side (missing classes/Model/Gui.php) and
//            returns HTML, so fetchJson throws and spams the log every sync.
//   Model -> apiv11 rejects _aFilters[Generic_Game] as UNKNOWN_FILTER. That
//            error body is valid JSON, so fetchSubmissions does not throw; it
//            just reports 0 records and syncSection writes a success state for
//            an empty section. Dropping the filter is NOT the fix: /Model/Index
//            returns the same 3136 site-wide records for any _idGameRow, so
//            without it the catalog fills with non-Deadlock content.
const SECTIONS = ['Mod', 'Sound', 'Wip'] as const;
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

// Instrumentation for the "move sync writes to a DB worker" decision: each
// page is one synchronous better-sqlite3 transaction (50 upserts + FTS
// triggers) on the main process. If these routinely exceed ~30ms in the wild
// (or [event-loop] warnings correlate with sync), the worker is justified;
// if they stay in single digits, it is not worth the complexity.
function timedUpsert(section: string, page: number, mods: CachedMod[]): void {
    const start = Date.now();
    upsertMods(mods);
    const tookMs = Date.now() - start;
    if (tookMs >= 20) {
        console.debug(`[SyncService] ${section} page ${page}: upsert of ${mods.length} rows took ${tookMs}ms`);
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
        downloadCount: mod.downloadCount ?? null,
        dateAdded: mod.dateAdded ?? 0,
        dateModified: mod.dateModified ?? 0,
        hasFiles: mod.hasFiles ?? true,
        isNsfw: mod.nsfw ?? false,
        thumbnailUrl,
        audioUrl: mod.previewMedia?.metadata?.audioUrl ?? null,
        profileUrl: mod.profileUrl,
        cachedAt: Math.floor(Date.now() / 1000),
    };
}

/**
 * Sync a single section
 */
async function syncSection(section: SectionType): Promise<void> {
    console.debug(`[SyncService] Starting sync for section: ${section}`);

    let page = 1;
    let totalCount = 0;
    let modsProcessed = 0;

    try {
        // First fetch to get total count
        const first = await fetchSubmissions(section, 1, SYNC_PER_PAGE);
        totalCount = first.totalCount;
        const totalPages = Math.ceil(totalCount / SYNC_PER_PAGE);

        console.debug(`[SyncService] ${section}: Total ${totalCount} mods, ${totalPages} pages`);

        // Process first page
        const cachedMods = first.records.map(mod => mapToCache(mod, section));
        timedUpsert(section, 1, cachedMods);
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
            timedUpsert(section, page, mods);
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

        console.debug(`[SyncService] ${section}: Sync complete, ${modsProcessed} mods cached`);
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
 * Cheap launch-time freshness pass: pull only page 1 of each section.
 *
 * `needsSync` gates the full paginated sync on a 24h staleness threshold, so
 * a user who opens Grimoire more than once a day used to browse a mirror that
 * could be a full day behind GameBanana with nothing refreshing it. That is
 * invisible on the default grid (Browse routes to the live API there), but any
 * catalog-only filter (search, hero, NSFW/date, A-Z sort, or *any* hidden
 * creator) serves the stale rows.
 *
 * Sorted explicitly by date modified ('updated' -> Generic_LatestModified) so
 * page 1 really is the 50 most recently touched submissions, covering both new
 * uploads and edits to existing ones for three requests total. Do NOT drop the
 * sort and lean on the default list order: checked against the live endpoint on
 * 2026-07-30, /Wip/Index comes back unordered, and /Mod/Index left the two most
 * recently modified rows off page 1 entirely.
 *
 * Deliberately does NOT write sync_state: this is a top-up, not a full mirror
 * refresh, and claiming otherwise would suppress the real sync for another 24h.
 * Progress is emitted terminal-only so the sync indicator stays quiet (it
 * renders nothing for a 'complete' phase) while Browse still gets the signal
 * it needs to re-query.
 */
export async function syncCatalogHead(): Promise<void> {
    if (isSyncing) {
        console.debug('[SyncService] Head sync skipped, sync already in progress');
        return;
    }

    isSyncing = true;
    try {
        for (const section of SECTIONS) {
            try {
                const first = await fetchSubmissions(section, 1, SYNC_PER_PAGE, undefined, undefined, 'updated');
                const mods = first.records.map(mod => mapToCache(mod, section));
                timedUpsert(section, 1, mods);
                console.debug(`[SyncService] ${section}: head sync refreshed ${mods.length} rows`);
                emitProgress({
                    section,
                    currentPage: 1,
                    totalPages: 1,
                    modsProcessed: mods.length,
                    totalMods: mods.length,
                    phase: 'complete',
                });
            } catch (err) {
                // Best-effort: a failed top-up leaves the existing mirror in
                // place, and the 24h full sync still reports its own errors.
                console.warn(`[SyncService] ${section}: head sync failed`, err);
            }
        }
    } finally {
        isSyncing = false;
    }
}

/**
 * Sync all sections
 */
export async function syncAllSections(): Promise<void> {
    if (isSyncing) {
        console.debug('[SyncService] Sync already in progress');
        return;
    }

    isSyncing = true;
    console.debug('[SyncService] Starting full sync for all sections');

    try {
        for (const section of SECTIONS) {
            try {
                await syncSection(section);
            } catch (err) {
                // Log error but continue with other sections
                console.error(`[SyncService] Failed to sync ${section}, continuing with others:`, err);
            }
        }
        console.debug('[SyncService] Full sync complete');
    } finally {
        isSyncing = false;
    }
}

/**
 * Sync a single section
 */
export async function syncSingleSection(section: string): Promise<void> {
    if (isSyncing) {
        console.debug('[SyncService] Sync already in progress');
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
