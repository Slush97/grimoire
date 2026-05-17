import { gamebananaRateLimiter } from './rateLimiter';

const GAMEBANANA_API_BASE = 'https://gamebanana.com/apiv11';
const GAMEBANANA_API_V12_BASE = 'https://gamebanana.com/apiv12';
const GAMEBANANA_CORE_ITEM_DATA = 'https://api.gamebanana.com/Core/Item/Data';
const DEADLOCK_GAME_ID = 20948;

// Types for GameBanana API responses
export interface GameBananaSection {
    pluralTitle: string;
    modelName: string;
    categoryModelName: string;
    itemCount: number;
}

export interface GameBananaCategoryNode {
    id: number;
    name: string;
    profileUrl?: string;
    itemCount: number;
    iconUrl?: string;
    parentId?: number;
    children?: GameBananaCategoryNode[];
}

export interface GameBananaMod {
    id: number;
    name: string;
    profileUrl: string;
    dateAdded: number;
    dateModified: number;
    likeCount: number;
    viewCount: number;
    downloadCount?: number;
    hasFiles: boolean;
    nsfw: boolean;
    submitter?: GameBananaSubmitter;
    previewMedia?: GameBananaPreviewMedia;
    rootCategory?: GameBananaCategory;
}

export interface GameBananaSubmitter {
    id: number;
    name: string;
    avatarUrl?: string;
}

export interface GameBananaPreviewMedia {
    images?: GameBananaImage[];
    metadata?: GameBananaPreviewMetadata;
}

export interface GameBananaPreviewMetadata {
    audioUrl?: string;
}

export interface GameBananaImage {
    baseUrl: string;
    file: string;
    file220?: string;
    file530?: string;
}

export interface GameBananaCategory {
    id?: number;
    name: string;
    modelName?: string;
    profileUrl?: string;
    iconUrl?: string;
}

export interface GameBananaModsResponse {
    records: GameBananaMod[];
    totalCount: number;
    isComplete: boolean;
    perPage: number;
}

export interface GameBananaFile {
    id: number;
    fileName: string;
    fileSize: number;
    downloadUrl: string;
    downloadCount: number;
    description?: string;
    isArchived: boolean;
}

export interface GameBananaFileWithRawPaths extends GameBananaFile {
    rawVpkPaths: string[];
    rawVpkPathsError?: string;
    md5?: string;
}

export interface GameBananaComment {
    id: number;
    text: string;
    dateAdded: number;
    poster: {
        id: number;
        name: string;
        avatarUrl?: string;
    };
}

export interface GameBananaModDetails {
    id: number;
    name: string;
    description?: string;
    nsfw: boolean;
    category?: GameBananaCategory;
    files?: GameBananaFile[];
    previewMedia?: GameBananaPreviewMedia;
}

export interface GameBananaCollection {
    id: number;
    name: string;
    description?: string;
    dateAdded: number;
    dateModified: number;
    submitter?: GameBananaSubmitter;
    previewMedia?: GameBananaPreviewMedia;
}

export interface GameBananaCollectionItem {
    id: number;
    modelName: string;
    name: string;
    profileUrl: string;
    dateAdded: number;
    dateModified: number;
    likeCount: number;
    viewCount: number;
    hasFiles: boolean;
    nsfw: boolean;
    gameId?: number;
    gameName?: string;
    submitter?: GameBananaSubmitter;
    previewMedia?: GameBananaPreviewMedia;
    rootCategory?: GameBananaCategory;
}

export interface GameBananaCollectionItemsResponse {
    records: GameBananaCollectionItem[];
    totalCount: number;
    isComplete: boolean;
    perPage: number;
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
        _sAvatarUrl?: string;
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

interface ModDetailsRaw {
    _idRow: number;
    _sName: string;
    _sText?: string;
    _bIsNsfw?: boolean;
    _aFiles?: FileRaw[];
    _aPreviewMedia?: ModRaw['_aPreviewMedia'];
    _aCategory?: ModRaw['_aRootCategory'];
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
    throwIfAborted(options.signal);
    // Apply rate limiting before making request
    await gamebananaRateLimiter.acquire();
    throwIfAborted(options.signal);

    // Create abort controller for timeout
    const request = createTimeoutSignal(timeoutMs, options.signal);

    try {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'DeadlockModManager/1.0',
            },
            signal: request.signal,
        });

        if (!response.ok) {
            throw new Error(`GameBanana API error: ${response.status} ${response.statusText}`);
        }

        // Check for empty response body
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

