import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
    PortableProfile,
    PortableExportResult,
    PortableResolutionReport,
    PortableResolvedMod,
} from '../../src/types/portableProfile';
import type { SnapshotSummary, SnapshotTrigger } from '../../src/types/snapshot';
import type { SocialSessionStatus } from '../../src/types/social';
import type {
    AbilitySlot,
    AbilitySoundParams,
    AppSettings,
    ApplyUnknownCustomModArgs,
    ApplyUnknownModMatchArgs,
    GlobalModType,
    EditLocalModArgs,
    LockerClearScope,
    MergeModsArgs,
    Mod,
    ModConflict,
    ExtractMergeSourceResult,
    UnknownModFilterGuess,
    UnmergeModResult,
} from '../../src/types/mod';
import type {
    LikeResponse,
    ListProfilesResponse,
    MeResponse,
    ProfileDetail,
    ProfileSort,
    PublishRequest,
    PublishResponse,
    ReportRequest,
    UpdateProfileRequest,
    UpdateProfileResponse,
} from '@grimoire/social-types';

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
    detectUnknownModFilters: (modId: string) => Promise<UnknownModFilterGuess>;
    cancelUnknownModDetection: (modId: string) => Promise<void>;
    applyUnknownModMatch: (modId: string, args: ApplyUnknownModMatchArgs) => Promise<Mod>;
    applyUnknownCustomMod: (modId: string, args: ApplyUnknownCustomModArgs) => Promise<Mod>;
    editLocalMod: (modId: string, args: EditLocalModArgs) => Promise<Mod>;
    setVariantLabel: (modId: string, label: string) => Promise<Mod>;
    setModLockerHero: (modId: string, heroName: string | null) => Promise<Mod>;
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
    getModComments: (args: GetModCommentsArgs) => Promise<GameBananaCommentsResponse>;
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

    // Drag & drop — resolves a native filesystem path for a dropped File.
    // Needed because Electron 32+ removed `File.path` from the DataTransfer API.
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
    exportPortableProfile: (profileId: string) => Promise<PortableExportResult>;
    parsePortableProfile: (input: string) => Promise<PortableProfile>;
    resolvePortableProfile: (profile: PortableProfile) => Promise<PortableResolutionReport>;
    finalizePortableImport: (args: { profile: PortableProfile; resolved: PortableResolvedMod[] }) => Promise<Profile>;

    // Snapshots — automatic recovery points captured before risky operations
    // (currently just mod updates). Restore re-uses the portable-import flow.
    snapshots: {
        create: (trigger: SnapshotTrigger) => Promise<SnapshotSummary>;
        list: () => Promise<SnapshotSummary[]>;
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
    getModsDownloadCounts: (ids: number[]) => Promise<Record<number, number>>;
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

    // Diagnostics (logs + bug-report bundle)
    diagnostics: {
        getLogPath: () => Promise<string>;
        openLogsFolder: () => Promise<void>;
        saveReport: () => Promise<{ path: string } | null>;
        buildReport: (description: string, options?: { includeFullLog?: boolean }) => Promise<string>;
    };

    // Grimoire Social (publish + discover + likes). Session token lives in
    // the main process; this surface never returns it to the renderer.
    social: {
        getSessionStatus: () => Promise<SocialSessionStatus>;
        login: () => Promise<SocialSessionStatus>;
        cancelLogin: () => Promise<void>;
        logout: () => Promise<SocialSessionStatus>;
        me: () => Promise<MeResponse>;
        listProfiles: (args?: {
            sort?: ProfileSort;
            hero?: string;
            hideNsfw?: boolean;
            page?: number;
        }) => Promise<ListProfilesResponse>;
        getProfile: (id: string) => Promise<ProfileDetail>;
        publish: (body: PublishRequest) => Promise<PublishResponse>;
        updateProfile: (id: string, body: UpdateProfileRequest) => Promise<UpdateProfileResponse>;
        like: (id: string) => Promise<LikeResponse>;
        unlike: (id: string) => Promise<LikeResponse>;
        report: (id: string, body: ReportRequest) => Promise<void>;
        deleteProfile: (id: string) => Promise<void>;
        deleteAccount: () => Promise<SocialSessionStatus>;
        onSessionChanged: (callback: (status: SocialSessionStatus) => void) => () => void;
    };

    // Stats
    stats: {
        // Steam Detection
        detectSteamUsers: () => Promise<SteamUser[]>;
        getMostRecentSteamUser: () => Promise<SteamUser | null>;
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

        // Match Data
        getMatchMetadata: (matchId: number) => Promise<unknown>;
        getActiveMatches: () => Promise<unknown[]>;

        // Leaderboards
        getLeaderboard: (region: LeaderboardRegion) => Promise<unknown[]>;
        getHeroLeaderboard: (region: LeaderboardRegion, heroId: number) => Promise<unknown[]>;

        // Analytics
        getHeroAnalytics: (params?: HeroStatsParams) => Promise<unknown[]>;
        getHeroCounters: (heroId?: number) => Promise<unknown[]>;
        getHeroSynergies: (heroId?: number) => Promise<unknown[]>;
        getItemAnalytics: () => Promise<unknown[]>;
        getBadgeDistribution: () => Promise<unknown[]>;
        getMMRDistribution: () => Promise<unknown>;

        // Extended MMR
        getHeroMMR: (accountIds: number[], heroId: number) => Promise<unknown[]>;
        getHeroMMRHistory: (accountId: number, heroId: number) => Promise<unknown[]>;
        getMMRDistributionGlobal: (filters?: AnalyticsFilter) => Promise<unknown[]>;
        getHeroMMRDistribution: (heroId: number, filters?: AnalyticsFilter) => Promise<unknown[]>;

        // Player Social Stats
        getEnemyStats: (accountId: number, filters?: PlayerStatsFilter) => Promise<unknown[]>;
        getMateStats: (accountId: number, filters?: PlayerStatsFilter & { same_party?: boolean }) => Promise<unknown[]>;
        getPartyStats: (accountId: number, filters?: PlayerStatsFilter) => Promise<unknown[]>;
        searchSteamProfiles: (query: string) => Promise<unknown[]>;

        // Advanced Analytics
        getAbilityOrderStats: (heroId: number, filters?: AnalyticsFilter & { min_matches?: number }) => Promise<unknown[]>;
        getItemPermutationStats: (heroId?: number, combSize?: number, filters?: AnalyticsFilter) => Promise<unknown[]>;
        getHeroCombStats: (combSize?: number, filters?: AnalyticsFilter) => Promise<unknown[]>;
        getKillDeathStats: (filters?: AnalyticsFilter) => Promise<unknown[]>;
        getHeroScoreboard: (sortBy: ScoreboardSortBy, sortDirection?: 'asc' | 'desc', filters?: AnalyticsFilter) => Promise<unknown[]>;
        getPlayerScoreboard: (sortBy: ScoreboardSortBy, heroId?: number, sortDirection?: 'asc' | 'desc', filters?: AnalyticsFilter) => Promise<unknown[]>;
        getPlayerStatsMetrics: (filters?: AnalyticsFilter) => Promise<unknown>;
        getBuildItemStats: (heroId?: number, filters?: { min_last_updated_unix_timestamp?: number; max_last_updated_unix_timestamp?: number }) => Promise<unknown[]>;

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
        searchBuilds: (params: BuildSearchParams) => Promise<unknown[]>;

        // Settings
        getSetting: (key: string) => Promise<string | null>;
        setSetting: (key: string, value: string) => Promise<void>;
        getAllSettings: () => Promise<Record<string, string>>;

        // Sync
        syncPlayerData: (accountId: number) => Promise<unknown>;

        // Utility
        checkApiHealth: () => Promise<unknown>;
        getApiInfo: () => Promise<unknown>;
    };
}

