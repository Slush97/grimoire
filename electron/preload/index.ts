import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
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

// Minimal type stubs (full types are in renderer)
interface AppSettings {
    deadlockPath: string | null;
    autoConfigureGameInfo: boolean;
    devMode: boolean;
    devDeadlockPath: string | null;
    hideNsfwPreviews: boolean;
}

interface Mod {
    id: string;
    name: string;
    fileName: string;
    path: string;
    enabled: boolean;
    priority: number;
    size: number;
    installedAt: string;
    description?: string;
    thumbnailUrl?: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
    categoryId?: number;
    sourceSection?: string;
    nsfw?: boolean;
}

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

interface DownloadModArgs {
    modId: number;
    fileId: number;
    fileName: string;
    section?: string;
    categoryId?: number;
}

interface GetCategoriesArgs {
    categoryModelName: string;
}

interface SetMinaPresetArgs {
    presetFileName: string;
}

interface ListMinaVariantsArgs {
    archivePath: string;
}

interface ApplyMinaVariantArgs {
    archivePath: string;
    archiveEntry: string;
    presetLabel: string;
    heroCategoryId?: number;
}

interface CleanupResult {
    removedArchives: number;
    renamedMinaPresets: number;
    renamedMinaTextures: number;
    skippedMinaPresets: number;
    skippedMinaTextures: number;
}

interface GameinfoStatus {
    configured: boolean;
    message: string;
}

interface OpenDialogOptions {
    directory?: boolean;
    title?: string;
    defaultPath?: string;
}

interface DownloadProgressData {
    modId: number;
    fileId: number;
    downloaded: number;
    total: number;
}

interface DownloadEventData {
    modId: number;
    fileId: number;
}

interface GameBananaModsResponse {
    records: unknown[];
    totalCount: number;
    isComplete: boolean;
    perPage: number;
}

interface GameBananaModDetails {
    id: number;
    name: string;
    description?: string;
    category?: unknown;
    files?: unknown[];
    previewMedia?: unknown;
}

interface GameBananaSection {
    pluralTitle: string;
    modelName: string;
    categoryModelName: string;
    itemCount: number;
}

interface GameBananaCategoryNode {
    id: number;
    name: string;
    profileUrl?: string;
    itemCount: number;
    iconUrl?: string;
    parentId?: number;
    children?: GameBananaCategoryNode[];
}

interface ModConflict {
    modA: string;
    modAName: string;
    modB: string;
    modBName: string;
    conflictType: 'priority' | 'samefile';
    details: string;
}

interface Profile {
    id: string;
    name: string;
    mods: ProfileMod[];
    createdAt: string;
    updatedAt: string;
}

interface ProfileMod {
    fileName: string;
    enabled: boolean;
    priority: number;
}

interface SearchLocalModsOptions {
    query?: string;
    section?: string;
    categoryId?: number;
    sortBy?: 'relevance' | 'likes' | 'date' | 'views' | 'name';
    limit?: number;
    offset?: number;
}

interface LocalSearchResult {
    mods: CachedMod[];
    totalCount: number;
    offset: number;
    limit: number;
}

