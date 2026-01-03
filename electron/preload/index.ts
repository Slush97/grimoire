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
    downloadMinaVariations: () => Promise<string>;

    // Maintenance
    cleanupAddons: () => Promise<CleanupResult>;
    getGameinfoStatus: () => Promise<GameinfoStatus>;
    fixGameinfo: () => Promise<GameinfoStatus>;

    // Window control
    setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
    getAlwaysOnTop: () => Promise<boolean>;

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
    createProfile: (name: string, crosshairSettings?: ProfileCrosshairSettings) => Promise<Profile>;
    updateProfile: (profileId: string, crosshairSettings?: ProfileCrosshairSettings) => Promise<Profile>;
    applyProfile: (profileId: string) => Promise<Profile>;
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

        // SQL Access
        executeSQLQuery: (query: string) => Promise<string>;
        listSQLTables: () => Promise<string[]>;
        getTableSchema: (tableName: string) => Promise<Record<string, string>>;

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
    downloadMinaVariations: () => ipcRenderer.invoke('download-mina-variations'),

    // Maintenance
    cleanupAddons: () => ipcRenderer.invoke('cleanup-addons'),
    getGameinfoStatus: () => ipcRenderer.invoke('get-gameinfo-status'),
    fixGameinfo: () => ipcRenderer.invoke('fix-gameinfo'),

    // Window control
    setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('set-always-on-top', enabled),
    getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),

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
    createProfile: (name: string, crosshairSettings?: ProfileCrosshairSettings) => ipcRenderer.invoke('create-profile', name, crosshairSettings),
    updateProfile: (profileId: string, crosshairSettings?: ProfileCrosshairSettings) => ipcRenderer.invoke('update-profile', profileId, crosshairSettings),
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

        // SQL Access
        executeSQLQuery: (query: string) =>
            ipcRenderer.invoke('stats:executeSQLQuery', query),
        listSQLTables: () => ipcRenderer.invoke('stats:listSQLTables'),
        getTableSchema: (tableName: string) =>
            ipcRenderer.invoke('stats:getTableSchema', tableName),

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
