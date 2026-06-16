import type {
    Mod,
    AppSettings,
    GlobalModType,
    ModConflict,
    UnknownModDetectionProgress,
    UnknownModFilterGuess,
    ApplyUnknownModMatchArgs,
    ApplyUnknownCustomModArgs,
    AssociateUnknownModArgs,
    UnknownModFileList,
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
    ActiveHeroColor,
    ApplyHeroColorResult,
    ApplyHeroPrismResult,
    ActiveTrippySkin,
    ApplyTrippySkinResult,
    ApplyTrippyVfxResult,
    TrippySpriteOptions,
    TrippySpriteResult,
    TrippyVfxChoice,
    LockerOverview,
    LockerCardThumbnail,
    LockerClearScope,
    SoulImportStatus,
} from './mod';
import type {
    GameBananaModsResponse,
    GameBananaModDetails,
    GameBananaModFileList,
    GameBananaModUpdatesResponse,
    GameBananaSection,
    GameBananaCategoryNode,
    GameBananaCollection,
    GameBananaCollectionItemsResponse,
    GameBananaCommentsResponse,
    GameBananaArtistLink,
} from './gamebanana';
import type { HeroPortrait, CustomCardSlot, SoulModelInfo, HeroPoseInfo, HeroPoseSkinSource } from './portrait';
import type {
    DeadworksServer,
    DeadworksContentItem,
    DeadworksConnectResult,
    DeadworksConnectProgress,
    DeadworksRelayStats,
} from './deadworks';

export interface BrowseModsArgs {
    page: number;
    perPage: number;
    search?: string;
    section?: string;
    categoryId?: number;
    sort?: string;
    submitterId?: number;
}

export interface GetModDetailsArgs {
    modId: number;
    section?: string;
    includeSubmitter?: boolean;
}

export interface GetModCommentsArgs {
    modId: number;
    section?: string;
    page?: number;
}

export interface GetModUpdatesArgs {
    modId: number;
    section?: string;
    page?: number;
}

export interface DownloadModArgs {
    modId: number;
    fileId: number;
    fileName: string;
    modName?: string;
    section?: string;
    categoryId?: number;
}

export interface GetCategoriesArgs {
    categoryModelName: string;
}

export interface CleanupResult {
    removedArchives: number;
}

export interface GameinfoStatus {
    configured: boolean;
    message: string;
    missing: boolean;
    candidates: string[];
}

/** A text editor detected on this machine (for the Edit File picker). */
export interface EditorCandidate {
    name: string;
    path: string;
}

/** State of the OptimizationLock performance preset in gameinfo.gi.
 *  'wiped' means it was applied before but a game update reset the file. */
export interface PerformanceConfigStatus {
    state: 'not-applied' | 'applied' | 'wiped' | 'error';
    appliedVersion: string | null;
    bundledVersion: string;
    /** Applied, but the file no longer matches what Grimoire wrote (hand edits). */
    handEdited?: boolean;
    /** Saved user deviations from the preset (hand edits harvested on reapply,
     *  layered onto every apply, surviving game-update wipes). */
    overrideCount?: number;
    /** gameinfo.gi is empty/corrupt (no ConVars section to patch) AND a
     *  Grimoire backup exists, so the UI can offer a one-click restore. Only
     *  set on the broken-file states (error / wiped). */
    canRestoreBackup?: boolean;
    message: string;
}

export interface OpenDialogOptions {
    directory?: boolean;
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
}

export interface SaveDialogOptions {
    title?: string;
    /** Pre-filled path/filename (e.g. a suggested VPK name). */
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
}

export interface ImportCustomModArgs {
    vpkPath: string;
    name: string;
    thumbnailDataUrl?: string;
    nsfw?: boolean;
}

export interface ImportSoulContainerGlbArgs {
    /** Path to the source `.glb` on disk. */
    glbPath: string;
    name: string;
    orient: 'y-up' | 'z-up' | 'flip-y' | 'auto';
    /** Extra Euler degrees [X, Y, Z] applied after orient. */
    rotate?: [number, number, number];
    /** Facing yaw in degrees: turn the fitted orb about its vertical axis. */
    yaw?: number;
    /** Upright orientation (psyduck recipe); defaults true when omitted. */
    upright?: boolean;
    glow: 'recolor' | 'base' | 'off';
    /** User-tracked test status; defaults to 'untested'. */
    status?: SoulImportStatus;
    /** Free-text label shown as the variant sublabel in Installed. */
    notes?: string;
    nsfw?: boolean;
    /** Captured 3D preview as a data URL, used as the Installed thumbnail. */
    thumbnailDataUrl?: string;
    /** metaKey of an existing soul-container import to REPLACE in place (reuse
     *  its slot) instead of allocating a new one. Avoids stacking two enabled
     *  soul containers. */
    replaceMetaKey?: string;
}

