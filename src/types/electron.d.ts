import type {
    Mod,
    AppSettings,
    GlobalModType,
    ModConflict,
    UnknownModFilterGuess,
    ApplyUnknownModMatchArgs,
    ApplyUnknownCustomModArgs,
    EditLocalModArgs,
    MergeModsArgs,
    UnmergeModResult,
    ExtractMergeSourceResult,
    ApplyHeroCardResult,
    HeroAbilitySlot,
    AbilitySlot,
    AbilitySoundParams,
    ActiveHeroSound,
    ApplyHeroSoundResult,
    LockerOverview,
    LockerCardThumbnail,
    LockerClearScope,
} from './mod';
import type {
    GameBananaModsResponse,
    GameBananaModDetails,
    GameBananaModFileList,
    GameBananaSection,
    GameBananaCategoryNode,
    GameBananaCollection,
    GameBananaCollectionItemsResponse,
} from './gamebanana';
import type { HeroPortrait } from './portrait';

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
    missing: boolean;
    candidates: string[];
}

export interface OpenDialogOptions {
    directory?: boolean;
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
}

export interface ImportCustomModArgs {
    vpkPath: string;
    name: string;
    thumbnailDataUrl?: string;
    nsfw?: boolean;
}

export interface VanillaStashStatus {
    active: boolean;
    startedAt?: string;
    modCount?: number;
}

export interface SteamLaunchOptionsStatus {
    available: boolean;
    configPath: string | null;
    currentValue: string | null;
    steamRunning: boolean;
}

export interface VanillaRestoreResult {
    restored: number;
    skipped: number;
    failed: string[];
}

export interface GameRunningStatus {
    running: boolean;
}

export interface StopGameResult {
    wasRunning: boolean;
    stopped: boolean;
    restoreResult?: VanillaRestoreResult;
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

export interface DownloadErrorData {
    modId: number;
    fileId: number;
    errorCode: 'MISSING_7ZIP' | 'EXTRACTION_FAILED' | 'CANCELLED_BY_USER' | 'UNKNOWN';
    message: string;
    helpUrl?: string;
}

export interface ModsAutoDisabledData {
    reason: 'sibling-variant';
    modId: number;
    fileId: number;
    disabled: Array<{ id: string; name: string; fileName: string }>;
}

export interface DownloadQueueItem {
    modId: number;
    fileId: number;
    fileName: string;
}

export interface DownloadQueueData {
    queue: DownloadQueueItem[];
    count: number;
    currentDownload: DownloadQueueItem | null;
}

export interface OneClickInstallData {
    archiveUrl: string;
    modId?: number;
    modType?: string;
    modName?: string;
    error?: string;
}

export interface OneClickSuspiciousFilesData {
    requestId: string;
    modName: string;
    files: string[];
}

export interface MultiVpkPickData {
    requestId: string;
    modName: string;
    vpkFileNames: string[];
    /** filename → human-readable label derived from VPK contents. Missing
     *  entries fall back to the filename in the picker. */
    vpkLabels?: Record<string, string>;
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
    // Enhanced hero search
    heroName?: string;
    skinsCategoryId?: number;
    sortBy?: 'relevance' | 'likes' | 'date' | 'date_added' | 'views' | 'name';
    nsfw?: 'all' | 'sfw' | 'nsfw';
    addedWithin?: 'all' | 'today' | 'week' | 'month' | 'custom';
    addedFrom?: number;
    addedTo?: number;
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
    audioUrl: string | null;
    profileUrl: string;
    cachedAt: number;
}

export interface CrosshairSettings {
    pipGap: number;
    pipHeight: number;
    pipWidth: number;
    pipOpacity: number;
    pipBorder: boolean;
    dotOpacity: number;
    dotOutlineOpacity: number;
    colorR: number;
    colorG: number;
    colorB: number;
}

export interface CrosshairPreset {
    id: string;
    name: string;
    settings: CrosshairSettings;
    thumbnail: string;
    createdAt: string;
}

export interface UpdateStatus {
    checking: boolean;
    available: boolean;
    downloading: boolean;
    downloaded: boolean;
    error: string | null;
    progress: number;
    updateInfo: UpdateInfo | null;
}

export interface UpdateInfo {
    version: string;
    releaseDate?: string;
    releaseNotes?: string | ReleaseNoteInfo[] | null;
}

export interface ReleaseNoteInfo {
    version: string;
    note: string | null;
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
    detectUnknownModFilters: (modId: string) => Promise<UnknownModFilterGuess>;
    cancelUnknownModDetection: (modId: string) => Promise<void>;
    applyUnknownModMatch: (modId: string, args: ApplyUnknownModMatchArgs) => Promise<Mod>;
    applyUnknownCustomMod: (modId: string, args: ApplyUnknownCustomModArgs) => Promise<Mod>;
    editLocalMod: (modId: string, args: EditLocalModArgs) => Promise<Mod>;
    setVariantLabel: (modId: string, label: string) => Promise<Mod>;
    setModLockerHero: (modId: string, heroName: string | null) => Promise<Mod>;
    getHeroPortraits: (heroName: string) => Promise<HeroPortrait[]>;
    getHeroAbilitySlots: (heroName: string) => Promise<HeroAbilitySlot[]>;
    applyHeroCard: (heroName: string, sourceFileName: string) => Promise<ApplyHeroCardResult>;
    revertHeroCard: (heroName: string) => Promise<ApplyHeroCardResult>;
    getActiveHeroCard: (
        heroName: string
    ) => Promise<{ sourceFileName: string; variants: string[] } | null>;
    applyHeroSound: (
        heroName: string,
        slot: AbilitySlot,
        sourceFileName: string,
        params?: AbilitySoundParams
    ) => Promise<ApplyHeroSoundResult>;
    revertHeroSound: (heroName: string, slot: AbilitySlot) => Promise<ApplyHeroSoundResult>;
    getActiveHeroSounds: (heroName: string) => Promise<ActiveHeroSound[]>;
    getLockerOverview: () => Promise<LockerOverview>;
    getLockerCardThumbnails: () => Promise<LockerCardThumbnail[]>;
    clearLockerOverrides: (scope: LockerClearScope) => Promise<void>;
    setModGlobalType: (modId: string, globalType: GlobalModType | null) => Promise<Mod>;
    setModIgnoreUpdates: (modId: string, ignore: boolean) => Promise<Mod>;
    backfillGameBananaFileId: (
      modId: string,
      payload: { gameBananaFileId: number; fileDescription?: string; sourceFileName?: string }
    ) => Promise<Mod>;
    setModPriority: (modId: string, priority: number) => Promise<Mod>;
    reorderMods: (orderedFileNames: string[]) => Promise<Mod[]>;
    swapModPriority: (modIdA: string, modIdB: string) => Promise<Mod[]>;
    importCustomMod: (args: ImportCustomModArgs) => Promise<Mod[]>;
    readImageDataUrl: (imagePath: string) => Promise<string>;
    mergeMods: (args: MergeModsArgs) => Promise<Mod>;
    unmergeMod: (mergedModId: string) => Promise<UnmergeModResult>;
    extractMergeSource: (mergedModId: string, sourceFileName: string) => Promise<ExtractMergeSourceResult>;

