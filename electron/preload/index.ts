import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
    PortableProfile,
    PortableResolvedMod,
} from '../../src/types/portableProfile';
import type { SnapshotTrigger } from '../../src/types/snapshot';
import type { SocialSessionStatus } from '../../src/types/social';
import type {
    AbilitySlot,
    AbilitySoundParams,
    ActiveTrippySkin,
    AppSettings,
    ApplyUnknownCustomModArgs,
    ApplyUnknownModMatchArgs,
    AssociateUnknownModArgs,
    GlobalModType,
    EditLocalModArgs,
    LockerClearScope,
    MergeModsArgs,
    TrippySpriteOptions,
    TrippyVfxChoice,
    UnknownModDetectionProgress,
} from '../../src/types/mod';
// The single source of truth for the renderer-facing API surface. The api
// object below is checked against it via `satisfies ElectronAPI`; the
// renderer's Window augmentation lives in the same file, so the bridge and
// the renderer can no longer drift apart.
import type {
    ElectronAPI,
    BrowseModsArgs,
    GetModDetailsArgs,
    GetModCommentsArgs,
    GetModUpdatesArgs,
    DownloadModArgs,
    GetCategoriesArgs,
    OpenDialogOptions,
    SaveDialogOptions,
    ImportCustomModArgs,
    ImportSoulContainerGlbArgs,
    PreviewSoulContainerGlbArgs,
    ImportSpiritUrnGlbArgs,
    PreviewSpiritUrnGlbArgs,
    SearchLocalModsOptions,
    CrosshairSettings,
    VanillaRestoreResult,
    ProfileCrosshairSettings,
    DownloadProgressData,
    DownloadEventData,
    DownloadErrorData,
    ModsAutoDisabledData,
    DownloadQueueData,
    OneClickInstallData,
    OneClickSuspiciousFilesData,
    MultiVpkPickData,
    SyncProgressData,
    UpdateStatus,
    LockerImageVariant,
    CropRect,
} from '../../src/types/electron';
import type { AppearanceSurface } from '../../src/types/mod';
import type { DeadworksConnectProgress } from '../../src/types/deadworks';
import type {
    ProfileSort,
    PublishRequest,
    ReportRequest,
    UpdateProfileRequest,
} from '@grimoire/social-types';

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,

    // Settings
    detectDeadlock: () => ipcRenderer.invoke('detect-deadlock'),
    validateDeadlockPath: (path: string) => ipcRenderer.invoke('validate-deadlock-path', path),
    createDevDeadlockPath: () => ipcRenderer.invoke('create-dev-deadlock-path'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSettings: (settings: AppSettings) => ipcRenderer.invoke('set-settings', settings),

    // Discord Rich Presence (opt-in; talks only to the local Discord client)
    discord: {
        update: (ctx: { surface: string; count?: number; hero?: string }) =>
            ipcRenderer.invoke('discord:update', ctx),
        clear: () => ipcRenderer.invoke('discord:clear'),
    },

    // Match-salt contribution to deadlock-api.com (opt-in)
    saltIngest: {
        setEnabled: (enabled: boolean) => ipcRenderer.invoke('salt-ingest:set-enabled', enabled),
        getStatus: () => ipcRenderer.invoke('salt-ingest:get-status'),
    },

    // Mods
    getMods: () => ipcRenderer.invoke('get-mods'),
    enableMod: (modId: string) => ipcRenderer.invoke('enable-mod', modId),
    disableMod: (modId: string) => ipcRenderer.invoke('disable-mod', modId),
    deleteMod: (modId: string) => ipcRenderer.invoke('delete-mod', modId),
    revealModInFolder: (modId: string) => ipcRenderer.invoke('reveal-mod-in-folder', modId),
    detectUnknownModFilters: (modId: string, requestId?: string) =>
        ipcRenderer.invoke('detect-unknown-mod-filters', modId, requestId),
    detectUnknownModCacheBulk: (requests: Array<{ modId: string; requestId?: string }>) =>
        ipcRenderer.invoke('detect-unknown-mod-cache-bulk', requests),
    cancelUnknownModDetection: (modId: string) =>
        ipcRenderer.invoke('cancel-unknown-mod-detection', modId),
    onUnknownModDetectionProgress: (callback: (progress: UnknownModDetectionProgress) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, progress: UnknownModDetectionProgress) => callback(progress);
        ipcRenderer.on('unknown-mod-detection-progress', listener);
        return () => ipcRenderer.removeListener('unknown-mod-detection-progress', listener);
    },
    applyUnknownModMatch: (modId: string, args: ApplyUnknownModMatchArgs) =>
        ipcRenderer.invoke('apply-unknown-mod-match', modId, args),
    applyUnknownCustomMod: (modId: string, args: ApplyUnknownCustomModArgs) =>
        ipcRenderer.invoke('apply-unknown-custom-mod', modId, args),
    associateUnknownMod: (modId: string, args: AssociateUnknownModArgs) =>
        ipcRenderer.invoke('associate-unknown-mod', modId, args),
    listUnknownModFiles: (modId: string) =>
        ipcRenderer.invoke('list-unknown-mod-files', modId),
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
    getCustomCardSlots: (heroName: string) =>
        ipcRenderer.invoke('get-custom-card-slots', heroName),
    applyCustomHeroCard: (heroName: string, uploads: { variant: string; dataUrl: string }[]) =>
        ipcRenderer.invoke('apply-custom-hero-card', heroName, uploads),
    exportCustomHeroCard: (
        heroName: string,
        uploads: { variant: string; dataUrl: string }[],
        destPath: string
    ) => ipcRenderer.invoke('export-custom-hero-card', heroName, uploads, destPath),
    getAppliedCustomCard: (heroName: string) =>
        ipcRenderer.invoke('get-applied-custom-card', heroName),
    getSoulModelInfo: (key: string) =>
        ipcRenderer.invoke('get-soul-model-info', key),
    exportSoulModel: (metaKey: string, cacheKey: string, entry?: string) =>
        ipcRenderer.invoke('export-soul-model', metaKey, cacheKey, entry),
    getHeroPoseInfo: (heroName: string, skinSources?: unknown[]) =>
        ipcRenderer.invoke('get-hero-pose-info', heroName, skinSources),
    exportHeroPose: (heroName: string, skinSources?: unknown[], fallbackSkinMetaKey?: string) =>
        ipcRenderer.invoke('export-hero-pose', heroName, skinSources, fallbackSkinMetaKey),
    getRiggedHeroPose: (heroName: string, skinSources?: unknown[]) =>
        ipcRenderer.invoke('get-rigged-hero-pose', heroName, skinSources),
    exportRiggedHeroPose: (heroName: string, skinSources?: unknown[], fallbackSkinMetaKey?: string) =>
        ipcRenderer.invoke('export-rigged-hero-pose', heroName, skinSources, fallbackSkinMetaKey),
    getHeroClothModel: (heroName: string, skinSources?: unknown[]) =>
        ipcRenderer.invoke('get-hero-cloth-model', heroName, skinSources),
    getHeroEffectInfo: (heroName: string) =>
        ipcRenderer.invoke('get-hero-effect-info', heroName),
    exportHeroEffect: (heroName: string) =>
        ipcRenderer.invoke('export-hero-effect', heroName),
    getPreviewCacheSize: () =>
        ipcRenderer.invoke('get-preview-cache-size'),
    clearPreviewCache: () =>
        ipcRenderer.invoke('clear-preview-cache'),
    applyHeroSound: (heroName: string, slot: AbilitySlot, sourceFileName: string, params?: AbilitySoundParams) =>
        ipcRenderer.invoke('apply-hero-sound', heroName, slot, sourceFileName, params),
    revertHeroSound: (heroName: string, slot: AbilitySlot) =>
        ipcRenderer.invoke('revert-hero-sound', heroName, slot),
    getActiveHeroSounds: (heroName: string) =>
        ipcRenderer.invoke('get-active-hero-sounds', heroName),
    getHeroColorSupport: (heroName: string) =>
        ipcRenderer.invoke('get-hero-color-support', heroName),
    applyHeroColor: (heroName: string, hue: number, saturation: number, brightness: number) =>
        ipcRenderer.invoke('apply-hero-color', heroName, hue, saturation, brightness),
    applyHeroPrism: (
        heroName: string,
        hue: number,
        saturation: number,
        brightness: number,
        animated: boolean,
        gradient: string | null,
    ) =>
        ipcRenderer.invoke(
            'apply-hero-prism',
            heroName,
            hue,
            saturation,
            brightness,
            animated,
            gradient,
        ),
    previewHeroColor: (heroName: string, hue: number, saturation: number, brightness: number) =>
        ipcRenderer.invoke('preview-hero-color', heroName, hue, saturation, brightness),
    revertHeroColor: (heroName: string) =>
        ipcRenderer.invoke('revert-hero-color', heroName),
    getActiveHeroColor: (heroName: string) =>
        ipcRenderer.invoke('get-active-hero-color', heroName),
    previewTrippySprite: (opts: TrippySpriteOptions) =>
        ipcRenderer.invoke('preview-trippy-sprite', opts),
    applyTrippySkin: (heroName: string, paint: Partial<ActiveTrippySkin>) =>
        ipcRenderer.invoke('apply-trippy-skin', heroName, paint),
    revertTrippySkin: (heroName: string) =>
        ipcRenderer.invoke('revert-trippy-skin', heroName),
    getActiveTrippySkin: (heroName: string) =>
        ipcRenderer.invoke('get-active-trippy-skin', heroName),
    applyTrippyVfx: (heroName: string, choice: Partial<TrippyVfxChoice>) =>
        ipcRenderer.invoke('apply-trippy-vfx', heroName, choice),
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
    reorderMods: (orderedIds: string[]) =>
        ipcRenderer.invoke('reorder-mods', orderedIds),
    swapModPriority: (modIdA: string, modIdB: string) =>
        ipcRenderer.invoke('swap-mod-priority', modIdA, modIdB),
    importCustomMod: (args: ImportCustomModArgs) =>
        ipcRenderer.invoke('import-custom-mod', args),
    importSoulContainerGlb: (args: ImportSoulContainerGlbArgs) =>
        ipcRenderer.invoke('import-soul-container-glb', args),
    previewSoulContainerGlb: (args: PreviewSoulContainerGlbArgs) =>
        ipcRenderer.invoke('preview-soul-container-glb', args),
    importSpiritUrnGlb: (args: ImportSpiritUrnGlbArgs) =>
        ipcRenderer.invoke('import-spirit-urn-glb', args),
    previewSpiritUrnGlb: (args: PreviewSpiritUrnGlbArgs) =>
        ipcRenderer.invoke('preview-spirit-urn-glb', args),
    readGlbFile: (glbPath: string) =>
        ipcRenderer.invoke('read-glb-file', glbPath),
    readImageDataUrl: (imagePath: string) =>
        ipcRenderer.invoke('read-image-data-url', imagePath),
    readRendererAsset: (relPath: string) =>
        ipcRenderer.invoke('read-renderer-asset', relPath),
    getLockerModImages: () => ipcRenderer.invoke('get-locker-mod-images'),
    setLockerModImage: (skinKey: string, source: string) =>
        ipcRenderer.invoke('set-locker-mod-image', skinKey, source),
    removeLockerModImage: (skinKey: string) =>
        ipcRenderer.invoke('remove-locker-mod-image', skinKey),
    getLockerModImageFlags: () => ipcRenderer.invoke('get-locker-mod-image-flags'),
    setLockerModImageHideName: (skinKey: string, hide: boolean) =>
        ipcRenderer.invoke('set-locker-mod-image-hide-name', skinKey, hide),
    fetchLockerImageDataUrl: (url: string) =>
        ipcRenderer.invoke('fetch-locker-image-data-url', url),
    getLockerModBackgrounds: () => ipcRenderer.invoke('get-locker-mod-backgrounds'),
    setLockerModBackground: (skinKey: string, source: string) =>
        ipcRenderer.invoke('set-locker-mod-background', skinKey, source),
    removeLockerModBackground: (skinKey: string) =>
        ipcRenderer.invoke('remove-locker-mod-background', skinKey),
    getLockerModBackgroundFlags: () => ipcRenderer.invoke('get-locker-mod-background-flags'),
    setLockerModBackgroundHideName: (skinKey: string, hide: boolean) =>
        ipcRenderer.invoke('set-locker-mod-background-hide-name', skinKey, hide),
    getLockerModThumbnails: () => ipcRenderer.invoke('get-locker-mod-thumbnails'),
    setLockerModThumbnail: (skinKey: string, source: string) =>
        ipcRenderer.invoke('set-locker-mod-thumbnail', skinKey, source),
    removeLockerModThumbnail: (skinKey: string) =>
        ipcRenderer.invoke('remove-locker-mod-thumbnail', skinKey),
    getLockerModThumbnailFlags: () => ipcRenderer.invoke('get-locker-mod-thumbnail-flags'),
    setLockerModThumbnailHideName: (skinKey: string, hide: boolean) =>
        ipcRenderer.invoke('set-locker-mod-thumbnail-hide-name', skinKey, hide),
    getLockerModImageEdit: (variant: LockerImageVariant, skinKey: string) =>
        ipcRenderer.invoke('get-locker-mod-image-edit', variant, skinKey),
    setLockerModImageEdit: (
        variant: LockerImageVariant,
        skinKey: string,
        source: string,
        crop: CropRect
    ) => ipcRenderer.invoke('set-locker-mod-image-edit', variant, skinKey, source, crop),
    getAppearanceImages: () => ipcRenderer.invoke('get-appearance-images'),
    setAppearanceImage: (surface: AppearanceSurface, source: string) =>
        ipcRenderer.invoke('set-appearance-image', surface, source),
    removeAppearanceImage: (surface: AppearanceSurface) =>
        ipcRenderer.invoke('remove-appearance-image', surface),
    setAppearanceImageEdit: (surface: AppearanceSurface, source: string, crop: CropRect) =>
        ipcRenderer.invoke('set-appearance-image-edit', surface, source, crop),
    getAppearanceImageEdit: (surface: AppearanceSurface) =>
        ipcRenderer.invoke('get-appearance-image-edit', surface),
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
    getModUpdates: (args: GetModUpdatesArgs) => ipcRenderer.invoke('get-mod-updates', args),
    getSubmitterLinks: (memberId: number) => ipcRenderer.invoke('get-submitter-links', memberId),
    downloadMod: (args: DownloadModArgs) => ipcRenderer.invoke('download-mod', args),
    getGameBananaSections: () => ipcRenderer.invoke('get-gamebanana-sections'),
    getGameBananaCategories: (args: GetCategoriesArgs) =>
        ipcRenderer.invoke('get-gamebanana-categories', args),
    getCollection: (args: { collectionId: number }) =>
        ipcRenderer.invoke('get-collection', args),
    getCollectionItems: (args: { collectionId: number; page?: number }) =>
        ipcRenderer.invoke('get-collection-items', args),

    // Maintenance
    copyImageToClipboard: (source: string) =>
        ipcRenderer.invoke('copy-image-to-clipboard', source),
    cleanupAddons: () => ipcRenderer.invoke('cleanup-addons'),
    getGameinfoStatus: () => ipcRenderer.invoke('get-gameinfo-status'),
    fixGameinfo: () => ipcRenderer.invoke('fix-gameinfo'),
    getPerformanceConfigStatus: () => ipcRenderer.invoke('get-performance-config-status'),
    applyPerformanceConfig: () => ipcRenderer.invoke('apply-performance-config'),
    removePerformanceConfig: () => ipcRenderer.invoke('remove-performance-config'),
    resetPerformanceConfigOverrides: () => ipcRenderer.invoke('reset-performance-config-overrides'),
    restorePerformanceConfigBackup: () => ipcRenderer.invoke('restore-performance-config-backup'),
    openPerformanceConfigFile: () => ipcRenderer.invoke('open-performance-config-file'),
    listEditorCandidates: () => ipcRenderer.invoke('list-editor-candidates'),
    openModsFolder: () => ipcRenderer.invoke('open-mods-folder'),
    openGameFolder: () => ipcRenderer.invoke('open-game-folder'),

    // Window control
    setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('set-always-on-top', enabled),
    getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),

    // Dialogs
    showOpenDialog: (options: OpenDialogOptions) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options: SaveDialogOptions) => ipcRenderer.invoke('show-save-dialog', options),
    revealPath: (targetPath: string) => ipcRenderer.invoke('reveal-path', targetPath),

    // Drag & drop
    getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),

    // Events - return unsubscribe function
    onGameBananaRateLimited: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('gamebanana:rate-limited', handler);
        return () => ipcRenderer.removeListener('gamebanana:rate-limited', handler);
    },
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
    importCrosshairFromGame: (gamePath: string) => ipcRenderer.invoke('crosshair:importFromGame', gamePath),
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

    // Language packs (downloaded on demand from GitHub)
    locales: {
        getManifest: () => ipcRenderer.invoke('locales:getManifest'),
        listDownloaded: () => ipcRenderer.invoke('locales:listDownloaded'),
        download: (languageCode: string) =>
            ipcRenderer.invoke('locales:download', languageCode),
        refresh: () => ipcRenderer.invoke('locales:refresh'),
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
        getHeroes: () => ipcRenderer.invoke('stats:getHeroes'),
        getRanks: () => ipcRenderer.invoke('stats:getRanks'),
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
        recordMatches: (accountId: number, matches: unknown[]) =>
            ipcRenderer.invoke('stats:recordMatches', accountId, matches),
        getLocalHeroStats: (accountId: number, heroId?: number) =>
            ipcRenderer.invoke('stats:getLocalHeroStats', accountId, heroId),
        getAggregatedStats: (accountId: number) =>
            ipcRenderer.invoke('stats:getAggregatedStats', accountId),

        // Match Data
        getMatchMetadata: (matchId: number) =>
            ipcRenderer.invoke('stats:getMatchMetadata', matchId),
        getActiveMatches: () => ipcRenderer.invoke('stats:getActiveMatches'),

        // Leaderboards
        getLeaderboard: (region: string) =>
            ipcRenderer.invoke('stats:getLeaderboard', region),
        getHeroLeaderboard: (region: string, heroId: number) =>
            ipcRenderer.invoke('stats:getHeroLeaderboard', region, heroId),

        // Analytics
        getHeroAnalytics: (params?: unknown) =>
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
        getMMRDistributionGlobal: (filters?: unknown) =>
            ipcRenderer.invoke('stats:getMMRDistributionGlobal', filters),
        getHeroMMRDistribution: (heroId: number, filters?: unknown) =>
            ipcRenderer.invoke('stats:getHeroMMRDistribution', heroId, filters),

        // Player Social Stats
        getEnemyStats: (accountId: number, filters?: unknown) =>
            ipcRenderer.invoke('stats:getEnemyStats', accountId, filters),
        getMateStats: (accountId: number, filters?: unknown) =>
            ipcRenderer.invoke('stats:getMateStats', accountId, filters),
        getPartyStats: (accountId: number, filters?: unknown) =>
            ipcRenderer.invoke('stats:getPartyStats', accountId, filters),
        searchSteamProfiles: (query: string) =>
            ipcRenderer.invoke('stats:searchSteamProfiles', query),

        // Advanced Analytics
        getAbilityOrderStats: (heroId: number, filters?: unknown) =>
            ipcRenderer.invoke('stats:getAbilityOrderStats', heroId, filters),
        getItemPermutationStats: (heroId?: number, combSize?: number, filters?: unknown) =>
            ipcRenderer.invoke('stats:getItemPermutationStats', heroId, combSize, filters),
        getHeroCombStats: (combSize?: number, filters?: unknown) =>
            ipcRenderer.invoke('stats:getHeroCombStats', combSize, filters),
        getKillDeathStats: (filters?: unknown) =>
            ipcRenderer.invoke('stats:getKillDeathStats', filters),
        getHeroScoreboard: (sortBy: string, sortDirection?: string, filters?: unknown) =>
            ipcRenderer.invoke('stats:getHeroScoreboard', sortBy, sortDirection, filters),
        getPlayerScoreboard: (sortBy: string, heroId?: number, sortDirection?: string, filters?: unknown) =>
            ipcRenderer.invoke('stats:getPlayerScoreboard', sortBy, heroId, sortDirection, filters),
        getPlayerStatsMetrics: (filters?: unknown) =>
            ipcRenderer.invoke('stats:getPlayerStatsMetrics', filters),
        getBuildItemStats: (heroId?: number, filters?: unknown) =>
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
        searchBuilds: (params: unknown) =>
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

    // Deadworks custom-server browser
    deadworksGetRelayUrl: () => ipcRenderer.invoke('deadworks-get-relay-url'),
    deadworksListServers: () => ipcRenderer.invoke('deadworks-list-servers'),
    deadworksServerContent: (serverId: string) => ipcRenderer.invoke('deadworks-server-content', serverId),
    deadworksRelayStats: () => ipcRenderer.invoke('deadworks-relay-stats'),
    deadworksPingServer: (addr: string) => ipcRenderer.invoke('deadworks-ping-server', addr),
    deadworksConnect: (serverId: string, addr: string) => ipcRenderer.invoke('deadworks-connect', serverId, addr),
    onDeadworksDownloadProgress: (callback: (p: DeadworksConnectProgress) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, p: DeadworksConnectProgress) => callback(p);
        ipcRenderer.on('deadworks-download-progress', handler);
        return () => ipcRenderer.removeListener('deadworks-download-progress', handler);
    },
} satisfies ElectronAPI);