async function fetchText(url: string, timeoutMs = 30000, options: GameBananaRequestOptions = {}): Promise<string> {
    throwIfAborted(options.signal);
    await gamebananaRateLimiter.acquire();
    throwIfAborted(options.signal);

    const request = createTimeoutSignal(timeoutMs, options.signal);

    try {
        const response = await fetch(url, {
            headers: {
                Accept: 'text/plain',
                'User-Agent': 'DeadlockModManager/1.0',
            },
            signal: request.signal,
        });

        if (!response.ok) {
            throw new Error(`GameBanana API error: ${response.status} ${response.statusText}`);
        }

        return response.text();
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
        submitter: raw._aSubmitter
            ? {
                id: raw._aSubmitter._idRow,
                name: raw._aSubmitter._sName,
                avatarUrl: raw._aSubmitter._sAvatarUrl,
            }
            : undefined,
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
 * Fetch available sections for Deadlock
 */
export async function fetchSections(): Promise<GameBananaSection[]> {
    // Rust: /Game/{id}/CategoryTree
    const url = `${GAMEBANANA_API_BASE}/Game/${DEADLOCK_GAME_ID}/CategoryTree`;
    console.log('[fetchSections] URL:', url);
    const raw = await fetchJson<SectionRaw[] | Record<string, SectionRaw>>(url);
    console.log('[fetchSections] Response type:', typeof raw, Array.isArray(raw));

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
    console.log('[fetchCategoryTree] URL:', url);
    const raw = await fetchJson<CategoryNodeRaw[] | Record<string, CategoryNodeRaw>>(url, 30000, options);

    // Handle both array and object response formats
    const categories = Array.isArray(raw) ? raw : Object.values(raw);
    return categories.map(mapCategoryNode);
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
    options: GameBananaRequestOptions = {}
): Promise<GameBananaModsResponse> {
    let url: string;
    // GameBanana v11 API only reliably supports likes/views sorting
    // Default API order is already sorted by recent submissions, so 'new', 'recent', 'updated' don't need explicit sort
    const sortMap: Record<string, string> = {
        likes: 'Generic_MostLiked',
        popular: 'Generic_MostLiked',
        views: 'Generic_MostViewed',
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

        if (sort && sort !== 'default' && sortMap[sort]) {
            params.set('_sSort', sortMap[sort]);
        }

        url = `${GAMEBANANA_API_BASE}/${model}/Index?${params.toString()}`;
    }

    console.log('[fetchSubmissions] URL:', url);
    const raw = await fetchJson<ApiResponseRaw>(url, 30000, options);
    console.log('[fetchSubmissions] Response:', JSON.stringify(raw).slice(0, 500));

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
    section = 'Mod'
): Promise<GameBananaModDetails> {
    // Fetch mod details with NSFW flag
    const url = `${GAMEBANANA_API_BASE}/${section}/${modId}?_csvProperties=_idRow,_sName,_sText,_bIsNsfw,_aCategory,_aFiles,_aPreviewMedia`;
    console.log('[fetchModDetails] URL:', url);
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
    };
}

function isVpkPath(path: string): boolean {
    const normalized = path.replace(/\\/g, '/').trim().toLowerCase();
    return normalized.endsWith('.vpk') && !normalized.endsWith('/');
}

function parseRawVpkPaths(rawFileList: string): string[] {
    return [...new Set(
        rawFileList
            .split(/\r?\n/)
            .map((line) => line.trim().replace(/\\/g, '/'))
            .filter(isVpkPath)
    )].sort((a, b) => a.localeCompare(b));
}

export async function fetchRawVpkPaths(fileId: number, options: GameBananaRequestOptions = {}): Promise<string[]> {
    const text = await fetchText(`${GAMEBANANA_API_V12_BASE}/File/${fileId}/RawFileList`, 30000, options);
    return parseRawVpkPaths(text);
}

export async function fetchModFilesWithRawPaths(
    modId: number,
    section = 'Mod',
    includeArchived = true,
    options: GameBananaRequestOptions = {}
): Promise<GameBananaFileWithRawPaths[]> {
    const params = new URLSearchParams({
        itemtype: section,
        itemid: String(modId),
        fields: 'name,Files().aFiles()',
        return_keys: '1',
        format: 'json_min',
    });
    const raw = await fetchJson<Record<string, unknown>>(`${GAMEBANANA_CORE_ITEM_DATA}?${params.toString()}`, 30000, options);
    const filesRaw = raw['Files().aFiles()'];
    if (!filesRaw || typeof filesRaw !== 'object') {
        return [];
    }

    const files: Array<Omit<GameBananaFileWithRawPaths, 'rawVpkPaths'>> = [];
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

    const filesWithRawPaths = await Promise.all(
        files.map(async (file) => {
            try {
                return {
                    ...file,
                    rawVpkPaths: await fetchRawVpkPaths(file.id, options),
                };
            } catch (err) {
                return {
                    ...file,
                    rawVpkPaths: [],
                    rawVpkPathsError: err instanceof Error ? err.message : String(err),
                };
            }
        })
    );

    return filesWithRawPaths.sort((a, b) => Number(a.isArchived) - Number(b.isArchived));
}

function mapSubmitter(raw: ModRaw['_aSubmitter']): GameBananaSubmitter | undefined {
    if (!raw) return undefined;
    return {
        id: raw._idRow,
        name: raw._sName,
        avatarUrl: raw._sAvatarUrl,
    };
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
