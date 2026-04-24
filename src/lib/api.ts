import type { Mod, AppSettings } from '../types/mod';
import type {
  GameBananaModsResponse,
  GameBananaModDetails,
  GameBananaSection,
  GameBananaCategoryNode,
  GameBananaMod,
  GameBananaCommentsResponse,
} from '../types/gamebanana';

// Re-export types for convenience
export type {
  GameBananaModsResponse,
  GameBananaModDetails,
  GameBananaSection,
  GameBananaCategoryNode,
  GameBananaMod,
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

export async function launchModded(): Promise<void> {
  return window.electronAPI.launchModded();
}

export async function launchVanilla(): Promise<void> {
  return window.electronAPI.launchVanilla();
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

export async function getGameinfoStatus(): Promise<{ configured: boolean; message: string }> {
  return window.electronAPI.getGameinfoStatus();
}

export async function fixGameinfo(): Promise<{ configured: boolean; message: string }> {
  return window.electronAPI.fixGameinfo();
}

export async function openModsFolder(): Promise<void> {
  return window.electronAPI.openModsFolder();
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
  conflictType: 'priority' | 'file';
  details: string;
}

export async function getConflicts(): Promise<ModConflict[]> {
  return window.electronAPI.getConflicts();
}

// =====================
// Profiles API
// =====================

export interface ProfileMod {
  fileName: string;
  enabled: boolean;
  priority: number;
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
