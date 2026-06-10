import { BrowserWindow } from 'electron';
import { gamebananaRateLimiter } from './rateLimiter';
import { GRIMOIRE_USER_AGENT } from './userAgent';
import { getCachedCategoryTree, saveCachedCategoryTree } from './modDatabase';
// The GameBanana wire types are single-sourced in src/types/gamebanana.ts
// (the contract the renderer compiles against). Type-only import, erased at
// build; re-exported so the many `from './gamebanana'` importers keep working.
// Service-internal types (GameBananaFileMetadata*, raw API row shapes) stay here.
import type {
    GameBananaSection,
    GameBananaCategoryNode,
    GameBananaMod,
    GameBananaSubmitter,
    GameBananaArtistLink,
    GameBananaPreviewMedia,
    GameBananaPreviewMetadata,
    GameBananaImage,
    GameBananaCategory,
    GameBananaModsResponse,
    GameBananaFile,
    GameBananaComment,
    GameBananaModUpdateChange,
    GameBananaModUpdate,
    GameBananaModUpdatesResponse,
    GameBananaModDetails,
    GameBananaCollection,
    GameBananaCollectionItem,
    GameBananaCollectionItemsResponse,
    GameBananaModFileListEntry,
    GameBananaModFileList,
} from '../../../src/types/gamebanana';
export type {
    GameBananaSection,
    GameBananaCategoryNode,
    GameBananaMod,
    GameBananaSubmitter,
    GameBananaArtistLink,
    GameBananaPreviewMedia,
    GameBananaPreviewMetadata,
    GameBananaImage,
    GameBananaCategory,
    GameBananaModsResponse,
    GameBananaFile,
    GameBananaComment,
    GameBananaModUpdateChange,
    GameBananaModUpdate,
    GameBananaModUpdatesResponse,
    GameBananaModDetails,
    GameBananaCollection,
    GameBananaCollectionItem,
    GameBananaCollectionItemsResponse,
    GameBananaModFileListEntry,
    GameBananaModFileList,
};


// Debounce the rate-limit warning so a burst of 429s (e.g. the unknown-mod CRC
// matcher fanning out) produces one toast, not a flood. Broadcasting via
// BrowserWindow keeps this service free of an import cycle with ../index.
const RATE_LIMIT_NOTIFY_INTERVAL_MS = 10_000;
let lastRateLimitNotifyAt = 0;

function notifyRateLimited(): void {
    const now = Date.now();
    if (now - lastRateLimitNotifyAt < RATE_LIMIT_NOTIFY_INTERVAL_MS) return;
    lastRateLimitNotifyAt = now;
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('gamebanana:rate-limited', {});
    }
}

const GAMEBANANA_API_BASE = 'https://gamebanana.com/apiv11';
const GAMEBANANA_CORE_ITEM_DATA = 'https://api.gamebanana.com/Core/Item/Data';
const DEADLOCK_GAME_ID = 20948;
const CORE_ITEM_DATA_MAX_URL_LENGTH = 7_500;
const DEBUG_GAMEBANANA = process.env.GRIMOIRE_DEBUG_GAMEBANANA === '1';

// Types for GameBanana API responses
export interface GameBananaFileMetadata extends GameBananaFile {
    md5?: string;
}

export interface GameBananaFileMetadataRequest {
    id: number;
    section: string;
}

export interface GameBananaFileMetadataResult {
    modId: number;
    section: string;
    files: GameBananaFileMetadata[];
    error?: string;
}

// Raw API response types
interface SectionRaw {
    _sPluralTitle: string;
    _sModelName: string;
    _sCategoryModelName: string;
    _nItemCount: number;
}

interface CategoryNodeRaw {
    _idRow: number;
    _sName: string;
    _sProfileUrl?: string;
    _nItemCount: number;
    _sIconUrl?: string;
    _idParentRowId?: number;
    _aChildren?: CategoryNodeRaw[];
}

interface ModRaw {
    _idRow: number;
    _sName: string;
    _sProfileUrl: string;
    _tsDateAdded: number;
    _tsDateUpdated?: number;
    _tsDateModified?: number;
    _nLikeCount: number;
    _nViewCount: number;
    _nDownloadCount?: number;
    _bHasFiles: boolean;
    _bIsNsfw: boolean;
    _bHasContentRatings?: boolean; // Used as NSFW signal from list API (list API doesn't return _bIsNsfw)
    _aSubmitter?: {
        _idRow: number;
        _sName: string;
        _sProfileUrl?: string;
        _sAvatarUrl?: string;
        _aDonationMethods?: DonationMethodRaw[];
    };
    _aPreviewMedia?: {
        _aImages?: Array<{
            _sBaseUrl: string;
            _sFile: string;
            _sFile220?: string;
            _sFile530?: string;
        }>;
        _aMetadata?: {
            _sAudioUrl?: string;
        };
    };
    _aRootCategory?: {
        _idRow?: number;
        _sName: string;
        _sModelName?: string;
        _sProfileUrl?: string;
        _sIconUrl?: string;
    };
}

interface ApiResponseRaw {
    _aRecords: ModRaw[];
    _aMetadata: {
        _nRecordCount: number;
        _nPerpage: number;
        _bIsComplete: boolean;
    };
}

