import type { Mod, AppSettings } from './mod';
import type {
    GameBananaModsResponse,
    GameBananaModDetails,
    GameBananaSection,
    GameBananaCategoryNode,
} from './gamebanana';

export interface BrowseModsArgs {
    page: number;
    perPage: number;
    search?: string;
    section?: string;
    categoryId?: number;
    sort?: string;
}

export interface GetModDetailsArgs {
    modId: number;
    section?: string;
}

export interface DownloadModArgs {
    modId: number;
    fileId: number;
    fileName: string;
    section?: string;
    categoryId?: number;
}

export interface GetCategoriesArgs {
    categoryModelName: string;
}

export interface SetMinaPresetArgs {
    presetFileName: string;
}

export interface ListMinaVariantsArgs {
    archivePath: string;
}

export interface ApplyMinaVariantArgs {
    archivePath: string;
    archiveEntry: string;
    presetLabel: string;
    heroCategoryId?: number;
}

export interface CleanupResult {
    removedArchives: number;
    renamedMinaPresets: number;
    renamedMinaTextures: number;
    skippedMinaPresets: number;
    skippedMinaTextures: number;
}

export interface GameinfoStatus {
    configured: boolean;
    message: string;
}

export interface OpenDialogOptions {
    directory?: boolean;
    title?: string;
    defaultPath?: string;
}

export interface DownloadProgressData {
    modId: number;
    fileId: number;
    downloaded: number;
    total: number;
}

export interface DownloadEventData {
    modId: number;
    fileId: number;
}

export interface SyncProgressData {
    section: string;
    currentPage: number;
    totalPages: number;
    modsProcessed: number;
    totalMods: number;
    phase: 'fetching' | 'complete' | 'error';
    error?: string;
}

export interface SearchLocalModsOptions {
    query?: string;
    section?: string;
    categoryId?: number;
    sortBy?: 'relevance' | 'likes' | 'date' | 'views' | 'name';
    limit?: number;
    offset?: number;
}

export interface LocalSearchResult {
    mods: CachedMod[];
    totalCount: number;
    offset: number;
    limit: number;
}

export interface CachedMod {
    id: number;
    name: string;
    section: string;
    categoryId: number | null;
    categoryName: string | null;
    submitterName: string | null;
    submitterId: number | null;
    likeCount: number;
    viewCount: number;
    dateAdded: number;
    dateModified: number;
    hasFiles: boolean;
    isNsfw: boolean;
    thumbnailUrl: string | null;
    profileUrl: string;
    cachedAt: number;
}

export interface ElectronAPI {
    // Settings
    detectDeadlock: () => Promise<string | null>;
    validateDeadlockPath: (path: string) => Promise<boolean>;
    createDevDeadlockPath: () => Promise<string>;
    getSettings: () => Promise<AppSettings>;
    setSettings: (settings: AppSettings) => Promise<void>;

    // Mods
    getMods: () => Promise<Mod[]>;
    enableMod: (modId: string) => Promise<Mod>;
    disableMod: (modId: string) => Promise<Mod>;
    deleteMod: (modId: string) => Promise<void>;
    setModPriority: (modId: string, priority: number) => Promise<Mod>;

    // GameBanana
    browseMods: (args: BrowseModsArgs) => Promise<GameBananaModsResponse>;
    getModDetails: (args: GetModDetailsArgs) => Promise<GameBananaModDetails>;
    downloadMod: (args: DownloadModArgs) => Promise<void>;
    getGameBananaSections: () => Promise<GameBananaSection[]>;
    getGameBananaCategories: (args: GetCategoriesArgs) => Promise<GameBananaCategoryNode[]>;

    // Mina Variants
    setMinaPreset: (args: SetMinaPresetArgs) => Promise<void>;
    listMinaVariants: (args: ListMinaVariantsArgs) => Promise<string[]>;
    applyMinaVariant: (args: ApplyMinaVariantArgs) => Promise<void>;

    // Maintenance
    cleanupAddons: () => Promise<CleanupResult>;
    getGameinfoStatus: () => Promise<GameinfoStatus>;
    fixGameinfo: () => Promise<GameinfoStatus>;

    // Dialogs
    showOpenDialog: (options: OpenDialogOptions) => Promise<string | null>;

    // Events
    onDownloadProgress: (callback: (data: DownloadProgressData) => void) => () => void;
    onDownloadExtracting: (callback: (data: DownloadEventData) => void) => () => void;
    onDownloadComplete: (callback: (data: DownloadEventData) => void) => () => void;

    // Conflicts
    getConflicts: () => Promise<ModConflict[]>;

    // Profiles
    getProfiles: () => Promise<Profile[]>;
    createProfile: (name: string) => Promise<Profile>;
    updateProfile: (profileId: string) => Promise<Profile>;
    applyProfile: (profileId: string) => Promise<void>;
    deleteProfile: (profileId: string) => Promise<void>;
    renameProfile: (profileId: string, newName: string) => Promise<Profile>;

    // Mod Database (Local Cache)
    syncAllMods: () => Promise<{ success: boolean }>;
    syncSection: (section: string) => Promise<{ success: boolean }>;
    wipeModCache: () => Promise<{ success: boolean }>;
    getSyncStatus: () => Promise<Record<string, { lastSync: number; count: number } | null>>;
    needsSync: () => Promise<boolean>;
    isSyncInProgress: () => Promise<boolean>;
    searchLocalMods: (options: SearchLocalModsOptions) => Promise<LocalSearchResult>;
    getCachedMod: (id: number) => Promise<CachedMod | null>;
    getLocalModCount: (section?: string) => Promise<number>;
    getLocalCategories: (section?: string) => Promise<Array<{ id: number; name: string; count: number }>>;
    getSectionStats: () => Promise<Array<{ section: string; count: number }>>;
    onSyncProgress: (callback: (data: SyncProgressData) => void) => () => void;
}

export interface ModConflict {
    modA: string;
    modAName: string;
    modB: string;
    modBName: string;
    conflictType: 'priority' | 'samefile';
    details: string;
}

export interface ProfileMod {
    fileName: string;
    enabled: boolean;
    priority: number;
}

export interface Profile {
    id: string;
    name: string;
    mods: ProfileMod[];
    createdAt: string;
    updatedAt: string;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