// Filter types for analytics
interface AnalyticsFilter {
    min_unix_timestamp?: number;
    max_unix_timestamp?: number;
    min_duration_s?: number;
    max_duration_s?: number;
    min_average_badge?: number;
    max_average_badge?: number;
    min_match_id?: number;
    max_match_id?: number;
    account_ids?: number[];
    hero_ids?: number[];
}

interface PlayerStatsFilter {
    min_unix_timestamp?: number;
    max_unix_timestamp?: number;
    min_matches_played?: number;
    max_matches_played?: number;
}

type ScoreboardSortBy =
    | 'matches' | 'wins' | 'losses' | 'winrate'
    | 'max_kills_per_match' | 'avg_kills_per_match' | 'kills'
    | 'max_deaths_per_match' | 'avg_deaths_per_match' | 'deaths'
    | 'max_assists_per_match' | 'avg_assists_per_match' | 'assists'
    | 'max_net_worth_per_match' | 'avg_net_worth_per_match' | 'net_worth'
    | 'max_player_damage_per_match' | 'avg_player_damage_per_match' | 'player_damage';

interface SteamLaunchOptionsStatus {
    available: boolean;
    configPath: string | null;
    currentValue: string | null;
    steamRunning: boolean;
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

interface GetModCommentsArgs {
    modId: number;
    section?: string;
    page?: number;
}

interface GameBananaCommentsResponse {
    comments: Array<{
        id: number;
        text: string;
        dateAdded: number;
        poster: {
            id: number;
            name: string;
            avatarUrl?: string;
        };
    }>;
    totalCount: number;
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
    missing: boolean;
    candidates: string[];
}

interface OpenDialogOptions {
    directory?: boolean;
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
}

interface ImportCustomModArgs {
    vpkPath: string;
    name: string;
    thumbnailDataUrl?: string;
    nsfw?: boolean;
}

interface VanillaStashStatus {
    active: boolean;
    startedAt?: string;
    modCount?: number;
}

interface VanillaRestoreResult {
    restored: number;
    skipped: number;
    failed: string[];
}

interface GameRunningStatus {
    running: boolean;
}

interface StopGameResult {
    wasRunning: boolean;
    stopped: boolean;
    restoreResult?: VanillaRestoreResult;
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

interface DownloadErrorData {
    modId: number;
    fileId: number;
    errorCode: 'MISSING_7ZIP' | 'EXTRACTION_FAILED' | 'CANCELLED_BY_USER' | 'UNKNOWN';
    message: string;
    helpUrl?: string;
}

interface ModsAutoDisabledData {
    reason: 'sibling-variant';
    modId: number;
    fileId: number;
    disabled: Array<{ id: string; name: string; fileName: string }>;
}

interface DownloadQueueItem {
    modId: number;
    fileId: number;
    fileName: string;
}

interface DownloadQueueData {
    queue: DownloadQueueItem[];
    count: number;
    currentDownload: DownloadQueueItem | null;
}

interface OneClickInstallData {
    archiveUrl: string;
    modId?: number;
    modType?: string;
    modName?: string;
    error?: string;
}

interface OneClickSuspiciousFilesData {
    requestId: string;
    modName: string;
    files: string[];
}

interface MultiVpkPickData {
    requestId: string;
    modName: string;
    vpkFileNames: string[];
    vpkLabels?: Record<string, string>;
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

interface GameBananaModFileList {
    id: number;
    files: Array<{ id: number; isArchived: boolean }>;
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

interface GameBananaCollection {
    id: number;
    name: string;
    description?: string;
    dateAdded: number;
    dateModified: number;
    submitter?: unknown;
    previewMedia?: unknown;
}

interface GameBananaCollectionItemsResponse {
    records: unknown[];
    totalCount: number;
    isComplete: boolean;
    perPage: number;
}

interface ProfileCrosshairSettings {
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

interface Profile {
    id: string;
    name: string;
    mods: ProfileMod[];
    crosshair?: ProfileCrosshairSettings;
    autoexecCommands?: string[];
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
    // Enhanced hero search
    heroName?: string;
    skinsCategoryId?: number;
    sortBy?: 'relevance' | 'likes' | 'date' | 'date_added' | 'views' | 'name';
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

interface CrosshairSettings {
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

interface CrosshairPreset {
    id: string;
    name: string;
    settings: CrosshairSettings;
    thumbnail: string;
    createdAt: string;
}

interface UpdateStatus {
    checking: boolean;
    available: boolean;
    downloading: boolean;
    downloaded: boolean;
    error: string | null;
    progress: number;
    updateInfo: UpdateInfo | null;
}

interface UpdateInfo {
    version: string;
    releaseDate?: string;
    releaseNotes?: string | ReleaseNoteInfo[] | null;
}

interface ReleaseNoteInfo {
    version: string;
    note: string | null;
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

// Stats types
interface SteamUser {
    steamId64: string;
    accountId: number;
    personaName: string;
    mostRecent: boolean;
}

type LeaderboardRegion = 'Europe' | 'NAmerica' | 'SAmerica' | 'Asia' | 'Oceania';

interface HeroStatsParams {
    min_badge?: number;
    max_badge?: number;
    match_mode?: string;
    min_unix_timestamp?: number;
    max_unix_timestamp?: number;
}

interface BuildSearchParams {
    hero_id?: number;
    search?: string;
    author_id?: number;
    tags?: string[];
    language?: string;
    sort_by?: 'favorites' | 'updated' | 'published' | 'version';
    sort_direction?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
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
    detectUnknownModFilters: (modId: string) =>
        ipcRenderer.invoke('detect-unknown-mod-filters', modId),
    cancelUnknownModDetection: (modId: string) =>
        ipcRenderer.invoke('cancel-unknown-mod-detection', modId),
    applyUnknownModMatch: (modId: string, args: ApplyUnknownModMatchArgs) =>
        ipcRenderer.invoke('apply-unknown-mod-match', modId, args),
    applyUnknownCustomMod: (modId: string, args: ApplyUnknownCustomModArgs) =>
        ipcRenderer.invoke('apply-unknown-custom-mod', modId, args),
    editLocalMod: (modId: string, args: EditLocalModArgs) =>
        ipcRenderer.invoke('edit-local-mod', modId, args),
    setVariantLabel: (modId: string, label: string) =>
        ipcRenderer.invoke('set-variant-label', modId, label),
    setModLockerHero: (modId: string, heroName: string | null) =>
        ipcRenderer.invoke('set-mod-locker-hero', modId, heroName),
    getHeroPortraits: (heroName: string) =>
        ipcRenderer.invoke('get-hero-portraits', heroName),
    getHeroAbilitySlots: (heroName: string) =>
        ipcRenderer.invoke('get-hero-ability-slots', heroName),
    applyHeroCard: (heroName: string, sourceFileName: string) =>
        ipcRenderer.invoke('apply-hero-card', heroName, sourceFileName),
    revertHeroCard: (heroName: string) =>
        ipcRenderer.invoke('revert-hero-card', heroName),
    getActiveHeroCard: (heroName: string) =>
        ipcRenderer.invoke('get-active-hero-card', heroName),
    applyHeroSound: (heroName: string, slot: AbilitySlot, sourceFileName: string, params?: AbilitySoundParams) =>
        ipcRenderer.invoke('apply-hero-sound', heroName, slot, sourceFileName, params),
    revertHeroSound: (heroName: string, slot: AbilitySlot) =>
        ipcRenderer.invoke('revert-hero-sound', heroName, slot),
    getActiveHeroSounds: (heroName: string) =>
        ipcRenderer.invoke('get-active-hero-sounds', heroName),
    getLockerOverview: () =>
        ipcRenderer.invoke('get-locker-overview'),
    getLockerCardThumbnails: () =>
        ipcRenderer.invoke('get-locker-card-thumbnails'),
    clearLockerOverrides: (scope: LockerClearScope) =>
        ipcRenderer.invoke('clear-locker-overrides', scope),
    setModGlobalType: (modId: string, globalType: GlobalModType | null) =>
        ipcRenderer.invoke('set-mod-global-type', modId, globalType),
    setModIgnoreUpdates: (modId: string, ignore: boolean) =>
        ipcRenderer.invoke('set-mod-ignore-updates', modId, ignore),
    backfillGameBananaFileId: (
        modId: string,
        payload: { gameBananaFileId: number; fileDescription?: string; sourceFileName?: string }
    ) => ipcRenderer.invoke('backfill-gamebanana-file-id', modId, payload),
    setModPriority: (modId: string, priority: number) =>
        ipcRenderer.invoke('set-mod-priority', modId, priority),
    reorderMods: (orderedFileNames: string[]) =>
        ipcRenderer.invoke('reorder-mods', orderedFileNames),
    swapModPriority: (modIdA: string, modIdB: string) =>
        ipcRenderer.invoke('swap-mod-priority', modIdA, modIdB),
    importCustomMod: (args: ImportCustomModArgs) =>
        ipcRenderer.invoke('import-custom-mod', args),
    readImageDataUrl: (imagePath: string) =>
        ipcRenderer.invoke('read-image-data-url', imagePath),
    mergeMods: (args: MergeModsArgs) => ipcRenderer.invoke('merge-mods', args),
    unmergeMod: (mergedModId: string) => ipcRenderer.invoke('unmerge-mod', mergedModId),
    extractMergeSource: (mergedModId: string, sourceFileName: string) =>
        ipcRenderer.invoke('extract-merge-source', mergedModId, sourceFileName),