interface FileRaw {
    _idRow: number;
    _sFile: string;
    _nFilesize: number;
    _sDownloadUrl: string;
    _nDownloadCount: number;
    _tsDateAdded?: number;
    _sDescription?: string;
    _bIsArchived?: boolean;
    _sMd5Checksum?: string;
}

type CoreFileRaw = FileRaw;

interface PostRaw {
    _idRow: number;
    _sText: string;
    _tsDateAdded: number;
    _aPoster?: {
        _idRow: number;
        _sName: string;
        _sAvatarUrl?: string;
    };
}

interface PostsResponseRaw {
    _aRecords: PostRaw[];
    _aMetadata: {
        _nRecordCount: number;
        _nPerpage: number;
        _bIsComplete: boolean;
    };
}

interface UpdateRaw {
    _idRow?: number;
    _sVersion?: string;
    _sName?: string;
    _sTitle?: string;
    _sText?: string;
    _sDescription?: string;
    _sChangeLog?: string;
    // Structured changelog: mods authored with GameBanana's labeled changelog
    // editor leave _sText empty and put every line here as { text, cat },
    // where cat is the label (Bugfix, Feature, Addition, Adjustment, ...).
    _aChangeLog?: Array<{ text?: string; cat?: string }>;
    _tsDateAdded?: number;
    _tsDateModified?: number;
    _tsDateUpdated?: number;
}

interface UpdatesResponseRaw {
    _aRecords?: UpdateRaw[];
    _aMetadata?: {
        _nRecordCount?: number;
        _nPerpage?: number;
        _bIsComplete?: boolean;
    };
}

interface ModDetailsRaw {
    _idRow: number;
    _sName: string;
    _sText?: string;
    _bIsNsfw?: boolean;
    _aFiles?: FileRaw[];
    _aPreviewMedia?: ModRaw['_aPreviewMedia'];
    _aCategory?: ModRaw['_aRootCategory'];
    _aSubmitter?: ModRaw['_aSubmitter'];
}

interface DonationMethodRaw {
    _sTitle?: string;
    _sValue?: string;
    _sIconClasses?: string;
    _bIsUrl?: boolean;
}

interface CollectionRaw {
    _idRow: number;
    _sName: string;
    _sDescription?: string;
    _tsDateAdded: number;
    _tsDateModified: number;
    _aSubmitter?: ModRaw['_aSubmitter'];
    _aPreviewMedia?: ModRaw['_aPreviewMedia'];
}

interface CollectionItemRaw {
    _idRow: number;
    _sModelName: string;
    _sName: string;
    _sProfileUrl: string;
    _tsDateAdded: number;
    _tsDateModified?: number;
    _tsDateUpdated?: number;
    _bHasFiles?: boolean;
    _bHasContentRatings?: boolean;
    _bIsNsfw?: boolean;
    _nLikeCount?: number;
    _nViewCount?: number;
    _aSubmitter?: ModRaw['_aSubmitter'];
    _aPreviewMedia?: ModRaw['_aPreviewMedia'];
    _aRootCategory?: ModRaw['_aRootCategory'];
    _aGame?: {
        _idRow?: number;
        _sName?: string;
        _sProfileUrl?: string;
        _sIconUrl?: string;
    };
}

interface CollectionItemsResponseRaw {
    _aRecords: CollectionItemRaw[];
    _aMetadata: {
        _nRecordCount: number;
        _nPerpage: number;
        _bIsComplete: boolean;
    };
}

/**
 * Helper to fetch JSON from GameBanana API
 * Includes timeout (P1 fix #5) and rate limiting (P2 fix #13)
 */
interface GameBananaRequestOptions {
    signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new Error('GameBanana request cancelled');
    }
}

function debugGameBanana(...args: unknown[]): void {
    if (DEBUG_GAMEBANANA) {
        console.log(...args);
    }
}

function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener('abort', abort);
        },
    };
}

async function fetchJson<T>(url: string, timeoutMs = 30000, options: GameBananaRequestOptions = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
        throwIfAborted(options.signal);
        await gamebananaRateLimiter.acquire();
        throwIfAborted(options.signal);

        const request = createTimeoutSignal(timeoutMs, options.signal);
        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': GRIMOIRE_USER_AGENT,
                },
                signal: request.signal,
            });

            if (!response.ok) {
                if (response.status === 429) {
                    notifyRateLimited();
                }
                const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
                if (response.status === 429 && retryAfterMs !== null && retryAfterMs <= 60_000 && attempt === 0) {
                    request.cleanup();
                    await delayWithAbort(retryAfterMs, options.signal);
                    continue;
                }
                throw new Error(`GameBanana API error: ${response.status} ${response.statusText}`);
            }

            const text = await response.text();
            if (!text || text.trim() === '') {
                throw new Error('GameBanana API returned empty response');
            }

            try {
                return JSON.parse(text) as T;
            } catch (err) {
                console.error('[fetchJson] Failed to parse JSON:', text.slice(0, 200));
                throw new Error(`GameBanana API returned invalid JSON: ${err}`);
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                if (options.signal?.aborted) {
                    throw new Error('GameBanana request cancelled');
                }
                throw new Error(`GameBanana API request timed out after ${timeoutMs / 1000} seconds`);
            }
            throw err;
        } finally {
            request.cleanup();
        }
    }

    throw new Error('GameBanana API request failed');
}