export interface PreviewSoulContainerGlbArgs {
    glbPath: string;
    orient: 'y-up' | 'z-up' | 'flip-y' | 'auto';
    rotate?: [number, number, number];
    /** Facing yaw in degrees: turn the fitted orb about its vertical axis. */
    yaw?: number;
    /** Upright orientation (psyduck recipe); defaults true when omitted. */
    upright?: boolean;
    glow: 'recolor' | 'base' | 'off';
}

export interface SoulContainerPreview {
    /** The built model exported back to a GLB, base64-encoded. */
    glbBase64: string;
    /** Resolved orientation label from the build (e.g. `y-up`, `auto:z-up`). */
    orient: string;
    /** Uniform fit scale applied to match the orb's span. */
    fitScale?: number;
    /** Import's largest-axis span before fitting (Source units). */
    sourceSpan?: number;
    /** Vanilla soul-container span the mesh was fit to (~12.65). */
    targetSpan?: number;
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
    modName?: string;
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
    /** filename → file size in bytes. */
    vpkFileSizes?: Record<string, number>;
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
    downloadCount: number | null;
    dateAdded: number;
    dateModified: number;
    hasFiles: boolean;
    isNsfw: boolean;
    thumbnailUrl: string | null;
    audioUrl: string | null;
    profileUrl: string;
    cachedAt: number;
}

/**
 * Full crosshair model, matching the current in-game convar surface
 * (citadel_crosshair_*). Pip and dot outlines are (border width, gap,
 * opacity) triples sharing one outline color; the old single `pipBorder`
 * bool convar no longer exists in the game.
 */
export interface CrosshairSettings {
    pipGap: number;
    /** Keep the gap fixed in game; when false the gap blooms with weapon spread. */
    pipGapStatic: boolean;
    pipHeight: number;
    pipWidth: number;
    pipOpacity: number;
    /** Outline stroke width in px; 0 disables the pip outline. */
    pipOutlineBorder: number;
    pipOutlineGap: number;
    pipOutlineOpacity: number;
    dotOpacity: number;
    /** Dot diameter in px (1080p reference). */
    dotSize: number;
    dotOutlineBorder: number;
    dotOutlineGap: number;
    dotOutlineOpacity: number;
    colorR: number;
    colorG: number;
    colorB: number;
    outlineColorR: number;
    outlineColorG: number;
    outlineColorB: number;
    disableHeroSpecificCrosshairs: boolean;
    /** Legacy pre-outline-system flag. Derived from pipOutlineBorder/Opacity
     *  by normalizeCrosshairSettings and kept on the wire so older Grimoire
     *  builds importing shared profiles still render a border. Never edited
     *  directly. */
    pipBorder: boolean;
}

export interface CrosshairPreset {
    id: string;
    name: string;
    settings: CrosshairSettings;
    /** base64 PNG */
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

export interface SaltIngestStatus {
    running: boolean;
    lastScanAt: number | null;
    /** Salts found in the cache on the last scan (before dedupe). */
    lastScanFound: number;
    /** Total salts successfully submitted since the feature was enabled. */
    totalSubmitted: number;
    lastError: string | null;
}

export interface ElectronAPI {
    // Host platform ('win32', 'linux', ...), captured in the preload. The
    // renderer uses it to decide whether to draw the custom Windows title
    // bar strip (the native frame is hidden on Windows only).
    platform: string;

    // Settings
    detectDeadlock: () => Promise<string | null>;
    validateDeadlockPath: (path: string) => Promise<boolean>;
    createDevDeadlockPath: () => Promise<string>;
    getSettings: () => Promise<AppSettings>;
    setSettings: (settings: AppSettings) => Promise<void>;

    // Discord Rich Presence (opt-in; talks only to the local Discord client)
    discord: {
        update: (ctx: { surface: string; count?: number; hero?: string }) => Promise<void>;
        clear: () => Promise<void>;
    };

    // Match-salt contribution to deadlock-api.com (opt-in)
    saltIngest: {
        setEnabled: (enabled: boolean) => Promise<void>;
        getStatus: () => Promise<SaltIngestStatus>;
    };

