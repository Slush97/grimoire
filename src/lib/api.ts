import type { Mod, AppSettings, UnknownModFilterGuess, ApplyUnknownModMatchArgs, ApplyUnknownCustomModArgs, MergeModsArgs, UnmergeModResult } from '../types/mod';
import type {
  GameBananaModsResponse,
  GameBananaModDetails,
  GameBananaModFileList,
  GameBananaSection,
  GameBananaCategoryNode,
  GameBananaMod,
  GameBananaCommentsResponse,
  GameBananaCollection,
  GameBananaCollectionItemsResponse,
} from '../types/gamebanana';

// Re-export types for convenience
export type {
  GameBananaModsResponse,
  GameBananaModDetails,
  GameBananaModFileList,
  GameBananaSection,
  GameBananaCategoryNode,
  GameBananaMod,
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

export async function detectUnknownModFilters(modId: string): Promise<UnknownModFilterGuess> {
  return window.electronAPI.detectUnknownModFilters(modId);
}

export async function cancelUnknownModDetection(modId: string): Promise<void> {
  return window.electronAPI.cancelUnknownModDetection(modId);
}

export async function applyUnknownModMatch(modId: string, args: ApplyUnknownModMatchArgs): Promise<Mod> {
  return window.electronAPI.applyUnknownModMatch(modId, args);
}

export async function applyUnknownCustomMod(modId: string, args: ApplyUnknownCustomModArgs): Promise<Mod> {
  return window.electronAPI.applyUnknownCustomMod(modId, args);
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

export async function backfillGameBananaFileId(
  modId: string,
  payload: { gameBananaFileId: number; fileDescription?: string; sourceFileName?: string }
): Promise<Mod> {
  return window.electronAPI.backfillGameBananaFileId(modId, payload);
}

export async function setModPriority(modId: string, priority: number): Promise<Mod> {
  return window.electronAPI.setModPriority(modId, priority);
}

export async function reorderMods(orderedFileNames: string[]): Promise<Mod[]> {
  return window.electronAPI.reorderMods(orderedFileNames);
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

export async function readImageDataUrl(imagePath: string): Promise<string> {
  return window.electronAPI.readImageDataUrl(imagePath);
}

export async function mergeMods(args: MergeModsArgs): Promise<Mod> {
  return window.electronAPI.mergeMods(args);
}

export async function unmergeMod(mergedModId: string): Promise<UnmergeModResult> {
  return window.electronAPI.unmergeMod(mergedModId);
}

export type { UnmergeModResult };

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
  sort?: string
): Promise<GameBananaModsResponse> {
  return window.electronAPI.browseMods({ page, perPage, search, section, categoryId, sort });
}

export async function getModFileList(modId: number, section?: string): Promise<GameBananaModFileList> {
  return window.electronAPI.getModFileList({ modId, section });
}

export async function getModDetails(modId: number, section?: string): Promise<GameBananaModDetails> {
  return window.electronAPI.getModDetails({ modId, section });
}

export async function getModComments(modId: number, section?: string, page = 1): Promise<GameBananaCommentsResponse> {
  return window.electronAPI.getModComments({ modId, section, page });
}

export async function downloadMod(
  modId: number,
  fileId: number,
  fileName: string,
  section?: string,
  categoryId?: number
): Promise<void> {
  return window.electronAPI.downloadMod({ modId, fileId, fileName, section, categoryId });
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

export async function setMinaPreset(presetFileName: string): Promise<void> {
  return window.electronAPI.setMinaPreset({ presetFileName });
}

export async function listMinaVariants(archivePath: string): Promise<string[]> {
  return window.electronAPI.listMinaVariants({ archivePath });
}

export async function applyMinaVariant(
  archivePath: string,
  archiveEntry: string,
  presetLabel: string,
  heroCategoryId?: number
): Promise<void> {
  return window.electronAPI.applyMinaVariant({
    archivePath,
    archiveEntry,
    presetLabel,
    heroCategoryId,
  });
}

export async function cleanupAddons(): Promise<{
  removedArchives: number;
  renamedMinaPresets: number;
  renamedMinaTextures: number;
  skippedMinaPresets: number;
  skippedMinaTextures: number;
}> {
  return window.electronAPI.cleanupAddons();
}

export async function getGameinfoStatus(): Promise<{ configured: boolean; message: string; missing: boolean; candidates: string[] }> {
  return window.electronAPI.getGameinfoStatus();
}

export async function fixGameinfo(): Promise<{ configured: boolean; message: string; missing: boolean; candidates: string[] }> {
  return window.electronAPI.fixGameinfo();
}

export async function openModsFolder(): Promise<void> {
  return window.electronAPI.openModsFolder();
}

export async function openGameFolder(): Promise<void> {
  return window.electronAPI.openGameFolder();
}

// Diagnostics
export async function getLogPath(): Promise<string> {
  return window.electronAPI.diagnostics.getLogPath();
}

export async function openLogsFolder(): Promise<void> {
  return window.electronAPI.diagnostics.openLogsFolder();
}

export async function saveDiagnosticReport(): Promise<{ path: string } | null> {
  return window.electronAPI.diagnostics.saveReport();
}

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

export interface ProfileMod {
  fileName: string;
  enabled: boolean;
  priority: number;
  /** Stable identity. Populated at profile-save time from metadata; used by
   *  applyProfile to resolve mods whose fileName has changed since save. */
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