function parseRetryAfterMs(value: string | null): number | null {
    if (!value) return null;

    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
        return Math.max(1_000, seconds * 1000);
    }

    const date = Date.parse(value);
    if (Number.isFinite(date)) {
        return Math.max(1_000, date - Date.now());
    }

    return null;
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('GameBanana request cancelled'));
            return;
        }

        const cleanup = () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        };
        const abort = () => {
            cleanup();
            reject(new Error('GameBanana request cancelled'));
        };
        const timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

/**
 * Map raw section to clean format
 */
function mapSection(raw: SectionRaw): GameBananaSection {
    return {
        pluralTitle: raw._sPluralTitle,
        modelName: raw._sModelName,
        categoryModelName: raw._sCategoryModelName,
        itemCount: raw._nItemCount,
    };
}

/**
 * Map raw category node to clean format (recursive)
 */
function mapCategoryNode(raw: CategoryNodeRaw): GameBananaCategoryNode {
    return {
        id: raw._idRow,
        name: raw._sName,
        profileUrl: raw._sProfileUrl,
        itemCount: raw._nItemCount,
        iconUrl: raw._sIconUrl,
        parentId: raw._idParentRowId,
        children: raw._aChildren?.map(mapCategoryNode),
    };
}

/**
 * Map raw mod to clean format
 */
function mapMod(raw: ModRaw): GameBananaMod {
    return {
        id: raw._idRow,
        name: raw._sName,
        profileUrl: raw._sProfileUrl,
        dateAdded: raw._tsDateAdded,
        dateModified: raw._tsDateModified ?? raw._tsDateUpdated ?? 0,
        likeCount: raw._nLikeCount,
        viewCount: raw._nViewCount,
        downloadCount: raw._nDownloadCount,
        hasFiles: raw._bHasFiles,
        // _bIsNsfw is only returned by detail API, but _bHasContentRatings is returned by list API
        // and correlates with NSFW status, so use it as fallback
        nsfw: raw._bIsNsfw ?? raw._bHasContentRatings ?? false,
        submitter: mapSubmitter(raw._aSubmitter),
        previewMedia: (raw._aPreviewMedia?._aImages || raw._aPreviewMedia?._aMetadata)
            ? {
                images: raw._aPreviewMedia._aImages
                    ?.filter((img) => img && img._sBaseUrl) // Filter out null/invalid images
                    .map((img) => ({
                        baseUrl: img._sBaseUrl,
                        file: img._sFile,
                        file220: img._sFile220,
                        file530: img._sFile530,
                    })),
                metadata: raw._aPreviewMedia._aMetadata
                    ? { audioUrl: raw._aPreviewMedia._aMetadata._sAudioUrl }
                    : undefined,
            }
            : undefined,
        rootCategory: raw._aRootCategory
            ? {
                id: raw._aRootCategory._idRow,
                name: raw._aRootCategory._sName,
                modelName: raw._aRootCategory._sModelName,
                profileUrl: raw._aRootCategory._sProfileUrl,
                iconUrl: raw._aRootCategory._sIconUrl,
            }
            : undefined,
    };
}

/**
 * Fetch comments/posts for a mod
 */
export async function fetchModComments(
    modId: number,
    section = 'Mod',
    page = 1,
    perPage = 15
): Promise<{ comments: GameBananaComment[]; totalCount: number }> {
    const url = `${GAMEBANANA_API_BASE}/${section}/${modId}/Posts?_nPerpage=${perPage}&_nPage=${page}`;
    const raw = await fetchJson<PostsResponseRaw>(url);

    return {
        comments: raw._aRecords.map((post) => ({
            id: post._idRow,
            text: post._sText,
            dateAdded: post._tsDateAdded,
            poster: {
                id: post._aPoster?._idRow ?? 0,
                name: post._aPoster?._sName ?? 'Unknown',
                avatarUrl: post._aPoster?._sAvatarUrl,
            },
        })),
        totalCount: raw._aMetadata._nRecordCount,
    };
}

/**
 * Fetch update/changelog records for a mod. GameBanana's update payloads are
 * sparse across item types, so map the common field names and let the renderer
 * hide empty records.
 */
export async function fetchModUpdates(
    modId: number,
    section = 'Mod',
    page = 1,
    perPage = 5
): Promise<GameBananaModUpdatesResponse> {
    const url = `${GAMEBANANA_API_BASE}/${section}/${modId}/Updates?_nPerpage=${perPage}&_nPage=${page}`;
    const raw = await fetchJson<UpdatesResponseRaw | UpdateRaw[]>(url);
    const records = Array.isArray(raw) ? raw : raw._aRecords ?? [];

    return {
        updates: records.map((update, index) => ({
            id: update._idRow ?? index,
            version: update._sVersion,
            title: update._sTitle ?? update._sName,
            text: update._sText ?? update._sChangeLog ?? update._sDescription,
            changes: (update._aChangeLog ?? [])
                .map((entry) => ({
                    text: (entry.text ?? '').trim(),
                    category: entry.cat?.trim() || undefined,
                }))
                .filter((entry) => entry.text.length > 0),
            dateAdded: update._tsDateAdded ?? update._tsDateModified ?? update._tsDateUpdated ?? 0,
        })),
        totalCount: Array.isArray(raw) ? records.length : raw._aMetadata?._nRecordCount ?? records.length,
    };
}

