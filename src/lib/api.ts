import type { Mod, AppSettings, GlobalModType, UnknownModFilterGuess, UnknownModDetectionProgress, ApplyUnknownModMatchArgs, ApplyUnknownCustomModArgs, AssociateUnknownModArgs, UnknownModFileList, EditLocalModArgs, MergeModsArgs, UnmergeModResult, ExtractMergeSourceResult, ApplyHeroCardResult, HeroAbilitySlot, AbilitySlot, AbilitySoundParams, ActiveHeroSound, ApplyHeroSoundResult, ActiveHeroColor, ApplyHeroColorResult, ApplyHeroPrismResult, ActiveTrippySkin, ApplyTrippySkinResult, ApplyTrippyVfxResult, TrippySpriteOptions, TrippySpriteResult, TrippyVfxChoice, LockerOverview, LockerCardThumbnail, LockerClearScope, AppearanceSurface } from '../types/mod';
import type {
  HeroPortrait,
  CustomCardSlot,
  HeroPoseInfo,
  HeroPoseSkinSource,
  SoulModelInfo,
} from '../types/portrait';
import type {
  GameBananaModsResponse,
  GameBananaModDetails,
  GameBananaModFileList,
  GameBananaSection,
  GameBananaCategoryNode,
  GameBananaMod,
  GameBananaCommentsResponse,
  GameBananaModUpdatesResponse,
  GameBananaCollection,
  GameBananaCollectionItemsResponse,
  GameBananaArtistLink,
} from '../types/gamebanana';
import type { DownloadedLocale, LocaleManifest } from '../types/locales';

// Re-export types for convenience
export type {
  GameBananaModsResponse,
  GameBananaModDetails,
  GameBananaModFileList,
  GameBananaSection,
  GameBananaCategoryNode,
  GameBananaMod,
  GameBananaModUpdatesResponse,
  GameBananaCollection,
  GameBananaCollectionItemsResponse,
};

// Settings
export async function detectDeadlock(): Promise<string | null> {
  return window.electronAPI.detectDeadlock();
}

export async function validateDeadlockPath(path: string): Promise<boolean> {
  return window.electronAPI.validateDeadlockPath(path);
}

export async function createDevDeadlockPath(): Promise<string> {
  return window.electronAPI.createDevDeadlockPath();
}

export async function getSettings(): Promise<AppSettings> {
  return window.electronAPI.getSettings();
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return window.electronAPI.setSettings(settings);
}

// Mods
export async function getMods(): Promise<Mod[]> {
  return window.electronAPI.getMods();
}

export async function enableMod(modId: string): Promise<Mod> {
  return window.electronAPI.enableMod(modId);
}

export async function disableMod(modId: string): Promise<Mod> {
  return window.electronAPI.disableMod(modId);
}

export async function deleteMod(modId: string): Promise<void> {
  return window.electronAPI.deleteMod(modId);
}

export async function revealModInFolder(modId: string): Promise<void> {
  return window.electronAPI.revealModInFolder(modId);
}

export async function detectUnknownModFilters(modId: string, requestId?: string): Promise<UnknownModFilterGuess> {
  return window.electronAPI.detectUnknownModFilters(modId, requestId);
}

export async function detectUnknownModCacheBulk(
  requests: Array<{ modId: string; requestId?: string }>
): Promise<UnknownModFilterGuess[]> {
  return window.electronAPI.detectUnknownModCacheBulk(requests);
}

export async function cancelUnknownModDetection(modId: string): Promise<void> {
  return window.electronAPI.cancelUnknownModDetection(modId);
}

export function onUnknownModDetectionProgress(
  callback: (progress: UnknownModDetectionProgress) => void
): () => void {
  return window.electronAPI.onUnknownModDetectionProgress(callback);
}

export async function applyUnknownModMatch(modId: string, args: ApplyUnknownModMatchArgs): Promise<Mod> {
  return window.electronAPI.applyUnknownModMatch(modId, args);
}

export async function applyUnknownCustomMod(modId: string, args: ApplyUnknownCustomModArgs): Promise<Mod> {
  return window.electronAPI.applyUnknownCustomMod(modId, args);
}

export async function associateUnknownMod(modId: string, args: AssociateUnknownModArgs): Promise<Mod> {
  return window.electronAPI.associateUnknownMod(modId, args);
}

export async function listUnknownModFiles(modId: string): Promise<UnknownModFileList> {
  return window.electronAPI.listUnknownModFiles(modId);
}

export async function editLocalMod(modId: string, args: EditLocalModArgs): Promise<Mod> {
  return window.electronAPI.editLocalMod(modId, args);
}