interface CachedMod {
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

interface SyncProgressData {
    section: string;
    currentPage: number;
    totalPages: number;
    modsProcessed: number;
    totalMods: number;
    phase: 'fetching' | 'complete' | 'error';
    error?: string;
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Settings
    detectDeadlock: () => ipcRenderer.invoke('detect-deadlock'),
    validateDeadlockPath: (path: string) => ipcRenderer.invoke('validate-deadlock-path', path),
    createDevDeadlockPath: () => ipcRenderer.invoke('create-dev-deadlock-path'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSettings: (settings: AppSettings) => ipcRenderer.invoke('set-settings', settings),

    // Mods
    getMods: () => ipcRenderer.invoke('get-mods'),
    enableMod: (modId: string) => ipcRenderer.invoke('enable-mod', modId),
    disableMod: (modId: string) => ipcRenderer.invoke('disable-mod', modId),
    deleteMod: (modId: string) => ipcRenderer.invoke('delete-mod', modId),
    setModPriority: (modId: string, priority: number) =>
        ipcRenderer.invoke('set-mod-priority', modId, priority),

    // GameBanana
    browseMods: (args: BrowseModsArgs) => ipcRenderer.invoke('browse-mods', args),
    getModDetails: (args: GetModDetailsArgs) => ipcRenderer.invoke('get-mod-details', args),
    downloadMod: (args: DownloadModArgs) => ipcRenderer.invoke('download-mod', args),
    getGameBananaSections: () => ipcRenderer.invoke('get-gamebanana-sections'),
    getGameBananaCategories: (args: GetCategoriesArgs) =>
        ipcRenderer.invoke('get-gamebanana-categories', args),

    // Mina Variants
    setMinaPreset: (args: SetMinaPresetArgs) => ipcRenderer.invoke('set-mina-preset', args),
    listMinaVariants: (args: ListMinaVariantsArgs) => ipcRenderer.invoke('list-mina-variants', args),
    applyMinaVariant: (args: ApplyMinaVariantArgs) => ipcRenderer.invoke('apply-mina-variant', args),

    // Maintenance
    cleanupAddons: () => ipcRenderer.invoke('cleanup-addons'),
    getGameinfoStatus: () => ipcRenderer.invoke('get-gameinfo-status'),
    fixGameinfo: () => ipcRenderer.invoke('fix-gameinfo'),

    // Dialogs
    showOpenDialog: (options: OpenDialogOptions) => ipcRenderer.invoke('show-open-dialog', options),

    // Events - return unsubscribe function
    onDownloadProgress: (callback: (data: DownloadProgressData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: DownloadProgressData) =>
            callback(data);
        ipcRenderer.on('download-progress', handler);
        return () => ipcRenderer.removeListener('download-progress', handler);
    },
    onDownloadExtracting: (callback: (data: DownloadEventData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: DownloadEventData) => callback(data);
        ipcRenderer.on('download-extracting', handler);
        return () => ipcRenderer.removeListener('download-extracting', handler);
    },
    onDownloadComplete: (callback: (data: DownloadEventData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: DownloadEventData) => callback(data);
        ipcRenderer.on('download-complete', handler);
        return () => ipcRenderer.removeListener('download-complete', handler);
    },

    // Conflicts
    getConflicts: () => ipcRenderer.invoke('get-conflicts'),

    // Profiles
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    createProfile: (name: string) => ipcRenderer.invoke('create-profile', name),
    updateProfile: (profileId: string) => ipcRenderer.invoke('update-profile', profileId),
    applyProfile: (profileId: string) => ipcRenderer.invoke('apply-profile', profileId),
    deleteProfile: (profileId: string) => ipcRenderer.invoke('delete-profile', profileId),
    renameProfile: (profileId: string, newName: string) => ipcRenderer.invoke('rename-profile', profileId, newName),

    // Mod Database (Local Cache)
    syncAllMods: () => ipcRenderer.invoke('sync-all-mods'),
    syncSection: (section: string) => ipcRenderer.invoke('sync-section', section),
    wipeModCache: () => ipcRenderer.invoke('wipe-mod-cache'),
    getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
    needsSync: () => ipcRenderer.invoke('needs-sync'),
    isSyncInProgress: () => ipcRenderer.invoke('is-sync-in-progress'),
    searchLocalMods: (options: SearchLocalModsOptions) => ipcRenderer.invoke('search-local-mods', options),
    getCachedMod: (id: number) => ipcRenderer.invoke('get-cached-mod', id),
    getLocalModCount: (section?: string) => ipcRenderer.invoke('get-local-mod-count', section),
    getLocalCategories: (section?: string) => ipcRenderer.invoke('get-local-categories', section),
    getSectionStats: () => ipcRenderer.invoke('get-section-stats'),
    onSyncProgress: (callback: (data: SyncProgressData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: SyncProgressData) => callback(data);
        ipcRenderer.on('sync-progress', handler);
        return () => ipcRenderer.removeListener('sync-progress', handler);
    },
} satisfies ElectronAPI);