/**
 * Fetch available sections for Deadlock
 */
export async function fetchSections(): Promise<GameBananaSection[]> {
    // Rust: /Game/{id}/CategoryTree
    const url = `${GAMEBANANA_API_BASE}/Game/${DEADLOCK_GAME_ID}/CategoryTree`;
    debugGameBanana('[fetchSections] URL:', url);
    const raw = await fetchJson<SectionRaw[] | Record<string, SectionRaw>>(url);
    debugGameBanana('[fetchSections] Response type:', typeof raw, Array.isArray(raw));

    // Handle both array and object response formats
    const sections = Array.isArray(raw) ? raw : Object.values(raw);
    return sections.map(mapSection);
}

/**
 * Fetch category tree for a section
 */
export async function fetchCategoryTree(
    categoryModel: string,
    options: GameBananaRequestOptions = {}
): Promise<GameBananaCategoryNode[]> {
    // Rust: /Util/{model}/NestedStructure?_idGameRow={id}
    const url = `${GAMEBANANA_API_BASE}/Util/${categoryModel}/NestedStructure?_idGameRow=${DEADLOCK_GAME_ID}`;
    debugGameBanana('[fetchCategoryTree] URL:', url);
    const raw = await fetchJson<CategoryNodeRaw[] | Record<string, CategoryNodeRaw>>(url, 30000, options);

    // Handle both array and object response formats
    const categories = Array.isArray(raw) ? raw : Object.values(raw);
    return categories.map(mapCategoryNode);
}

/** Refresh a cached tree once it's older than this. Category trees change
 *  rarely (a new hero every few months), so a day of staleness is fine. */
const CATEGORY_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Category models with a background refresh already running. */
const categoryRefreshesInFlight = new Set<string>();

/**
 * Category tree with offline-first serving: return the locally cached tree
 * immediately when one exists (kicking off a background refresh once it's
 * older than CATEGORY_REFRESH_MS) and only block on the network when there's
 * no cache at all. The Locker hero grid derives from this tree, so without
 * the cache a GameBanana outage hangs the page for the full 30s timeout.
 */
export async function fetchCategoryTreeCached(
    categoryModel: string
): Promise<GameBananaCategoryNode[]> {
    const cached = readCategoryCache(categoryModel);
    if (cached) {
        if (Date.now() - cached.fetchedAt > CATEGORY_REFRESH_MS) {
            void refreshCategoryCache(categoryModel);
        }
        return cached.nodes;
    }
    const nodes = await fetchCategoryTree(categoryModel);
    persistCategoryCache(categoryModel, nodes);
    return nodes;
}

function readCategoryCache(
    categoryModel: string
): { fetchedAt: number; nodes: GameBananaCategoryNode[] } | null {
    try {
        const row = getCachedCategoryTree(categoryModel);
        if (!row) return null;
        const nodes = JSON.parse(row.payload) as GameBananaCategoryNode[];
        if (!Array.isArray(nodes) || nodes.length === 0) return null;
        return { fetchedAt: row.fetchedAt, nodes };
    } catch {
        return null; // unreadable cache = no cache; the live fetch repairs it
    }
}

function persistCategoryCache(
    categoryModel: string,
    nodes: GameBananaCategoryNode[]
): void {
    try {
        saveCachedCategoryTree(categoryModel, JSON.stringify(nodes));
    } catch (err) {
        console.warn('[fetchCategoryTreeCached] failed to persist cache:', err);
    }
}

async function refreshCategoryCache(categoryModel: string): Promise<void> {
    if (categoryRefreshesInFlight.has(categoryModel)) return;
    categoryRefreshesInFlight.add(categoryModel);
    try {
        persistCategoryCache(categoryModel, await fetchCategoryTree(categoryModel));
    } catch (err) {
        // Offline or API down: keep serving the stale tree.
        debugGameBanana('[fetchCategoryTreeCached] background refresh failed:', err);
    } finally {
        categoryRefreshesInFlight.delete(categoryModel);
    }
}

/**
 * Fetch mods from GameBanana
 */