    // Launch
    launchModded: () => ipcRenderer.invoke('launch-modded'),
    launchVanilla: () => ipcRenderer.invoke('launch-vanilla'),
    getGameRunningStatus: () => ipcRenderer.invoke('get-game-running-status'),
    stopGame: () => ipcRenderer.invoke('stop-game'),
    getVanillaStashStatus: () => ipcRenderer.invoke('get-vanilla-stash-status'),
    restoreVanillaStash: () => ipcRenderer.invoke('restore-vanilla-stash'),
    onVanillaRestoreComplete: (callback: (result: VanillaRestoreResult) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, result: VanillaRestoreResult) =>
            callback(result);
        ipcRenderer.on('vanilla-restore-complete', handler);
        return () => ipcRenderer.removeListener('vanilla-restore-complete', handler);
    },
    getSteamLaunchOptionsStatus: () => ipcRenderer.invoke('get-steam-launch-options-status'),

    // GameBanana
    browseMods: (args: BrowseModsArgs) => ipcRenderer.invoke('browse-mods', args),
    getModDetails: (args: GetModDetailsArgs) => ipcRenderer.invoke('get-mod-details', args),
    getModFileList: (args: GetModDetailsArgs) => ipcRenderer.invoke('get-mod-file-list', args),
    getModComments: (args: GetModCommentsArgs) => ipcRenderer.invoke('get-mod-comments', args),
    downloadMod: (args: DownloadModArgs) => ipcRenderer.invoke('download-mod', args),
    getGameBananaSections: () => ipcRenderer.invoke('get-gamebanana-sections'),
    getGameBananaCategories: (args: GetCategoriesArgs) =>
        ipcRenderer.invoke('get-gamebanana-categories', args),
    getCollection: (args: { collectionId: number }) =>
        ipcRenderer.invoke('get-collection', args),
    getCollectionItems: (args: { collectionId: number; page?: number }) =>
        ipcRenderer.invoke('get-collection-items', args),