export async function setVariantLabel(modId: string, label: string): Promise<Mod> {
  return window.electronAPI.setVariantLabel(modId, label);
}

export async function setModLockerHero(
  modId: string,
  heroName: string | null
): Promise<Mod> {
  return window.electronAPI.setModLockerHero(modId, heroName);
}

export async function getHeroPortraits(heroName: string): Promise<HeroPortrait[]> {
  return window.electronAPI.getHeroPortraits(heroName);
}

export async function getHeroAbilitySlots(heroName: string): Promise<HeroAbilitySlot[]> {
  return window.electronAPI.getHeroAbilitySlots(heroName);
}

export async function applyHeroCard(
  heroName: string,
  sourceFileName: string
): Promise<ApplyHeroCardResult> {
  return window.electronAPI.applyHeroCard(heroName, sourceFileName);
}

export async function revertHeroCard(heroName: string): Promise<ApplyHeroCardResult> {
  return window.electronAPI.revertHeroCard(heroName);
}

export async function getActiveHeroCard(
  heroName: string
): Promise<{ sourceFileName: string; variants: string[] } | null> {
  return window.electronAPI.getActiveHeroCard(heroName);
}

/** Uploadable card-variant slots for a hero, derived from the base game art. */
export async function getCustomCardSlots(heroName: string): Promise<CustomCardSlot[]> {
  return window.electronAPI.getCustomCardSlots(heroName);
}

/** Build + apply a custom card from one cropped PNG (data URL) per variant. */
export async function applyCustomHeroCard(
  heroName: string,
  uploads: { variant: string; dataUrl: string }[]
): Promise<ApplyHeroCardResult> {
  return window.electronAPI.applyCustomHeroCard(heroName, uploads);
}

/** Export the custom card as a standalone .vpk to a chosen path; returns it. */
export async function exportCustomHeroCard(
  heroName: string,
  uploads: { variant: string; dataUrl: string }[],
  destPath: string
): Promise<string> {
  return window.electronAPI.exportCustomHeroCard(heroName, uploads, destPath);
}

/** Cropped images of the currently-applied custom card (empty if none), so the
 *  picker can restore the user's uploads after an app restart. */
export async function getAppliedCustomCard(
  heroName: string
): Promise<{ variant: string; dataUrl: string }[]> {
  return window.electronAPI.getAppliedCustomCard(heroName);
}

/** Whether a soul-container mod has an exported model in the user's library (+ mtime). */
export async function getSoulModelInfo(key: string): Promise<SoulModelInfo> {
  return window.electronAPI.getSoulModelInfo(key);
}

/** Export a soul-container mod's model via the bundled vpkmerge exporter. The
 *  SOURCE VPK is located by `metaKey` (folder-qualified for overflow mods); the
 *  cache is keyed by `cacheKey` (the mod's content-stable sha256) so an
 *  enable/disable rename can't serve a different soul's stale export. */
export async function exportSoulModel(metaKey: string, cacheKey: string, entry?: string): Promise<SoulModelInfo> {
  return window.electronAPI.exportSoulModel(metaKey, cacheKey, entry);
}

/** Whether a hero's posed 3D still exists for the given active skin stack (+ mtime, key). */
export async function getHeroPoseInfo(
  heroName: string,
  skinSources?: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
  return window.electronAPI.getHeroPoseInfo(heroName, skinSources);
}

/** Generate a hero's posed 3D still via the bundled vpkmerge `--pose` exporter.
 *  Pass the active skin stack to pose the current equipped look; omit for vanilla. */
export async function exportHeroPose(
  heroName: string,
  skinSources?: HeroPoseSkinSource[],
  fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
  return window.electronAPI.exportHeroPose(heroName, skinSources, fallbackSkinMetaKey);
}

/** Whether a hero's RIGGED (animated, skinned) glb exists for the active skin
 *  stack (+ mtime, key). Mirrors getHeroPoseInfo for the rigged variant. */
export async function getRiggedHeroPose(
  heroName: string,
  skinSources?: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
  return window.electronAPI.getRiggedHeroPose(heroName, skinSources);
}

/** Generate a hero's RIGGED glb via the bundled vpkmerge exporter (no --pose,
 *  single idle clip; keeps skeleton + skin + idle animation). Pass the active
 *  skin stack to rig the equipped look; omit for vanilla. */
export async function exportRiggedHeroPose(
  heroName: string,
  skinSources?: HeroPoseSkinSource[],
  fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
  return window.electronAPI.exportRiggedHeroPose(heroName, skinSources, fallbackSkinMetaKey);
}

