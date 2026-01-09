import { gamebananaRateLimiter } from './rateLimiter';

const GAMEBANANA_API_BASE = 'https://gamebanana.com/apiv11';
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
    _tsDateUpdated: number;
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

/**
 * Helper to fetch JSON from GameBanana API
 * Includes timeout (P1 fix #5) and rate limiting (P2 fix #13)
 */
async function fetchJson<T>(url: string, timeoutMs = 30000): Promise<T> {
    // Apply rate limiting before making request
    await gamebananaRateLimiter.acquire();

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'DeadlockModManager/1.0',
            },
            signal: controller.signal,
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
            throw new Error(`GameBanana API request timed out after ${timeoutMs / 1000} seconds`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
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
        dateModified: raw._tsDateUpdated,
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
    categoryModel: string
): Promise<GameBananaCategoryNode[]> {
    // Rust: /Util/{model}/NestedStructure?_idGameRow={id}
    const url = `${GAMEBANANA_API_BASE}/Util/${categoryModel}/NestedStructure?_idGameRow=${DEADLOCK_GAME_ID}`;
    console.log('[fetchCategoryTree] URL:', url);
    const raw = await fetchJson<CategoryNodeRaw[] | Record<string, CategoryNodeRaw>>(url);

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
    sort?: string
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
    const fields = '_idRow,_sName,_sProfileUrl,_tsDateAdded,_tsDateUpdated,_nLikeCount,_nViewCount,_nDownloadCount,_bHasFiles,_bIsNsfw,_aSubmitter,_aPreviewMedia,_aRootCategory';

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
    const raw = await fetchJson<ApiResponseRaw>(url);
    console.log('[fetchSubmissions] Response:', JSON.stringify(raw).slice(0, 500));

    // Handle case where response is an array instead of object
    let records = Array.isArray(raw) ? raw : (raw._aRecords || []);
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