    // Mina Variants
    setMinaPreset: (args: SetMinaPresetArgs) => ipcRenderer.invoke('set-mina-preset', args),
    listMinaVariants: (args: ListMinaVariantsArgs) => ipcRenderer.invoke('list-mina-variants', args),
    applyMinaVariant: (args: ApplyMinaVariantArgs) => ipcRenderer.invoke('apply-mina-variant', args),
    downloadMinaVariations: () => ipcRenderer.invoke('download-mina-variations'),

    // Maintenance
    cleanupAddons: () => ipcRenderer.invoke('cleanup-addons'),
    getGameinfoStatus: () => ipcRenderer.invoke('get-gameinfo-status'),
    fixGameinfo: () => ipcRenderer.invoke('fix-gameinfo'),
    openModsFolder: () => ipcRenderer.invoke('open-mods-folder'),
    openGameFolder: () => ipcRenderer.invoke('open-game-folder'),

    // Window control
    setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('set-always-on-top', enabled),
    getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),

    // Dialogs
    showOpenDialog: (options: OpenDialogOptions) => ipcRenderer.invoke('show-open-dialog', options),

    // Drag & drop
    getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),

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
    onDownloadError: (callback: (data: DownloadErrorData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: DownloadErrorData) => callback(data);
        ipcRenderer.on('download-error', handler);
        return () => ipcRenderer.removeListener('download-error', handler);
    },
    onModsAutoDisabled: (callback: (data: ModsAutoDisabledData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: ModsAutoDisabledData) => callback(data);
        ipcRenderer.on('mods-auto-disabled', handler);
        return () => ipcRenderer.removeListener('mods-auto-disabled', handler);
    },