    // Launch
    launchModded: () => Promise<void>;
    launchVanilla: () => Promise<void>;
    getGameRunningStatus: () => Promise<GameRunningStatus>;
    stopGame: () => Promise<StopGameResult>;
    getVanillaStashStatus: () => Promise<VanillaStashStatus>;
    restoreVanillaStash: () => Promise<VanillaRestoreResult>;
    onVanillaRestoreComplete: (callback: (result: VanillaRestoreResult) => void) => () => void;
    getSteamLaunchOptionsStatus: () => Promise<SteamLaunchOptionsStatus>;

    // GameBanana
    browseMods: (args: BrowseModsArgs) => Promise<GameBananaModsResponse>;
    getModDetails: (args: GetModDetailsArgs) => Promise<GameBananaModDetails>;
    getModFileList: (args: GetModDetailsArgs) => Promise<GameBananaModFileList>;
    getModComments: (args: { modId: number; section?: string; page?: number }) => Promise<{ comments: Array<{ id: number; text: string; dateAdded: number; poster: { id: number; name: string; avatarUrl?: string } }>; totalCount: number }>;
    downloadMod: (args: DownloadModArgs) => Promise<void>;
    getGameBananaSections: () => Promise<GameBananaSection[]>;
    getGameBananaCategories: (args: GetCategoriesArgs) => Promise<GameBananaCategoryNode[]>;
    getCollection: (args: { collectionId: number }) => Promise<GameBananaCollection>;
    getCollectionItems: (args: { collectionId: number; page?: number }) => Promise<GameBananaCollectionItemsResponse>;

    // Mina Variants
    setMinaPreset: (args: SetMinaPresetArgs) => Promise<void>;
    listMinaVariants: (args: ListMinaVariantsArgs) => Promise<string[]>;
    applyMinaVariant: (args: ApplyMinaVariantArgs) => Promise<void>;
    downloadMinaVariations: () => Promise<string>;