export async function fetchSubmissions(
    model: string,
    page: number,
    perPage: number,
    search?: string,
    categoryId?: number,
    sort?: string,
    submitterId?: number,
    options: GameBananaRequestOptions = {}
): Promise<GameBananaModsResponse> {
    let url: string;
    // GameBanana's default list order (no _sSort) is by date *modified*, not date
    // added, so "Recently Added" (recent) has to request Generic_Newest explicitly
    // or it silently mirrors "Recently Updated". 'updated' maps to
    // Generic_LatestModified (date modified). Sort tokens verified against the live
    // apiv11 endpoint (Generic_LatestAdded/Generic_New are rejected as UNKNOWN_SORT).
    const sortMap: Record<string, string> = {
        likes: 'Generic_MostLiked',
        popular: 'Generic_MostLiked',
        views: 'Generic_MostViewed',
        recent: 'Generic_Newest',
        updated: 'Generic_LatestModified',
    };

    // Fields to request from GameBanana API (including NSFW flag)
    const fields = '_idRow,_sName,_sProfileUrl,_tsDateAdded,_tsDateModified,_nLikeCount,_nViewCount,_nDownloadCount,_bHasFiles,_bIsNsfw,_aSubmitter,_aPreviewMedia,_aRootCategory';

    // Use search endpoint when search query is provided
    if (search && search.trim()) {
        const params = new URLSearchParams();
        params.set('_sSearchString', search);
        // Util/Search/Results does not reliably honor Generic_Game; add explicit game/model scoping.
        params.set('_idGameRow', String(DEADLOCK_GAME_ID));
        params.set('_sModelName', model);
        params.set('_aFilters[Generic_Game]', String(DEADLOCK_GAME_ID));
        params.set('_aFilters[itemtype]', model);
        params.set('_nPerpage', String(perPage));
        params.set('_nPage', String(page));
        params.set('_csvProperties', fields);

        if (categoryId) {
            params.set('_aFilters[Generic_Category]', String(categoryId));
        }

        if (submitterId && submitterId > 0) {
            params.set('_aFilters[Generic_Submitter]', String(submitterId));
        }

        if (sort && sortMap[sort]) {
            params.set('_sSort', sortMap[sort]);
        }

        url = `${GAMEBANANA_API_BASE}/Util/Search/Results?${params.toString()}`;
    } else {
        const params = new URLSearchParams();
        // Some endpoints ignore Generic_Game without an explicit game id.
        params.set('_idGameRow', String(DEADLOCK_GAME_ID));
        params.set('_aFilters[Generic_Game]', String(DEADLOCK_GAME_ID));
        params.set('_nPerpage', String(perPage));
        params.set('_nPage', String(page));
        params.set('_csvProperties', fields);

        if (categoryId) {
            params.set('_aFilters[Generic_Category]', String(categoryId));
        }

        if (submitterId && submitterId > 0) {
            params.set('_aFilters[Generic_Submitter]', String(submitterId));
        }

        if (sort && sort !== 'default' && sortMap[sort]) {
            params.set('_sSort', sortMap[sort]);
        }

        url = `${GAMEBANANA_API_BASE}/${model}/Index?${params.toString()}`;
    }

    debugGameBanana('[fetchSubmissions] URL:', url);
    const raw = await fetchJson<ApiResponseRaw>(url, 30000, options);
    debugGameBanana('[fetchSubmissions] Response:', JSON.stringify(raw).slice(0, 500));

    // Handle case where response is an array instead of object
    const records = Array.isArray(raw) ? raw : (raw._aRecords || []);
    const metadata = Array.isArray(raw) ? null : raw._aMetadata;

    return {
        records: records.map(mapMod),
        totalCount: metadata?._nRecordCount ?? records.length,
        isComplete: metadata?._bIsComplete ?? true,
        perPage: metadata?._nPerpage ?? perPage,
    };
}

/**
 * Fetch mod details including files
 */
export async function fetchModDetails(
    modId: number,
    section = 'Mod',
    options: { includeSubmitter?: boolean } = {}
): Promise<GameBananaModDetails> {
    // Fetch mod details with NSFW flag
    const fields = [
        '_idRow',
        '_sName',
        '_sText',
        '_bIsNsfw',
        '_aCategory',
        '_aFiles',
        '_aPreviewMedia',
    ];
    if (options.includeSubmitter) {
        fields.push('_aSubmitter');
    }
    const params = new URLSearchParams({ _csvProperties: fields.join(',') });
    const url = `${GAMEBANANA_API_BASE}/${section}/${modId}?${params.toString()}`;
    debugGameBanana('[fetchModDetails] URL:', url);
    const raw = await fetchJson<ModDetailsRaw>(url);

    return {
        id: raw._idRow,
        name: raw._sName,
        description: raw._sText,
        nsfw: raw._bIsNsfw ?? false,
        category: raw._aCategory
            ? {
                id: raw._aCategory._idRow,
                name: raw._aCategory._sName,
                modelName: raw._aCategory._sModelName,
                profileUrl: raw._aCategory._sProfileUrl,
                iconUrl: raw._aCategory._sIconUrl,
            }
            : undefined,
        files: raw._aFiles?.map((f) => ({
            id: f._idRow,
            fileName: f._sFile,
            fileSize: f._nFilesize,
            downloadUrl: f._sDownloadUrl,
            downloadCount: f._nDownloadCount,
            dateAdded: f._tsDateAdded,
            description: f._sDescription,
            isArchived: f._bIsArchived ?? false,
        })),
        previewMedia: raw._aPreviewMedia
            ? {
                images: raw._aPreviewMedia._aImages?.map((img) => ({
                    baseUrl: img._sBaseUrl,
                    file: img._sFile,
                    file220: img._sFile220,
                    file530: img._sFile530,
                })),
                metadata: raw._aPreviewMedia._aMetadata
                    ? { audioUrl: raw._aPreviewMedia._aMetadata._sAudioUrl }
                    : undefined,
            }
        : undefined,
        submitter: mapSubmitter(raw._aSubmitter),
    };
}