    // Download Queue
    getDownloadQueue: () => ipcRenderer.invoke('get-download-queue'),
    getCurrentDownload: () => ipcRenderer.invoke('get-current-download'),
    removeFromQueue: (modId: number) => ipcRenderer.invoke('remove-from-queue', modId),
    cancelActiveDownload: () => ipcRenderer.invoke('cancel-active-download'),
    onDownloadQueueUpdated: (callback: (data: DownloadQueueData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: DownloadQueueData) => callback(data);
        ipcRenderer.on('download-queue-updated', handler);
        return () => ipcRenderer.removeListener('download-queue-updated', handler);
    },

    onOneClickInstall: (callback: (data: OneClickInstallData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: OneClickInstallData) => callback(data);
        ipcRenderer.on('one-click-install', handler);
        return () => ipcRenderer.removeListener('one-click-install', handler);
    },

    onOneClickSuspiciousFiles: (callback: (data: OneClickSuspiciousFilesData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: OneClickSuspiciousFilesData) => callback(data);
        ipcRenderer.on('one-click-suspicious-files', handler);
        return () => ipcRenderer.removeListener('one-click-suspicious-files', handler);
    },

    respondToOneClickSuspiciousFiles: (requestId: string, accepted: boolean) =>
        ipcRenderer.invoke('one-click-suspicious-response', { requestId, accepted }),

    onMultiVpkPick: (callback: (data: MultiVpkPickData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: MultiVpkPickData) => callback(data);
        ipcRenderer.on('multi-vpk-pick', handler);
        return () => ipcRenderer.removeListener('multi-vpk-pick', handler);
    },

    respondToMultiVpkPick: (requestId: string, selected: string[] | null) =>
        ipcRenderer.invoke('multi-vpk-pick-response', { requestId, selected }),

    // Conflicts
    getConflicts: () => ipcRenderer.invoke('get-conflicts'),
    getIgnoredConflicts: () => ipcRenderer.invoke('get-ignored-conflicts'),
    ignoreConflict: (modA: string, modB: string) =>
        ipcRenderer.invoke('ignore-conflict', modA, modB),
    unignoreConflict: (modA: string, modB: string) =>
        ipcRenderer.invoke('unignore-conflict', modA, modB),