    // Maintenance
    cleanupAddons: () => Promise<CleanupResult>;
    getGameinfoStatus: () => Promise<GameinfoStatus>;
    fixGameinfo: () => Promise<GameinfoStatus>;
    openModsFolder: () => Promise<void>;
    openGameFolder: () => Promise<void>;

    // Window control
    setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
    getAlwaysOnTop: () => Promise<boolean>;

    // Dialogs
    showOpenDialog: (options: OpenDialogOptions) => Promise<string | null>;

    // Drag & drop
    getDroppedFilePath: (file: File) => string;

    // Events
    onDownloadProgress: (callback: (data: DownloadProgressData) => void) => () => void;
    onDownloadExtracting: (callback: (data: DownloadEventData) => void) => () => void;
    onDownloadComplete: (callback: (data: DownloadEventData) => void) => () => void;
    onDownloadError: (callback: (data: DownloadErrorData) => void) => () => void;
    onModsAutoDisabled: (callback: (data: ModsAutoDisabledData) => void) => () => void;

    // Download Queue
    getDownloadQueue: () => Promise<DownloadQueueItem[]>;
    getCurrentDownload: () => Promise<DownloadQueueItem | null>;
    removeFromQueue: (modId: number) => Promise<boolean>;
    cancelActiveDownload: () => Promise<boolean>;
    onDownloadQueueUpdated: (callback: (data: DownloadQueueData) => void) => () => void;

    // GameBanana 1-Click protocol handler
    onOneClickInstall: (callback: (data: OneClickInstallData) => void) => () => void;
    onOneClickSuspiciousFiles: (
        callback: (data: OneClickSuspiciousFilesData) => void
    ) => () => void;
    respondToOneClickSuspiciousFiles: (
        requestId: string,
        accepted: boolean
    ) => Promise<void>;
    onMultiVpkPick: (callback: (data: MultiVpkPickData) => void) => () => void;
    respondToMultiVpkPick: (
        requestId: string,
        selected: string[] | null
    ) => Promise<void>;

    // Conflicts
    getConflicts: () => Promise<ModConflict[]>;
    getIgnoredConflicts: () => Promise<string[]>;
    ignoreConflict: (modA: string, modB: string) => Promise<string[]>;
    unignoreConflict: (modA: string, modB: string) => Promise<string[]>;

    // Profiles
    getProfiles: () => Promise<Profile[]>;
    createProfile: (name: string, crosshairSettings?: ProfileCrosshairSettings) => Promise<Profile>;
    createProfileFromGameBananaIds: (args: { name: string; gameBananaIds: number[] }) => Promise<Profile>;
    updateProfile: (profileId: string, crosshairSettings?: ProfileCrosshairSettings) => Promise<Profile>;
    applyProfile: (profileId: string) => Promise<Profile>;
    deleteProfile: (profileId: string) => Promise<void>;
    renameProfile: (profileId: string, newName: string) => Promise<Profile>;
    exportPortableProfile: (profileId: string) => Promise<import('./portableProfile').PortableExportResult>;
    parsePortableProfile: (input: string) => Promise<import('./portableProfile').PortableProfile>;
    resolvePortableProfile: (
        profile: import('./portableProfile').PortableProfile
    ) => Promise<import('./portableProfile').PortableResolutionReport>;
    finalizePortableImport: (args: {
        profile: import('./portableProfile').PortableProfile;
        resolved: import('./portableProfile').PortableResolvedMod[];
    }) => Promise<Profile>;

    // Snapshots — automatic recovery points captured before risky operations
    // (currently just mod updates). Restore re-uses the portable-import flow.
    snapshots: {
        create: (
            trigger: import('./snapshot').SnapshotTrigger
        ) => Promise<import('./snapshot').SnapshotSummary>;
        list: () => Promise<import('./snapshot').SnapshotSummary[]>;
        load: (snapshotId: string) => Promise<string>;
        delete: (snapshotId: string) => Promise<void>;
    };

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
    getModsNsfwStatus: (ids: number[]) => Promise<Record<number, boolean>>;
    updateModNsfw: (modId: number, isNsfw: boolean) => Promise<void>;
    updateModDownloadCount: (modId: number, downloadCount: number) => Promise<void>;
    onSyncProgress: (callback: (data: SyncProgressData) => void) => () => void;