    // Mods
    getMods: () => Promise<Mod[]>;
    enableMod: (modId: string) => Promise<Mod>;
    disableMod: (modId: string) => Promise<Mod>;
    deleteMod: (modId: string) => Promise<void>;
    revealModInFolder: (modId: string) => Promise<void>;
    detectUnknownModFilters: (modId: string, requestId?: string) => Promise<UnknownModFilterGuess>;
    detectUnknownModCacheBulk: (requests: Array<{ modId: string; requestId?: string }>) => Promise<UnknownModFilterGuess[]>;
    cancelUnknownModDetection: (modId: string) => Promise<void>;
    onUnknownModDetectionProgress: (callback: (progress: UnknownModDetectionProgress) => void) => () => void;
    applyUnknownModMatch: (modId: string, args: ApplyUnknownModMatchArgs) => Promise<Mod>;
    applyUnknownCustomMod: (modId: string, args: ApplyUnknownCustomModArgs) => Promise<Mod>;
    associateUnknownMod: (modId: string, args: AssociateUnknownModArgs) => Promise<Mod>;
    listUnknownModFiles: (modId: string) => Promise<UnknownModFileList>;
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
    getCustomCardSlots: (heroName: string) => Promise<CustomCardSlot[]>;
    applyCustomHeroCard: (
        heroName: string,
        uploads: { variant: string; dataUrl: string }[]
    ) => Promise<ApplyHeroCardResult>;
    exportCustomHeroCard: (
        heroName: string,
        uploads: { variant: string; dataUrl: string }[],
        destPath: string
    ) => Promise<string>;
    getAppliedCustomCard: (
        heroName: string
    ) => Promise<{ variant: string; dataUrl: string }[]>;
    getSoulModelInfo: (key: string) => Promise<SoulModelInfo>;
    exportSoulModel: (metaKey: string) => Promise<SoulModelInfo>;
    getHeroPoseInfo: (
        heroName: string,
        skinSources?: HeroPoseSkinSource[]
    ) => Promise<HeroPoseInfo>;
    exportHeroPose: (
        heroName: string,
        skinSources?: HeroPoseSkinSource[],
        fallbackSkinMetaKey?: string
    ) => Promise<HeroPoseInfo>;
    getRiggedHeroPose: (
        heroName: string,
        skinSources?: HeroPoseSkinSource[]
    ) => Promise<HeroPoseInfo>;
    exportRiggedHeroPose: (
        heroName: string,
        skinSources?: HeroPoseSkinSource[],
        fallbackSkinMetaKey?: string
    ) => Promise<HeroPoseInfo>;
    getPreviewCacheSize: () => Promise<{ bytes: number }>;
    clearPreviewCache: () => Promise<{ bytesFreed: number }>;
    applyHeroSound: (
        heroName: string,
        slot: AbilitySlot,
        sourceFileName: string,
        params?: AbilitySoundParams
    ) => Promise<ApplyHeroSoundResult>;
    revertHeroSound: (heroName: string, slot: AbilitySlot) => Promise<ApplyHeroSoundResult>;
    getActiveHeroSounds: (heroName: string) => Promise<ActiveHeroSound[]>;
    getHeroColorSupport: (heroName: string) => Promise<boolean>;
    applyHeroColor: (
        heroName: string,
        hue: number,
        saturation: number,
        brightness: number,
    ) => Promise<ApplyHeroColorResult>;
    applyHeroPrism: (
        heroName: string,
        hue: number,
        saturation: number,
        brightness: number,
        animated: boolean,
        gradient: string | null,
    ) => Promise<ApplyHeroPrismResult>;
    previewHeroColor: (
        heroName: string,
        hue: number,
        saturation: number,
        brightness: number,
    ) => Promise<string>;
    revertHeroColor: (heroName: string) => Promise<ApplyHeroColorResult>;
    getActiveHeroColor: (heroName: string) => Promise<ActiveHeroColor | null>;
    previewTrippySprite: (opts: TrippySpriteOptions) => Promise<TrippySpriteResult>;
    applyTrippySkin: (
        heroName: string,
        paint: Partial<ActiveTrippySkin>,
    ) => Promise<ApplyTrippySkinResult>;
    revertTrippySkin: (heroName: string) => Promise<ApplyTrippySkinResult>;
    getActiveTrippySkin: (heroName: string) => Promise<ActiveTrippySkin | null>;
    applyTrippyVfx: (
        heroName: string,
        choice: Partial<TrippyVfxChoice>,
    ) => Promise<ApplyTrippyVfxResult>;
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
    reorderMods: (orderedIds: string[]) => Promise<Mod[]>;
    swapModPriority: (modIdA: string, modIdB: string) => Promise<Mod[]>;
    importCustomMod: (args: ImportCustomModArgs) => Promise<Mod[]>;
    importSoulContainerGlb: (args: ImportSoulContainerGlbArgs) => Promise<Mod[]>;
    previewSoulContainerGlb: (args: PreviewSoulContainerGlbArgs) => Promise<SoulContainerPreview>;
    readGlbFile: (glbPath: string) => Promise<string>;
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
    getModUpdates: (args: GetModUpdatesArgs) => Promise<GameBananaModUpdatesResponse>;
    getSubmitterLinks: (memberId: number) => Promise<GameBananaArtistLink[]>;
    downloadMod: (args: DownloadModArgs) => Promise<void>;
    getGameBananaSections: () => Promise<GameBananaSection[]>;
    getGameBananaCategories: (args: GetCategoriesArgs) => Promise<GameBananaCategoryNode[]>;
    getCollection: (args: { collectionId: number }) => Promise<GameBananaCollection>;
    getCollectionItems: (args: { collectionId: number; page?: number }) => Promise<GameBananaCollectionItemsResponse>;