    // Profiles
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    createProfile: (name: string, crosshairSettings?: ProfileCrosshairSettings) => ipcRenderer.invoke('create-profile', name, crosshairSettings),
    createProfileFromGameBananaIds: (args: { name: string; gameBananaIds: number[] }) =>
        ipcRenderer.invoke('create-profile-from-gamebanana-ids', args),
    updateProfile: (profileId: string, crosshairSettings?: ProfileCrosshairSettings) => ipcRenderer.invoke('update-profile', profileId, crosshairSettings),
    applyProfile: (profileId: string) => ipcRenderer.invoke('apply-profile', profileId),
    deleteProfile: (profileId: string) => ipcRenderer.invoke('delete-profile', profileId),
    renameProfile: (profileId: string, newName: string) => ipcRenderer.invoke('rename-profile', profileId, newName),
    exportPortableProfile: (profileId: string) => ipcRenderer.invoke('export-portable-profile', profileId),
    parsePortableProfile: (input: string) => ipcRenderer.invoke('parse-portable-profile', input),
    resolvePortableProfile: (profile: PortableProfile) => ipcRenderer.invoke('resolve-portable-profile', profile),
    finalizePortableImport: (args: { profile: PortableProfile; resolved: PortableResolvedMod[] }) =>
        ipcRenderer.invoke('finalize-portable-import', args),

    // Snapshots
    snapshots: {
        create: (trigger: SnapshotTrigger) => ipcRenderer.invoke('snapshot-create', trigger),
        list: () => ipcRenderer.invoke('snapshot-list'),
        load: (snapshotId: string) => ipcRenderer.invoke('snapshot-load', snapshotId),
        delete: (snapshotId: string) => ipcRenderer.invoke('snapshot-delete', snapshotId),
    },

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
    getModsNsfwStatus: (ids: number[]) => ipcRenderer.invoke('get-mods-nsfw-status', ids),
    updateModNsfw: (modId: number, isNsfw: boolean) => ipcRenderer.invoke('update-mod-nsfw', modId, isNsfw),
    getModsDownloadCounts: (ids: number[]) => ipcRenderer.invoke('get-mods-download-counts', ids),
    updateModDownloadCount: (modId: number, downloadCount: number) => ipcRenderer.invoke('update-mod-download-count', modId, downloadCount),
    onSyncProgress: (callback: (data: SyncProgressData) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: SyncProgressData) => callback(data);
        ipcRenderer.on('sync-progress', handler);
        return () => ipcRenderer.removeListener('sync-progress', handler);
    },

    // Crosshair Presets
    getCrosshairPresets: () => ipcRenderer.invoke('crosshair:getPresets'),
    saveCrosshairPreset: (name: string, settings: CrosshairSettings, thumbnail: string) =>
        ipcRenderer.invoke('crosshair:savePreset', name, settings, thumbnail),
    deleteCrosshairPreset: (id: string) => ipcRenderer.invoke('crosshair:deletePreset', id),
    applyCrosshairPreset: (presetId: string, gamePath: string) =>
        ipcRenderer.invoke('crosshair:applyPreset', presetId, gamePath),
    clearCrosshairAutoexec: (gamePath: string) => ipcRenderer.invoke('crosshair:clearAutoexec', gamePath),
    getAutoexecStatus: (gamePath: string) => ipcRenderer.invoke('crosshair:getAutoexecStatus', gamePath),
    createAutoexec: (gamePath: string) => ipcRenderer.invoke('crosshair:createAutoexec', gamePath),
    getAutoexecCommands: (gamePath: string) => ipcRenderer.invoke('autoexec:getCommands', gamePath),
    saveAutoexecCommands: (gamePath: string, commands: string[]) => ipcRenderer.invoke('autoexec:saveCommands', gamePath, commands),

    // Updater
    updater: {
        getVersion: () => ipcRenderer.invoke('updater:getVersion'),
        getStatus: () => ipcRenderer.invoke('updater:getStatus'),
        getInstallSource: () => ipcRenderer.invoke('updater:getInstallSource'),
        checkForUpdates: () => ipcRenderer.invoke('updater:check'),
        downloadUpdate: () => ipcRenderer.invoke('updater:download'),
        installUpdate: () => ipcRenderer.invoke('updater:install'),
        onStatus: (callback: (status: UpdateStatus) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
            ipcRenderer.on('updater:status', handler);
            return () => ipcRenderer.removeListener('updater:status', handler);
        },
    },

    // Diagnostics
    diagnostics: {
        getLogPath: () => ipcRenderer.invoke('diagnostics:getLogPath'),
        openLogsFolder: () => ipcRenderer.invoke('diagnostics:openLogsFolder'),
        saveReport: () => ipcRenderer.invoke('diagnostics:saveReport'),
        buildReport: (description: string, options?: { includeFullLog?: boolean }) =>
            ipcRenderer.invoke('diagnostics:buildReport', description, options),
    },