    // Crosshair Presets
    getCrosshairPresets: () => Promise<{ presets: CrosshairPreset[]; activePresetId: string | null }>;
    saveCrosshairPreset: (name: string, settings: CrosshairSettings, thumbnail: string) => Promise<CrosshairPreset>;
    deleteCrosshairPreset: (id: string) => Promise<boolean>;
    applyCrosshairPreset: (presetId: string, gamePath: string) => Promise<{ success: boolean; path: string }>;
    clearCrosshairAutoexec: (gamePath: string) => Promise<{ success: boolean }>;
    getAutoexecStatus: (gamePath: string) => Promise<{ exists: boolean; path: string | null; hasCrosshairSettings: boolean }>;
    createAutoexec: (gamePath: string) => Promise<{ success: boolean; path: string }>;
    getAutoexecCommands: (gamePath: string) => Promise<{ commands: string[]; exists: boolean }>;
    saveAutoexecCommands: (gamePath: string, commands: string[]) => Promise<{ success: boolean; path: string }>;

    // Updater
    updater: {
        getVersion: () => Promise<string>;
        getStatus: () => Promise<UpdateStatus>;
        getInstallSource: () => Promise<'managed' | 'appimage' | 'standard'>;
        checkForUpdates: () => Promise<UpdateInfo | null>;
        downloadUpdate: () => Promise<void>;
        installUpdate: () => void;
        onStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };

    // Diagnostics
    diagnostics: {
        getLogPath: () => Promise<string>;
        openLogsFolder: () => Promise<void>;
        saveReport: () => Promise<{ path: string } | null>;
        buildReport: (description: string, options?: { includeFullLog?: boolean }) => Promise<string>;
    };

    // Grimoire Social
    social: {
        getSessionStatus: () => Promise<import('./social').SocialSessionStatus>;
        login: () => Promise<import('./social').SocialSessionStatus>;
        cancelLogin: () => Promise<void>;
        logout: () => Promise<import('./social').SocialSessionStatus>;
        me: () => Promise<import('@grimoire/social-types').MeResponse>;
        listProfiles: (args?: {
            sort?: import('@grimoire/social-types').ProfileSort;
            hero?: string;
            hideNsfw?: boolean;
            page?: number;
        }) => Promise<import('@grimoire/social-types').ListProfilesResponse>;
        getProfile: (id: string) => Promise<import('@grimoire/social-types').ProfileDetail>;
        publish: (
            body: import('@grimoire/social-types').PublishRequest
        ) => Promise<import('@grimoire/social-types').PublishResponse>;
        updateProfile: (
            id: string,
            body: import('@grimoire/social-types').UpdateProfileRequest
        ) => Promise<import('@grimoire/social-types').UpdateProfileResponse>;
        like: (id: string) => Promise<import('@grimoire/social-types').LikeResponse>;
        unlike: (id: string) => Promise<import('@grimoire/social-types').LikeResponse>;
        report: (
            id: string,
            body: import('@grimoire/social-types').ReportRequest
        ) => Promise<void>;
        deleteProfile: (id: string) => Promise<void>;
        deleteAccount: () => Promise<import('./social').SocialSessionStatus>;
        onSessionChanged: (
            callback: (status: import('./social').SocialSessionStatus) => void
        ) => () => void;
    };