export async function applyHeroSound(
  heroName: string,
  slot: AbilitySlot,
  sourceFileName: string,
  params?: AbilitySoundParams
): Promise<ApplyHeroSoundResult> {
  return window.electronAPI.applyHeroSound(heroName, slot, sourceFileName, params);
}

export async function revertHeroSound(
  heroName: string,
  slot: AbilitySlot
): Promise<ApplyHeroSoundResult> {
  return window.electronAPI.revertHeroSound(heroName, slot);
}

export async function getActiveHeroSounds(heroName: string): Promise<ActiveHeroSound[]> {
  return window.electronAPI.getActiveHeroSounds(heroName);
}

export async function getHeroColorSupport(heroName: string): Promise<boolean> {
  return window.electronAPI.getHeroColorSupport(heroName);
}

export async function applyHeroColor(
  heroName: string,
  hue: number,
  saturation: number,
  brightness: number
): Promise<ApplyHeroColorResult> {
  return window.electronAPI.applyHeroColor(heroName, hue, saturation, brightness);
}

/** Apply the rainbow prism (or a custom gradient) to a hero's ability VFX. In
 *  prism/gradient mode `hue` is the spectrum rotation (degrees); saturation/
 *  brightness scale the spectrum. A non-null `gradient` spec (preset name or
 *  `pos:hue:sat,...` stops) switches from the full rainbow to that ramp. */
export async function applyHeroPrism(
  heroName: string,
  hue: number,
  saturation: number,
  brightness: number,
  animated: boolean,
  gradient: string | null
): Promise<ApplyHeroPrismResult> {
  return window.electronAPI.applyHeroPrism(
    heroName,
    hue,
    saturation,
    brightness,
    animated,
    gradient
  );
}

/** Render a fast PNG swatch of the recolor target as a data URL (live preview). */
export async function previewHeroColor(
  heroName: string,
  hue: number,
  saturation: number,
  brightness: number
): Promise<string> {
  return window.electronAPI.previewHeroColor(heroName, hue, saturation, brightness);
}

export async function revertHeroColor(heroName: string): Promise<ApplyHeroColorResult> {
  return window.electronAPI.revertHeroColor(heroName);
}

export async function getActiveHeroColor(heroName: string): Promise<ActiveHeroColor | null> {
  return window.electronAPI.getActiveHeroColor(heroName);
}

/** Render (or fetch from cache) one animated trippy preview sprite: a PNG strip
 *  of `frames` tiles played as a flipbook. Pure pattern generation in the
 *  bundled vpkmerge; hero-independent and cheap (no VPK read). */
export async function previewTrippySprite(opts: TrippySpriteOptions): Promise<TrippySpriteResult> {
  return window.electronAPI.previewTrippySprite(opts);
}

/** Paint a hero's body/weapon materials with a procedural trippy pattern. */
export async function applyTrippySkin(
  heroName: string,
  paint: Partial<ActiveTrippySkin>
): Promise<ApplyTrippySkinResult> {
  return window.electronAPI.applyTrippySkin(heroName, paint);
}

export async function revertTrippySkin(heroName: string): Promise<ApplyTrippySkinResult> {
  return window.electronAPI.revertTrippySkin(heroName);
}

export async function getActiveTrippySkin(heroName: string): Promise<ActiveTrippySkin | null> {
  return window.electronAPI.getActiveTrippySkin(heroName);
}

/** Paint + animate a hero's ability VFX with a procedural trippy theme. Lands
 *  in the same one-recolor-per-hero set as applyHeroColor/applyHeroPrism. */
export async function applyTrippyVfx(
  heroName: string,
  choice: Partial<TrippyVfxChoice>
): Promise<ApplyTrippyVfxResult> {
  return window.electronAPI.applyTrippyVfx(heroName, choice);
}

export async function getLockerOverview(): Promise<LockerOverview> {
  return window.electronAPI.getLockerOverview();
}

export async function getLockerCardThumbnails(): Promise<LockerCardThumbnail[]> {
  return window.electronAPI.getLockerCardThumbnails();
}

export async function clearLockerOverrides(scope: LockerClearScope): Promise<void> {
  return window.electronAPI.clearLockerOverrides(scope);
}

export async function setModGlobalType(
  modId: string,
  globalType: GlobalModType | null
): Promise<Mod> {
  return window.electronAPI.setModGlobalType(modId, globalType);
}

export async function setModIgnoreUpdates(
  modId: string,
  ignore: boolean
): Promise<Mod> {
  return window.electronAPI.setModIgnoreUpdates(modId, ignore);
}

export async function backfillGameBananaFileId(
  modId: string,
  payload: { gameBananaFileId: number; fileDescription?: string; sourceFileName?: string }
): Promise<Mod> {
  return window.electronAPI.backfillGameBananaFileId(modId, payload);
}