    // Grimoire Social
    social: {
        getSessionStatus: () => ipcRenderer.invoke('social:getSessionStatus'),
        login: () => ipcRenderer.invoke('social:login'),
        cancelLogin: () => ipcRenderer.invoke('social:cancelLogin'),
        logout: () => ipcRenderer.invoke('social:logout'),
        me: () => ipcRenderer.invoke('social:me'),
        listProfiles: (args?: {
            sort?: ProfileSort;
            hero?: string;
            hideNsfw?: boolean;
            page?: number;
        }) => ipcRenderer.invoke('social:listProfiles', args ?? {}),
        getProfile: (id: string) => ipcRenderer.invoke('social:getProfile', id),
        publish: (body: PublishRequest) => ipcRenderer.invoke('social:publish', body),
        updateProfile: (id: string, body: UpdateProfileRequest) =>
            ipcRenderer.invoke('social:updateProfile', { id, body }),
        like: (id: string) => ipcRenderer.invoke('social:like', id),
        unlike: (id: string) => ipcRenderer.invoke('social:unlike', id),
        report: (id: string, body: ReportRequest) =>
            ipcRenderer.invoke('social:report', { id, body }),
        deleteProfile: (id: string) => ipcRenderer.invoke('social:deleteProfile', id),
        deleteAccount: () => ipcRenderer.invoke('social:deleteAccount'),
        onSessionChanged: (callback: (status: SocialSessionStatus) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, status: SocialSessionStatus) =>
                callback(status);
            ipcRenderer.on('social:session-changed', handler);
            return () => ipcRenderer.removeListener('social:session-changed', handler);
        },
    },