interface ModFileListRaw {
    _idRow: number;
    _aFiles?: Array<{ _idRow: number; _bIsArchived?: boolean }>;
}

/**
 * Slim variant of fetchModDetails that asks GameBanana for only the file list.
 * The Installed page's update check uses this to scan every installed mod
 * cheaply on mount - the full details payload (description, preview media,
 * category) is wasteful when we only compare file ids.
 */
export async function fetchModFileList(
    modId: number,
    section = 'Mod'
): Promise<GameBananaModFileList> {
    const url = `${GAMEBANANA_API_BASE}/${section}/${modId}?_csvProperties=_idRow,_aFiles`;
    const raw = await fetchJson<ModFileListRaw>(url);
    return {
        id: raw._idRow,
        files: (raw._aFiles ?? []).map((f) => ({
            id: f._idRow,
            isArchived: f._bIsArchived ?? false,
        })),
    };
}

export async function fetchModsFilesMetadata(
    mods: GameBananaFileMetadataRequest[],
    includeArchived = true,
    options: GameBananaRequestOptions = {}
): Promise<GameBananaFileMetadataResult[]> {
    if (mods.length === 0) return [];

    const chunks = chunkCoreItemDataRequests(mods);
    if (chunks.length > 1) {
        const results: GameBananaFileMetadataResult[] = [];
        for (const chunk of chunks) {
            results.push(...await fetchModsFilesMetadata(chunk, includeArchived, options));
        }
        return results;
    }

    const params = buildFilesMetadataParams(mods);
    const requestUrl = `${GAMEBANANA_CORE_ITEM_DATA}?${params.toString()}`;
    debugGameBanana(
        `[GameBananaFiles] Metadata request (${mods.length} mod(s), ${requestUrl.length} chars, includeArchived=${includeArchived})`
    );

    const raw = await fetchJson<unknown>(requestUrl, 60000, options);
    const items = normalizeCoreItemDataResponse(raw);
    // Core/Item/Data returns one positional slot per requested item, in request
    // order (a missing mod still occupies its slot as `{"name":null}`), so
    // results map back by index. A length mismatch means the response was
    // truncated/reshaped: `items[index]` is then undefined for the tail, which
    // mapCoreFileMetadataResult turns into a per-mod error rather than pairing a
    // file with the wrong mod's identity. Surface it so it's diagnosable instead
    // of silently dropping metadata.
    if (items.length !== mods.length) {
        console.warn(
            `[GameBananaFiles] Metadata response slot count (${items.length}) does not match request count (${mods.length}); affected mods will fall back to no-metadata for this batch.`
        );
    }
    const results = mods.map((mod, index) => mapCoreFileMetadataResult(mod, items[index], includeArchived));
    const fileCount = results.reduce((total, result) => total + result.files.length, 0);
    const errorCount = results.filter((result) => result.error).length;
    debugGameBanana(
        `[GameBananaFiles] Metadata response (${results.length} mod(s), ${fileCount} file(s), ${errorCount} error(s))`
    );

    return results;
}

function normalizeCoreItemDataResponse(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
        const keyed = raw as Record<string, unknown>;
        const numericKeys = Object.keys(keyed)
            .filter((key) => /^\d+$/.test(key))
            .sort((a, b) => Number(a) - Number(b));
        if (numericKeys.length > 0) {
            const items: unknown[] = [];
            for (const key of numericKeys) {
                items[Number(key)] = keyed[key];
            }
            return items;
        }
    }
    return [raw];
}

function buildFilesMetadataParams(mods: GameBananaFileMetadataRequest[]): URLSearchParams {
    const params = new URLSearchParams({
        return_keys: '1',
        format: 'json_min',
    });
    mods.forEach((mod, index) => {
        params.set(`itemtype[${index}]`, mod.section);
        params.set(`itemid[${index}]`, String(mod.id));
        params.set(`fields[${index}]`, 'name,Files().aFiles()');
    });
    return params;
}