    // Maintenance
    copyImageToClipboard: (source: string) => Promise<void>;
    cleanupAddons: () => Promise<CleanupResult>;
    getGameinfoStatus: () => Promise<GameinfoStatus>;
    fixGameinfo: () => Promise<GameinfoStatus>;
    getPerformanceConfigStatus: () => Promise<PerformanceConfigStatus>;
    applyPerformanceConfig: () => Promise<PerformanceConfigStatus>;
    removePerformanceConfig: () => Promise<PerformanceConfigStatus>;
    resetPerformanceConfigOverrides: () => Promise<PerformanceConfigStatus>;
    restorePerformanceConfigBackup: () => Promise<PerformanceConfigStatus>;
    openPerformanceConfigFile: () => Promise<void>;
    listEditorCandidates: () => Promise<EditorCandidate[]>;
    openModsFolder: () => Promise<void>;
    openGameFolder: () => Promise<void>;

    // Window control
    setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
    getAlwaysOnTop: () => Promise<boolean>;

    // Dialogs
    showOpenDialog: (options: OpenDialogOptions) => Promise<string | null>;
    showSaveDialog: (options: SaveDialogOptions) => Promise<string | null>;
    revealPath: (targetPath: string) => Promise<void>;

    // Drag & drop
    getDroppedFilePath: (file: File) => string;

    // Events
    onGameBananaRateLimited: (callback: () => void) => () => void;
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

    // Snapshots: automatic recovery points captured before risky operations
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
    getModsDownloadCounts: (ids: number[]) => Promise<Record<number, number>>;
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
    /** Read the player's live in-game crosshair from machine_convars.vcfg.
     *  settings is null when the file is missing or has no crosshair convars. */
    importCrosshairFromGame: (gamePath: string) => Promise<{ found: boolean; settings: CrosshairSettings | null }>;
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

    // Language packs (downloaded on demand from GitHub)
    locales: {
        getManifest: () => Promise<import('./locales').LocaleManifest>;
        listDownloaded: () => Promise<import('./locales').DownloadedLocale[]>;
        download: (
            languageCode: string
        ) => Promise<import('./locales').DownloadedLocale>;
        refresh: () => Promise<import('./locales').DownloadedLocale[]>;
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
        getPlayerMMRHistory: (accountId: number) => Promise<unknown[]>;
        getHeroes: () => Promise<unknown[]>;
        getRanks: () => Promise<unknown[]>;
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

    // Deadworks custom-server browser
    deadworksGetRelayUrl: () => Promise<string>;
    deadworksListServers: () => Promise<DeadworksServer[]>;
    deadworksServerContent: (serverId: string) => Promise<DeadworksContentItem[]>;
    deadworksRelayStats: () => Promise<DeadworksRelayStats | null>;
    deadworksPingServer: (addr: string) => Promise<number>;
    deadworksConnect: (serverId: string, addr: string) => Promise<DeadworksConnectResult>;
    onDeadworksDownloadProgress: (callback: (p: DeadworksConnectProgress) => void) => () => void;
}

export interface ProfileMod {
    /** Filename when the profile was saved. NOT stable across reorders or
     *  collision-renames; use `gameBananaId` + `gameBananaFileId` as the
     *  primary identifier when present, and fall back to `fileName` only for
     *  pre-stable-id profiles or custom mods that lack GameBanana ids. */
    fileName: string;
    enabled: boolean;
    priority: number;
    /** Stable identity pair. Populated from metadata at save time so apply
     *  can find the mod even if its fileName has changed since. */
    gameBananaId?: number;
    gameBananaFileId?: number;
    /** Content fingerprint, populated from metadata at save time. The identity
     *  of last resort for custom/local mods that carry no GameBanana ids: it
     *  survives a fileName change (reorder, or the free-form rename a mod gets
     *  when disabled), so apply can still re-enable the right local mod. */
    sha256?: string;
}

/** Profiles embed the same crosshair model the Crosshair tab edits. Saved
 *  profiles from older builds carry the legacy 10-field shape; normalize
 *  with normalizeCrosshairSettings before use. */
export type ProfileCrosshairSettings = CrosshairSettings;

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