    // Stats
    stats: {
        // Steam Detection
        detectSteamUsers: () => ipcRenderer.invoke('stats:detectSteamUsers'),
        getMostRecentSteamUser: () => ipcRenderer.invoke('stats:getMostRecentSteamUser'),
        parseSteamId: (input: string) => ipcRenderer.invoke('stats:parseSteamId', input),

        // Player Management
        addTrackedPlayer: (accountId: number, isPrimary?: boolean) =>
            ipcRenderer.invoke('stats:addTrackedPlayer', accountId, isPrimary),
        removeTrackedPlayer: (accountId: number) =>
            ipcRenderer.invoke('stats:removeTrackedPlayer', accountId),
        getTrackedPlayers: () => ipcRenderer.invoke('stats:getTrackedPlayers'),
        getPrimaryPlayer: () => ipcRenderer.invoke('stats:getPrimaryPlayer'),
        setPrimaryPlayer: (accountId: number) =>
            ipcRenderer.invoke('stats:setPrimaryPlayer', accountId),

        // Player Data (API)
        getPlayerMMR: (accountIds: number[]) =>
            ipcRenderer.invoke('stats:getPlayerMMR', accountIds),
        getPlayerMMRHistory: (accountId: number) =>
            ipcRenderer.invoke('stats:getPlayerMMRHistory', accountId),
        getPlayerHeroStats: (accountId: number) =>
            ipcRenderer.invoke('stats:getPlayerHeroStats', accountId),
        getPlayerMatchHistory: (accountId: number, limit?: number, minMatchId?: number) =>
            ipcRenderer.invoke('stats:getPlayerMatchHistory', accountId, limit, minMatchId),
        getPlayerSteamProfiles: (accountIds: number[]) =>
            ipcRenderer.invoke('stats:getPlayerSteamProfiles', accountIds),

        // Local Database
        getLocalMMRHistory: (accountId: number, limit?: number) =>
            ipcRenderer.invoke('stats:getLocalMMRHistory', accountId, limit),
        getLocalMatchHistory: (accountId: number, limit?: number, offset?: number) =>
            ipcRenderer.invoke('stats:getLocalMatchHistory', accountId, limit, offset),
        getLocalMatchCount: (accountId: number) =>
            ipcRenderer.invoke('stats:getLocalMatchCount', accountId),
        getLocalHeroStats: (accountId: number, heroId?: number) =>
            ipcRenderer.invoke('stats:getLocalHeroStats', accountId, heroId),
        getAggregatedStats: (accountId: number) =>
            ipcRenderer.invoke('stats:getAggregatedStats', accountId),

        // Match Data
        getMatchMetadata: (matchId: number) =>
            ipcRenderer.invoke('stats:getMatchMetadata', matchId),
        getActiveMatches: () => ipcRenderer.invoke('stats:getActiveMatches'),

        // Leaderboards
        getLeaderboard: (region: LeaderboardRegion) =>
            ipcRenderer.invoke('stats:getLeaderboard', region),
        getHeroLeaderboard: (region: LeaderboardRegion, heroId: number) =>
            ipcRenderer.invoke('stats:getHeroLeaderboard', region, heroId),

        // Analytics
        getHeroAnalytics: (params?: HeroStatsParams) =>
            ipcRenderer.invoke('stats:getHeroAnalytics', params),
        getHeroCounters: (heroId?: number) =>
            ipcRenderer.invoke('stats:getHeroCounters', heroId),
        getHeroSynergies: (heroId?: number) =>
            ipcRenderer.invoke('stats:getHeroSynergies', heroId),
        getItemAnalytics: () => ipcRenderer.invoke('stats:getItemAnalytics'),
        getBadgeDistribution: () => ipcRenderer.invoke('stats:getBadgeDistribution'),
        getMMRDistribution: () => ipcRenderer.invoke('stats:getMMRDistribution'),

        // Extended MMR
        getHeroMMR: (accountIds: number[], heroId: number) =>
            ipcRenderer.invoke('stats:getHeroMMR', accountIds, heroId),
        getHeroMMRHistory: (accountId: number, heroId: number) =>
            ipcRenderer.invoke('stats:getHeroMMRHistory', accountId, heroId),
        getMMRDistributionGlobal: (filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getMMRDistributionGlobal', filters),
        getHeroMMRDistribution: (heroId: number, filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getHeroMMRDistribution', heroId, filters),

        // Player Social Stats
        getEnemyStats: (accountId: number, filters?: PlayerStatsFilter) =>
            ipcRenderer.invoke('stats:getEnemyStats', accountId, filters),
        getMateStats: (accountId: number, filters?: PlayerStatsFilter & { same_party?: boolean }) =>
            ipcRenderer.invoke('stats:getMateStats', accountId, filters),
        getPartyStats: (accountId: number, filters?: PlayerStatsFilter) =>
            ipcRenderer.invoke('stats:getPartyStats', accountId, filters),
        searchSteamProfiles: (query: string) =>
            ipcRenderer.invoke('stats:searchSteamProfiles', query),

        // Advanced Analytics
        getAbilityOrderStats: (heroId: number, filters?: AnalyticsFilter & { min_matches?: number }) =>
            ipcRenderer.invoke('stats:getAbilityOrderStats', heroId, filters),
        getItemPermutationStats: (heroId?: number, combSize?: number, filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getItemPermutationStats', heroId, combSize, filters),
        getHeroCombStats: (combSize?: number, filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getHeroCombStats', combSize, filters),
        getKillDeathStats: (filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getKillDeathStats', filters),
        getHeroScoreboard: (sortBy: ScoreboardSortBy, sortDirection?: 'asc' | 'desc', filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getHeroScoreboard', sortBy, sortDirection, filters),
        getPlayerScoreboard: (sortBy: ScoreboardSortBy, heroId?: number, sortDirection?: 'asc' | 'desc', filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getPlayerScoreboard', sortBy, heroId, sortDirection, filters),
        getPlayerStatsMetrics: (filters?: AnalyticsFilter) =>
            ipcRenderer.invoke('stats:getPlayerStatsMetrics', filters),
        getBuildItemStats: (heroId?: number, filters?: { min_last_updated_unix_timestamp?: number; max_last_updated_unix_timestamp?: number }) =>
            ipcRenderer.invoke('stats:getBuildItemStats', heroId, filters),

        // Match Replay
        getMatchSalts: (matchId: number) =>
            ipcRenderer.invoke('stats:getMatchSalts', matchId),
        getMatchLiveUrl: (matchId: number) =>
            ipcRenderer.invoke('stats:getMatchLiveUrl', matchId),
        getRecentlyFetchedMatches: (playerIngestedOnly?: boolean) =>
            ipcRenderer.invoke('stats:getRecentlyFetchedMatches', playerIngestedOnly),

        // Patches
        getPatchNotes: () => ipcRenderer.invoke('stats:getPatchNotes'),
        getMajorPatchDates: () => ipcRenderer.invoke('stats:getMajorPatchDates'),

        // SQL Access - REMOVED FOR SECURITY
        // executeSQLQuery, listSQLTables, getTableSchema removed

        // Builds
        searchBuilds: (params: BuildSearchParams) =>
            ipcRenderer.invoke('stats:searchBuilds', params),

        // Settings
        getSetting: (key: string) => ipcRenderer.invoke('stats:getSetting', key),
        setSetting: (key: string, value: string) =>
            ipcRenderer.invoke('stats:setSetting', key, value),
        getAllSettings: () => ipcRenderer.invoke('stats:getAllSettings'),

        // Sync
        syncPlayerData: (accountId: number) =>
            ipcRenderer.invoke('stats:syncPlayerData', accountId),

        // Utility
        checkApiHealth: () => ipcRenderer.invoke('stats:checkApiHealth'),
        getApiInfo: () => ipcRenderer.invoke('stats:getApiInfo'),
    },
} satisfies ElectronAPI);