    // Stats API
    stats: {
        // Steam Detection
        detectSteamUsers: () => Promise<Array<{ steamId64: string; accountId: number; personaName: string; mostRecent: boolean }>>;
        getMostRecentSteamUser: () => Promise<{ steamId64: string; accountId: number; personaName: string } | null>;
        parseSteamId: (input: string) => Promise<number | null>;

        // Player Management
        addTrackedPlayer: (accountId: number, isPrimary?: boolean) => Promise<unknown>;
        removeTrackedPlayer: (accountId: number) => Promise<void>;
        getTrackedPlayers: () => Promise<unknown[]>;
        getPrimaryPlayer: () => Promise<unknown | null>;
        setPrimaryPlayer: (accountId: number) => Promise<void>;

        // Player Data (API)
        getPlayerMMR: (accountIds: number[]) => Promise<unknown[]>;
        getPlayerMMRHistory: (accountId: number) => Promise<unknown>;
        getPlayerHeroStats: (accountId: number) => Promise<unknown>;
        getPlayerMatchHistory: (accountId: number, limit?: number, minMatchId?: number) => Promise<unknown>;
        getPlayerSteamProfiles: (accountIds: number[]) => Promise<unknown[]>;

        // Local Database
        getLocalMMRHistory: (accountId: number, limit?: number) => Promise<unknown[]>;
        getLocalMatchHistory: (accountId: number, limit?: number, offset?: number) => Promise<unknown[]>;
        getLocalMatchCount: (accountId: number) => Promise<number>;
        getLocalHeroStats: (accountId: number, heroId?: number) => Promise<unknown[]>;
        getAggregatedStats: (accountId: number) => Promise<unknown | null>;

        // Match Data (API)
        getMatchMetadata: (matchId: number) => Promise<unknown>;
        getActiveMatches: () => Promise<unknown[]>;

        // Leaderboards
        getLeaderboard: (region: string) => Promise<unknown[]>;
        getHeroLeaderboard: (region: string, heroId: number) => Promise<unknown[]>;

        // Analytics
        getHeroAnalytics: (params?: unknown) => Promise<unknown[]>;
        getHeroCounters: (heroId?: number) => Promise<unknown[]>;
        getHeroSynergies: (heroId?: number) => Promise<unknown[]>;
        getItemAnalytics: () => Promise<unknown[]>;
        getBadgeDistribution: () => Promise<unknown[]>;
        getMMRDistribution: () => Promise<unknown>;

        // Extended MMR
        getHeroMMR: (accountIds: number[], heroId: number) => Promise<unknown[]>;
        getHeroMMRHistory: (accountId: number, heroId: number) => Promise<unknown[]>;
        getMMRDistributionGlobal: (filters?: unknown) => Promise<unknown[]>;
        getHeroMMRDistribution: (heroId: number, filters?: unknown) => Promise<unknown[]>;

        // Player Social Stats
        getEnemyStats: (accountId: number, filters?: unknown) => Promise<unknown[]>;
        getMateStats: (accountId: number, filters?: unknown) => Promise<unknown[]>;
        getPartyStats: (accountId: number, filters?: unknown) => Promise<unknown[]>;
        searchSteamProfiles: (query: string) => Promise<unknown[]>;

        // Advanced Analytics
        getAbilityOrderStats: (heroId: number, filters?: unknown) => Promise<unknown[]>;
        getItemPermutationStats: (heroId?: number, combSize?: number, filters?: unknown) => Promise<unknown[]>;
        getHeroCombStats: (combSize?: number, filters?: unknown) => Promise<unknown[]>;
        getKillDeathStats: (filters?: unknown) => Promise<unknown[]>;
        getHeroScoreboard: (sortBy: string, sortDirection?: string, filters?: unknown) => Promise<unknown[]>;
        getPlayerScoreboard: (sortBy: string, heroId?: number, sortDirection?: string, filters?: unknown) => Promise<unknown[]>;
        getPlayerStatsMetrics: (filters?: unknown) => Promise<unknown>;
        getBuildItemStats: (heroId?: number, filters?: unknown) => Promise<unknown[]>;

        // Match Replay
        getMatchSalts: (matchId: number) => Promise<unknown>;
        getMatchLiveUrl: (matchId: number) => Promise<unknown>;
        getRecentlyFetchedMatches: (playerIngestedOnly?: boolean) => Promise<unknown[]>;

        // Patches
        getPatchNotes: () => Promise<unknown>;
        getMajorPatchDates: () => Promise<unknown[]>;

        // SQL Access - REMOVED FOR SECURITY
        // executeSQLQuery, listSQLTables, getTableSchema removed

        // Builds
        searchBuilds: (params: unknown) => Promise<unknown[]>;

        // Settings
        getSetting: (key: string) => Promise<string | null>;
        setSetting: (key: string, value: string) => Promise<void>;
        getAllSettings: () => Promise<Record<string, string>>;

        // Data Sync
        syncPlayerData: (accountId: number) => Promise<unknown>;

        // Utility
        checkApiHealth: () => Promise<unknown>;
        getApiInfo: () => Promise<unknown>;
    };
}

export interface ProfileMod {
    fileName: string;
    enabled: boolean;
    priority: number;
    gameBananaId?: number;
    gameBananaFileId?: number;
}

export interface ProfileCrosshairSettings {
    pipGap: number;
    pipHeight: number;
    pipWidth: number;
    pipOpacity: number;
    pipBorder: boolean;
    dotOpacity: number;
    dotOutlineOpacity: number;
    colorR: number;
    colorG: number;
    colorB: number;
}

export interface Profile {
    id: string;
    name: string;
    mods: ProfileMod[];
    crosshair?: ProfileCrosshairSettings;
    autoexecCommands?: string[];
    createdAt: string;
    updatedAt: string;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