function chunkCoreItemDataRequests(mods: GameBananaFileMetadataRequest[]): GameBananaFileMetadataRequest[][] {
    const chunks: GameBananaFileMetadataRequest[][] = [];
    let current: GameBananaFileMetadataRequest[] = [];

    for (const mod of mods) {
        const next = [...current, mod];
        const urlLength = `${GAMEBANANA_CORE_ITEM_DATA}?${buildFilesMetadataParams(next).toString()}`.length;
        if (current.length > 0 && urlLength > CORE_ITEM_DATA_MAX_URL_LENGTH) {
            chunks.push(current);
            current = [mod];
        } else {
            current = next;
        }
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
}

function mapCoreFileMetadataResult(
    mod: GameBananaFileMetadataRequest,
    item: unknown,
    includeArchived: boolean
): GameBananaFileMetadataResult {
    if (!item || typeof item !== 'object') {
        return { modId: mod.id, section: mod.section, files: [], error: 'GameBanana returned no metadata for this mod' };
    }
    if ('error' in item) {
        return {
            modId: mod.id,
            section: mod.section,
            files: [],
            error: String((item as { error?: unknown }).error ?? 'GameBanana returned an item error'),
        };
    }

    return {
        modId: mod.id,
        section: mod.section,
        files: parseCoreFilesMetadata(item, includeArchived),
    };
}

function parseCoreFilesMetadata(raw: object, includeArchived: boolean): GameBananaFileMetadata[] {
    const keyed = raw as Record<string, unknown>;
    const filesRaw = keyed['Files().aFiles()'] ?? (Array.isArray(raw) ? raw[1] : undefined);
    if (!filesRaw || typeof filesRaw !== 'object') {
        return [];
    }

    const files: GameBananaFileMetadata[] = [];
    for (const [key, value] of Object.entries(filesRaw as Record<string, CoreFileRaw>)) {
        if (!value || typeof value !== 'object') continue;

        const id = Number(value._idRow ?? key);
        if (!Number.isFinite(id) || id <= 0) continue;

        const isArchived = !!value._bIsArchived;
        if (isArchived && !includeArchived) continue;

        files.push({
            id,
            fileName: value._sFile || `gamebanana-${id}.download`,
            fileSize: Number(value._nFilesize) || 0,
            downloadUrl: value._sDownloadUrl || `https://gamebanana.com/dl/${id}`,
            downloadCount: Number(value._nDownloadCount) || 0,
            description: value._sDescription,
            isArchived,
            md5: value._sMd5Checksum,
        });
    }

    return files.sort((a, b) => Number(a.isArchived) - Number(b.isArchived));
}

function mapSubmitter(raw: ModRaw['_aSubmitter']): GameBananaSubmitter | undefined {
    if (!raw) return undefined;
    return {
        id: raw._idRow,
        name: raw._sName,
        avatarUrl: raw._sAvatarUrl,
        profileUrl: raw._sProfileUrl,
        kofiUrl: extractKofiUrl(raw._aDonationMethods),
    };
}

interface ContactInfoRaw {
    _sTitle?: string;
    _sValue?: string;
    _sIconClasses?: string;
    _sValueTemplate?: string;
}

interface ProfilePageRaw {
    _bIsPrivate?: boolean;
    _aContactInfo?: ContactInfoRaw[];
}

// Artist social links aren't carried on a mod's submitter payload; they live on
// the member's profile. Cache per member id so reopening mods by the same
// author (common while browsing) doesn't refetch.
const submitterLinksCache = new Map<number, GameBananaArtistLink[]>();

/**
 * Fetch an artist's social/contact links (Bluesky, YouTube, Discord, website,
 * etc.) from their GameBanana member profile. Best-effort: a private profile,
 * a network error, or an empty contact list all resolve to an empty array so
 * the details view simply shows no extra links.
 */
export async function fetchSubmitterLinks(memberId: number): Promise<GameBananaArtistLink[]> {
    if (!Number.isFinite(memberId) || memberId <= 0) return [];

    const cached = submitterLinksCache.get(memberId);
    if (cached) return cached;

    let links: GameBananaArtistLink[] = [];
    try {
        const raw = await fetchJson<ProfilePageRaw>(`${GAMEBANANA_API_BASE}/Member/${memberId}/ProfilePage`);
        if (!raw._bIsPrivate) {
            links = mapContactInfo(raw._aContactInfo);
        }
    } catch (err) {
        // Don't cache the failure: a transient 429 or network blip would
        // otherwise hide this artist's socials until the app restarts.
        console.warn('[gamebanana] Failed to load submitter links:', err);
        return [];
    }

    submitterLinksCache.set(memberId, links);
    return links;
}

function mapContactInfo(items: ContactInfoRaw[] | undefined): GameBananaArtistLink[] {
    const out: GameBananaArtistLink[] = [];
    const seen = new Set<string>();
    for (const item of items ?? []) {
        const label = item._sTitle?.trim();
        if (!label) continue;
        const url = buildContactUrl(item);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({ label, platform: normalizeContactPlatform(item._sIconClasses, label), url });
    }
    return out;
}

/**
 * Resolve a contact entry's stored value into a usable absolute URL. GameBanana
 * stores either a bare handle (combined with a `%VALUE%` href template) or, when
 * users paste a full path, a value that already contains the host - in which
 * case naive template substitution double-prefixes it (e.g.
 * `bsky.app/profile/bsky.app/...`). We detect that and use the value directly.
 */
function buildContactUrl(item: ContactInfoRaw): string | undefined {
    const value = item._sValue?.trim();
    if (!value) return undefined;

    let candidate: string | undefined;
    if (/^https?:\/\//i.test(value)) {
        candidate = value;
    } else {
        const hrefMatch = item._sValueTemplate?.match(/href="([^"]*%VALUE%[^"]*)"/i);
        const templateHref = hrefMatch?.[1];
        if (templateHref) {
            const prefix = templateHref.split('%VALUE%')[0];
            let host = '';
            try {
                host = new URL(prefix).hostname.toLowerCase();
            } catch {
                host = '';
            }
            candidate =
                host && value.toLowerCase().includes(host)
                    ? `https://${value.replace(/^https?:\/\//i, '')}`
                    : templateHref.replace('%VALUE%', value);
        } else {
            candidate = `https://${value.replace(/^https?:\/\//i, '')}`;
        }
    }

    try {
        const url = new URL(candidate);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

// GameBanana tags each contact with an icon class like
// "ContactTypeIcon BlueskyIcon"; pull the platform token out of it (ignoring the
// generic "ContactType" prefix), falling back to a slug of the label.
function normalizeContactPlatform(iconClasses: string | undefined, label: string): string {
    const tokens = [...(iconClasses ?? '').matchAll(/([A-Za-z0-9]+)Icon\b/g)]
        .map((m) => m[1].toLowerCase())
        .filter((token) => token !== 'contacttype');
    if (tokens.length > 0) return tokens[0];
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function extractKofiUrl(methods: DonationMethodRaw[] | undefined): string | undefined {
    for (const method of methods ?? []) {
        const title = method._sTitle?.toLowerCase() ?? '';
        const icon = method._sIconClasses?.toLowerCase() ?? '';
        if (!title.includes('ko-fi') && !title.includes('kofi') && !icon.includes('kofi')) {
            continue;
        }

        const url = normalizeKofiUrl(method._sValue);
        if (url) return url;
    }
    return undefined;
}

function normalizeKofiUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;

    try {
        const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
        const hostname = url.hostname.toLowerCase();
        if (hostname !== 'ko-fi.com' && hostname !== 'www.ko-fi.com') return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

function mapPreviewMedia(raw: ModRaw['_aPreviewMedia']): GameBananaPreviewMedia | undefined {
    if (!raw?._aImages && !raw?._aMetadata) return undefined;
    return {
        images: raw._aImages
            ?.filter((img) => img && img._sBaseUrl)
            .map((img) => ({
                baseUrl: img._sBaseUrl,
                file: img._sFile,
                file220: img._sFile220,
                file530: img._sFile530,
            })),
        metadata: raw._aMetadata ? { audioUrl: raw._aMetadata._sAudioUrl } : undefined,
    };
}

/**
 * Parse a collection identifier from either a numeric id or a GameBanana URL.
 * Accepts "164637", "https://gamebanana.com/collections/164637", or trailing
 * fragments/queries. Returns null on garbage so the UI can show a friendly error.
 */
export function parseCollectionId(input: string): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    try {
        const url = new URL(trimmed);
        if (!url.hostname.endsWith('gamebanana.com')) return null;
        const match = url.pathname.match(/\/collections\/(\d+)/i);
        if (!match) return null;
        const n = Number(match[1]);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
}

/**
 * Fetch a collection's metadata (name, description, submitter, preview).
 * Items live on a separate endpoint — see fetchCollectionItems.
 */
export async function fetchCollection(collectionId: number): Promise<GameBananaCollection> {
    const url = `${GAMEBANANA_API_BASE}/Collection/${collectionId}?_csvProperties=_idRow,_sName,_sDescription,_aSubmitter,_aPreviewMedia,_tsDateAdded,_tsDateModified`;
    console.log('[fetchCollection] URL:', url);
    const raw = await fetchJson<CollectionRaw>(url);

    return {
        id: raw._idRow,
        name: raw._sName,
        description: raw._sDescription,
        dateAdded: raw._tsDateAdded,
        dateModified: raw._tsDateModified,
        submitter: mapSubmitter(raw._aSubmitter),
        previewMedia: mapPreviewMedia(raw._aPreviewMedia),
    };
}

/**
 * Fetch one page of collection items. The Items endpoint server-caps perPage
 * at 15 regardless of the requested value, so callers paginate by incrementing
 * `page` until `isComplete` is true.
 */
export async function fetchCollectionItems(
    collectionId: number,
    page = 1
): Promise<GameBananaCollectionItemsResponse> {
    const url = `${GAMEBANANA_API_BASE}/Collection/${collectionId}/Items?_nPage=${page}`;
    console.log('[fetchCollectionItems] URL:', url);
    const raw = await fetchJson<CollectionItemsResponseRaw>(url);

    const records = (raw._aRecords ?? []).map<GameBananaCollectionItem>((item) => ({
        id: item._idRow,
        modelName: item._sModelName,
        name: item._sName,
        profileUrl: item._sProfileUrl,
        dateAdded: item._tsDateAdded,
        dateModified: item._tsDateModified ?? item._tsDateUpdated ?? item._tsDateAdded,
        likeCount: item._nLikeCount ?? 0,
        viewCount: item._nViewCount ?? 0,
        hasFiles: item._bHasFiles ?? false,
        // Items endpoint doesn't return _bIsNsfw; fall back to _bHasContentRatings
        // (same heuristic used by mapMod for list endpoints).
        nsfw: item._bIsNsfw ?? item._bHasContentRatings ?? false,
        gameId: item._aGame?._idRow,
        gameName: item._aGame?._sName,
        submitter: mapSubmitter(item._aSubmitter),
        previewMedia: mapPreviewMedia(item._aPreviewMedia),
        rootCategory: item._aRootCategory
            ? {
                id: item._aRootCategory._idRow,
                name: item._aRootCategory._sName,
                modelName: item._aRootCategory._sModelName,
                profileUrl: item._aRootCategory._sProfileUrl,
                iconUrl: item._aRootCategory._sIconUrl,
            }
            : undefined,
    }));

    return {
        records,
        totalCount: raw._aMetadata._nRecordCount,
        isComplete: raw._aMetadata._bIsComplete,
        perPage: raw._aMetadata._nPerpage,
    };
}