export async function setModPriority(modId: string, priority: number): Promise<Mod> {
  return window.electronAPI.setModPriority(modId, priority);
}

export async function reorderMods(orderedIds: string[]): Promise<Mod[]> {
  return window.electronAPI.reorderMods(orderedIds);
}

export async function swapModPriority(modIdA: string, modIdB: string): Promise<Mod[]> {
  return window.electronAPI.swapModPriority(modIdA, modIdB);
}

export async function importCustomMod(args: {
  vpkPath: string;
  name: string;
  thumbnailDataUrl?: string;
  nsfw?: boolean;
}): Promise<Mod[]> {
  return window.electronAPI.importCustomMod(args);
}

/** Build a soul-container override VPK from a user GLB and install it as a
 *  tracked local mod. Returns the full enriched mod list after install. */
export async function importSoulContainerGlb(
  args: import('../types/electron').ImportSoulContainerGlbArgs
): Promise<Mod[]> {
  return window.electronAPI.importSoulContainerGlb(args);
}

/** Build the soul-container for the given orientation and export its model to a
 *  GLB for the import preview. Returns the GLB as an ArrayBuffer + the resolved
 *  orientation label and fitted bounds. */
export async function previewSoulContainerGlb(
  args: import('../types/electron').PreviewSoulContainerGlbArgs
): Promise<{ glb: ArrayBuffer; orient: string; fitScale?: number; sourceSpan?: number; targetSpan?: number }> {
  const res = await window.electronAPI.previewSoulContainerGlb(args);
  const binary = atob(res.glbBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { glb: bytes.buffer, orient: res.orient, fitScale: res.fitScale, sourceSpan: res.sourceSpan, targetSpan: res.targetSpan };
}

/** Build a Spirit Urn override VPK from a user GLB and install it as a tracked
 *  local mod. Returns the full enriched mod list after install. */
export async function importSpiritUrnGlb(
  args: import('../types/electron').ImportSpiritUrnGlbArgs
): Promise<Mod[]> {
  return window.electronAPI.importSpiritUrnGlb(args);
}

/** Build the urn for the given orientation/span and export its model to a GLB
 *  for the import preview. Returns the GLB as an ArrayBuffer + the resolved
 *  orientation label and fitted bounds. */
export async function previewSpiritUrnGlb(
  args: import('../types/electron').PreviewSpiritUrnGlbArgs
): Promise<{ glb: ArrayBuffer; orient: string; fitScale?: number; sourceSpan?: number; targetSpan?: number }> {
  const res = await window.electronAPI.previewSpiritUrnGlb(args);
  const binary = atob(res.glbBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { glb: bytes.buffer, orient: res.orient, fitScale: res.fitScale, sourceSpan: res.sourceSpan, targetSpan: res.targetSpan };
}

export async function readGlbFile(glbPath: string): Promise<ArrayBuffer> {
  const glbBase64 = await window.electronAPI.readGlbFile(glbPath);
  const binary = atob(glbBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function readImageDataUrl(imagePath: string): Promise<string> {
  return window.electronAPI.readImageDataUrl(imagePath);
}

export async function readRendererAsset(relPath: string): Promise<string> {
  return window.electronAPI.readRendererAsset(relPath);
}

export async function getLockerModImages(): Promise<Record<string, string>> {
  return window.electronAPI.getLockerModImages();
}

export async function setLockerModImage(skinKey: string, source: string): Promise<string> {
  return window.electronAPI.setLockerModImage(skinKey, source);
}

export async function removeLockerModImage(skinKey: string): Promise<void> {
  return window.electronAPI.removeLockerModImage(skinKey);
}

export async function getLockerModImageFlags(): Promise<Record<string, boolean>> {
  return window.electronAPI.getLockerModImageFlags();
}

export async function setLockerModImageHideName(skinKey: string, hide: boolean): Promise<void> {
  return window.electronAPI.setLockerModImageHideName(skinKey, hide);
}

export async function fetchLockerImageDataUrl(url: string): Promise<string> {
  return window.electronAPI.fetchLockerImageDataUrl(url);
}

export async function getLockerModBackgrounds(): Promise<Record<string, string>> {
  return window.electronAPI.getLockerModBackgrounds();
}

export async function setLockerModBackground(skinKey: string, source: string): Promise<string> {
  return window.electronAPI.setLockerModBackground(skinKey, source);
}

export async function removeLockerModBackground(skinKey: string): Promise<void> {
  return window.electronAPI.removeLockerModBackground(skinKey);
}

export async function getLockerModBackgroundFlags(): Promise<Record<string, boolean>> {
  return window.electronAPI.getLockerModBackgroundFlags();
}

export async function setLockerModBackgroundHideName(skinKey: string, hide: boolean): Promise<void> {
  return window.electronAPI.setLockerModBackgroundHideName(skinKey, hide);
}

export async function getLockerModThumbnails(): Promise<Record<string, string>> {
  return window.electronAPI.getLockerModThumbnails();
}

export async function setLockerModThumbnail(skinKey: string, source: string): Promise<string> {
  return window.electronAPI.setLockerModThumbnail(skinKey, source);
}

export async function removeLockerModThumbnail(skinKey: string): Promise<void> {
  return window.electronAPI.removeLockerModThumbnail(skinKey);
}

export async function getLockerModThumbnailFlags(): Promise<Record<string, boolean>> {
  return window.electronAPI.getLockerModThumbnailFlags();
}

export async function setLockerModThumbnailHideName(skinKey: string, hide: boolean): Promise<void> {
  return window.electronAPI.setLockerModThumbnailHideName(skinKey, hide);
}

export async function getLockerModImageEdit(
  variant: LockerImageVariant,
  skinKey: string
): Promise<LockerImageEdit | null> {
  return window.electronAPI.getLockerModImageEdit(variant, skinKey);
}

export async function setLockerModImageEdit(
  variant: LockerImageVariant,
  skinKey: string,
  source: string,
  crop: CropRect
): Promise<void> {
  return window.electronAPI.setLockerModImageEdit(variant, skinKey, source, crop);
}

// Custom launcher / sidebar background images (issue: unify launcher backgrounds).
export async function getAppearanceImages(): Promise<Partial<Record<AppearanceSurface, string>>> {
  return window.electronAPI.getAppearanceImages();
}

export async function setAppearanceImage(
  surface: AppearanceSurface,
  source: string,
): Promise<string> {
  return window.electronAPI.setAppearanceImage(surface, source);
}

export async function removeAppearanceImage(surface: AppearanceSurface): Promise<void> {
  return window.electronAPI.removeAppearanceImage(surface);
}

export async function setAppearanceImageEdit(
  surface: AppearanceSurface,
  source: string,
  crop: CropRect,
): Promise<void> {
  return window.electronAPI.setAppearanceImageEdit(surface, source, crop);
}

export async function getAppearanceImageEdit(
  surface: AppearanceSurface,
): Promise<LockerImageEdit | null> {
  return window.electronAPI.getAppearanceImageEdit(surface);
}

export async function mergeMods(args: MergeModsArgs): Promise<Mod> {
  return window.electronAPI.mergeMods(args);
}

export async function unmergeMod(mergedModId: string): Promise<UnmergeModResult> {
  return window.electronAPI.unmergeMod(mergedModId);
}

export async function extractMergeSource(
  mergedModId: string,
  sourceFileName: string,
): Promise<ExtractMergeSourceResult> {
  return window.electronAPI.extractMergeSource(mergedModId, sourceFileName);
}

export type { UnmergeModResult, ExtractMergeSourceResult };

// =====================
// Launch API
// =====================

export interface VanillaStashStatus {
  active: boolean;
  startedAt?: string;
  modCount?: number;
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

export async function launchModded(): Promise<void> {
  return window.electronAPI.launchModded();
}

export async function launchVanilla(): Promise<void> {
  return window.electronAPI.launchVanilla();
}

export async function getGameRunningStatus(): Promise<GameRunningStatus> {
  return window.electronAPI.getGameRunningStatus();
}

export async function stopGame(): Promise<StopGameResult> {
  return window.electronAPI.stopGame();
}

export async function getVanillaStashStatus(): Promise<VanillaStashStatus> {
  return window.electronAPI.getVanillaStashStatus();
}

export async function restoreVanillaStash(): Promise<VanillaRestoreResult> {
  return window.electronAPI.restoreVanillaStash();
}

export function onVanillaRestoreComplete(
  callback: (result: VanillaRestoreResult) => void
): () => void {
  return window.electronAPI.onVanillaRestoreComplete(callback);
}

// GameBanana
export async function browseMods(
  page: number,
  perPage: number,
  search?: string,
  section?: string,
  categoryId?: number,
  sort?: string,
  submitterId?: number
): Promise<GameBananaModsResponse> {
  return window.electronAPI.browseMods({ page, perPage, search, section, categoryId, sort, submitterId });
}

export async function getModFileList(modId: number, section?: string): Promise<GameBananaModFileList> {
  return window.electronAPI.getModFileList({ modId, section });
}

export async function getModDetails(
  modId: number,
  section?: string,
  options: { includeSubmitter?: boolean } = {}
): Promise<GameBananaModDetails> {
  return window.electronAPI.getModDetails({ modId, section, ...options });
}

export async function getModComments(modId: number, section?: string, page = 1): Promise<GameBananaCommentsResponse> {
  return window.electronAPI.getModComments({ modId, section, page });
}

export async function getModUpdates(modId: number, section?: string, page = 1): Promise<GameBananaModUpdatesResponse> {
  return window.electronAPI.getModUpdates({ modId, section, page });
}

export async function getSubmitterLinks(memberId: number): Promise<GameBananaArtistLink[]> {
  return window.electronAPI.getSubmitterLinks(memberId);
}

export async function downloadMod(
  modId: number,
  fileId: number,
  fileName: string,
  section?: string,
  categoryId?: number,
  modName?: string
): Promise<void> {
  return window.electronAPI.downloadMod({ modId, fileId, fileName, section, categoryId, modName });
}

export async function getGamebananaSections(): Promise<GameBananaSection[]> {
  return window.electronAPI.getGameBananaSections();
}

export async function getGamebananaCategories(
  categoryModelName: string
): Promise<GameBananaCategoryNode[]> {
  return window.electronAPI.getGameBananaCategories({ categoryModelName });
}

export async function getCollection(collectionId: number): Promise<GameBananaCollection> {
  return window.electronAPI.getCollection({ collectionId });
}

export async function getCollectionItems(
  collectionId: number,
  page = 1
): Promise<GameBananaCollectionItemsResponse> {
  return window.electronAPI.getCollectionItems({ collectionId, page });
}

export async function cleanupAddons(): Promise<{
  removedArchives: number;
}> {
  return window.electronAPI.cleanupAddons();
}

export async function getGameinfoStatus(): Promise<{ configured: boolean; message: string; missing: boolean; candidates: string[] }> {
  return window.electronAPI.getGameinfoStatus();
}

export async function fixGameinfo(): Promise<{ configured: boolean; message: string; missing: boolean; candidates: string[] }> {
  return window.electronAPI.fixGameinfo();
}

export async function getPerformanceConfigStatus(): Promise<PerformanceConfigStatus> {
  return window.electronAPI.getPerformanceConfigStatus();
}

export async function applyPerformanceConfig(): Promise<PerformanceConfigStatus> {
  return window.electronAPI.applyPerformanceConfig();
}

export async function removePerformanceConfig(): Promise<PerformanceConfigStatus> {
  return window.electronAPI.removePerformanceConfig();
}

export async function resetPerformanceConfigOverrides(): Promise<PerformanceConfigStatus> {
  return window.electronAPI.resetPerformanceConfigOverrides();
}

export async function restorePerformanceConfigBackup(): Promise<PerformanceConfigStatus> {
  return window.electronAPI.restorePerformanceConfigBackup();
}

export async function openPerformanceConfigFile(): Promise<void> {
  return window.electronAPI.openPerformanceConfigFile();
}

export async function listEditorCandidates(): Promise<EditorCandidate[]> {
  return window.electronAPI.listEditorCandidates();
}

export async function openModsFolder(): Promise<void> {
  return window.electronAPI.openModsFolder();
}

export async function openGameFolder(): Promise<void> {
  return window.electronAPI.openGameFolder();
}

// Diagnostics
export async function buildDiagnosticReport(
  description: string,
  options?: { includeFullLog?: boolean },
): Promise<string> {
  return window.electronAPI.diagnostics.buildReport(description, options);
}

// Dialog helper for Settings page
export async function showOpenDialog(options: {
  directory?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  return window.electronAPI.showOpenDialog(options);
}

export async function showSaveDialog(options: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  return window.electronAPI.showSaveDialog(options);
}

export async function revealPath(targetPath: string): Promise<void> {
  return window.electronAPI.revealPath(targetPath);
}

// =====================
// Conflicts API
// =====================

export interface ModConflict {
  modA: string;
  modAName: string;
  modB: string;
  modBName: string;
  modAIdentity: string;
  modBIdentity: string;
  ignoreKey: string;
  conflictType: 'priority' | 'file';
  details: string;
}

// Conflict detection re-parses every enabled VPK on the main process, so
// firing it twice for the same store update (Sidebar badge + Installed
// page) doubled the freeze window. Concurrent callers share the in-flight
// promise; once it resolves, the next call starts a fresh scan so any
// state change since then is picked up immediately.
let conflictsInFlight: Promise<ModConflict[]> | null = null;

export async function getConflicts(): Promise<ModConflict[]> {
  if (conflictsInFlight) return conflictsInFlight;
  const promise = window.electronAPI.getConflicts();
  conflictsInFlight = promise;
  promise.finally(() => {
    if (conflictsInFlight === promise) conflictsInFlight = null;
  });
  return promise;
}

export async function getIgnoredConflicts(): Promise<string[]> {
  return window.electronAPI.getIgnoredConflicts();
}

export async function ignoreConflict(modA: string, modB: string): Promise<string[]> {
  return window.electronAPI.ignoreConflict(modA, modB);
}

export async function unignoreConflict(modA: string, modB: string): Promise<string[]> {
  return window.electronAPI.unignoreConflict(modA, modB);
}

/** Build the ignored-list key for a pair of mod ids or stable identities.
 *  Mirrors the backend helper so the renderer can match locally without an
 *  extra IPC roundtrip. */
export function conflictPairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

// =====================
// Profiles API
// =====================

// Profile wire types are single-sourced in types/electron.ts; re-exported
// here to preserve this module's existing import surface.
export type { Profile, ProfileMod, ProfileCrosshairSettings } from '../types/electron';
import type { Profile, ProfileCrosshairSettings, PerformanceConfigStatus, EditorCandidate, LockerImageVariant, LockerImageEdit, CropRect } from '../types/electron';

export async function getProfiles(): Promise<Profile[]> {
  return window.electronAPI.getProfiles();
}

export async function createProfile(name: string, crosshairSettings?: ProfileCrosshairSettings): Promise<Profile> {
  return window.electronAPI.createProfile(name, crosshairSettings);
}

export async function createProfileFromGameBananaIds(
  name: string,
  gameBananaIds: number[]
): Promise<Profile> {
  return window.electronAPI.createProfileFromGameBananaIds({ name, gameBananaIds });
}

export async function updateProfile(profileId: string, crosshairSettings?: ProfileCrosshairSettings): Promise<Profile> {
  return window.electronAPI.updateProfile(profileId, crosshairSettings);
}

export async function applyProfile(profileId: string): Promise<Profile> {
  return window.electronAPI.applyProfile(profileId);
}

export async function deleteProfile(profileId: string): Promise<void> {
  return window.electronAPI.deleteProfile(profileId);
}

export async function renameProfile(profileId: string, newName: string): Promise<Profile> {
  return window.electronAPI.renameProfile(profileId, newName);
}

// =====================
// Portable Profile API
// =====================

import type {
  PortableProfile,
  PortableExportResult,
  PortableResolutionReport,
  PortableResolvedMod,
} from '../types/portableProfile';

export async function exportPortableProfile(profileId: string): Promise<PortableExportResult> {
  return window.electronAPI.exportPortableProfile(profileId);
}

export async function parsePortableProfile(input: string): Promise<PortableProfile> {
  return window.electronAPI.parsePortableProfile(input);
}

export async function resolvePortableProfile(profile: PortableProfile): Promise<PortableResolutionReport> {
  return window.electronAPI.resolvePortableProfile(profile);
}

export async function finalizePortableImport(args: {
  profile: PortableProfile;
  resolved: PortableResolvedMod[];
}): Promise<Profile> {
  return window.electronAPI.finalizePortableImport(args);
}

// =====================
// Snapshots API
// =====================

import type { SnapshotSummary, SnapshotTrigger } from '../types/snapshot';

export async function createSnapshot(trigger: SnapshotTrigger): Promise<SnapshotSummary> {
  return window.electronAPI.snapshots.create(trigger);
}

export async function listSnapshots(): Promise<SnapshotSummary[]> {
  return window.electronAPI.snapshots.list();
}

export async function loadSnapshot(snapshotId: string): Promise<string> {
  return window.electronAPI.snapshots.load(snapshotId);
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  return window.electronAPI.snapshots.delete(snapshotId);
}

// =====================
// Grimoire Social API
// =====================

import type {
  LikeResponse as SocialLikeResponse,
  ListProfilesResponse as SocialListProfilesResponse,
  MeResponse as SocialMeResponse,
  ProfileDetail as SocialProfileDetail,
  ProfileSort as SocialProfileSort,
  PublishRequest as SocialPublishRequest,
  PublishResponse as SocialPublishResponse,
  ReportRequest as SocialReportRequest,
  UpdateProfileRequest as SocialUpdateProfileRequest,
  UpdateProfileResponse as SocialUpdateProfileResponse,
} from '@grimoire/social-types';
import type { SocialSessionStatus } from '../types/social';

export type {
  SocialLikeResponse,
  SocialListProfilesResponse,
  SocialMeResponse,
  SocialProfileDetail,
  SocialProfileSort,
  SocialPublishRequest,
  SocialPublishResponse,
  SocialReportRequest,
  SocialUpdateProfileRequest,
  SocialUpdateProfileResponse,
  SocialSessionStatus,
};

export async function getSocialSessionStatus(): Promise<SocialSessionStatus> {
  return window.electronAPI.social.getSessionStatus();
}

export async function socialLogin(): Promise<SocialSessionStatus> {
  return window.electronAPI.social.login();
}

export async function socialCancelLogin(): Promise<void> {
  return window.electronAPI.social.cancelLogin();
}

export async function socialLogout(): Promise<SocialSessionStatus> {
  return window.electronAPI.social.logout();
}

export async function socialMe(): Promise<SocialMeResponse> {
  return window.electronAPI.social.me();
}

export async function socialListProfiles(args?: {
  sort?: SocialProfileSort;
  hero?: string;
  hideNsfw?: boolean;
  page?: number;
}): Promise<SocialListProfilesResponse> {
  return window.electronAPI.social.listProfiles(args);
}

export async function socialGetProfile(id: string): Promise<SocialProfileDetail> {
  return window.electronAPI.social.getProfile(id);
}

export async function socialPublish(body: SocialPublishRequest): Promise<SocialPublishResponse> {
  return window.electronAPI.social.publish(body);
}

export async function socialUpdateProfile(
  id: string,
  body: SocialUpdateProfileRequest
): Promise<SocialUpdateProfileResponse> {
  return window.electronAPI.social.updateProfile(id, body);
}

export async function socialLike(id: string): Promise<SocialLikeResponse> {
  return window.electronAPI.social.like(id);
}

export async function socialUnlike(id: string): Promise<SocialLikeResponse> {
  return window.electronAPI.social.unlike(id);
}

export async function socialReport(id: string, body: SocialReportRequest): Promise<void> {
  return window.electronAPI.social.report(id, body);
}

export async function socialDeleteProfile(id: string): Promise<void> {
  return window.electronAPI.social.deleteProfile(id);
}

export async function socialDeleteAccount(): Promise<SocialSessionStatus> {
  return window.electronAPI.social.deleteAccount();
}

export function socialOnSessionChanged(
  callback: (status: SocialSessionStatus) => void
): () => void {
  return window.electronAPI.social.onSessionChanged(callback);
}

// =====================
// Language packs API
// =====================

export type { DownloadedLocale, LocaleManifest };

/** Fetch the language index from GitHub `main` (falls back to the bundled copy). */
export async function getLocaleManifest(): Promise<LocaleManifest> {
  return window.electronAPI.locales.getManifest();
}

/** Languages already downloaded and cached to disk. */
export async function listDownloadedLocales(): Promise<DownloadedLocale[]> {
  return window.electronAPI.locales.listDownloaded();
}

/** Download a language's catalog from GitHub and cache it for offline use. */
export async function downloadLocale(languageCode: string): Promise<DownloadedLocale> {
  return window.electronAPI.locales.download(languageCode);
}

/** Re-fetch downloaded catalogs, returning only the ones whose content changed. */
export async function refreshDownloadedLocales(): Promise<DownloadedLocale[]> {
  return window.electronAPI.locales.refresh();
}

// ── Deadworks custom-server browser ──
import type {
  DeadworksServer,
  DeadworksContentItem,
  DeadworksConnectResult,
  DeadworksConnectProgress,
  DeadworksRelayStats,
} from '../types/deadworks';

export type {
  DeadworksServer,
  DeadworksContentItem,
  DeadworksConnectResult,
  DeadworksConnectProgress,
  DeadworksRelayStats,
};

export async function deadworksGetRelayUrl(): Promise<string> {
  return window.electronAPI.deadworksGetRelayUrl();
}

export async function deadworksListServers(): Promise<DeadworksServer[]> {
  return window.electronAPI.deadworksListServers();
}

export async function deadworksServerContent(serverId: string): Promise<DeadworksContentItem[]> {
  return window.electronAPI.deadworksServerContent(serverId);
}

export async function deadworksRelayStats(): Promise<DeadworksRelayStats | null> {
  return window.electronAPI.deadworksRelayStats();
}

export async function deadworksPingServer(addr: string): Promise<number> {
  return window.electronAPI.deadworksPingServer(addr);
}

export async function deadworksConnect(serverId: string, addr: string): Promise<DeadworksConnectResult> {
  return window.electronAPI.deadworksConnect(serverId, addr);
}

export function deadworksOnDownloadProgress(
  callback: (p: DeadworksConnectProgress) => void
): () => void {
  return window.electronAPI.onDeadworksDownloadProgress(callback);
}
