import { invoke } from '@tauri-apps/api/core';
import type { Mod, AppSettings } from '../types/mod';
import type {
  GameBananaModsResponse,
  GameBananaModDetails,
  GameBananaSection,
  GameBananaCategoryNode,
} from '../types/gamebanana';

// Settings
export async function detectDeadlock(): Promise<string | null> {
  return invoke('detect_deadlock');
}

export async function validateDeadlockPath(path: string): Promise<boolean> {
  return invoke('validate_deadlock_path', { path });
}

export async function getSettings(): Promise<AppSettings> {
  return invoke('get_settings');
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return invoke('set_settings', { settings });
}

// Mods
export async function getMods(): Promise<Mod[]> {
  return invoke('get_mods');
}

export async function enableMod(modId: string): Promise<Mod> {
  return invoke('enable_mod_cmd', { modId });
}

export async function disableMod(modId: string): Promise<Mod> {
  return invoke('disable_mod_cmd', { modId });
}

export async function deleteMod(modId: string): Promise<void> {
  return invoke('delete_mod_cmd', { modId });
}

export async function setModPriority(modId: string, priority: number): Promise<Mod> {
  return invoke('set_mod_priority_cmd', { modId, priority });
}

// GameBanana
export async function browseMods(
  page: number,
  perPage: number,
  search?: string,
  section?: string,
  categoryId?: number
): Promise<GameBananaModsResponse> {
  console.log('[DEBUG] browseMods called with:', { page, perPage, search, section, categoryId });
  return invoke('browse_mods', { args: { page, perPage, search, section, categoryId } });
}

export async function getModDetails(modId: number, section?: string): Promise<GameBananaModDetails> {
  return invoke('get_mod_details', { args: { modId, section } });
}

export async function downloadMod(
  modId: number,
  fileId: number,
  fileName: string,
  section?: string
): Promise<void> {
  return invoke('download_mod', { args: { modId, fileId, fileName, section } });
}

export async function getGamebananaSections(): Promise<GameBananaSection[]> {
  return invoke('get_gamebanana_sections');
}

export async function getGamebananaCategories(
  categoryModelName: string
): Promise<GameBananaCategoryNode[]> {
  return invoke('get_gamebanana_categories', { args: { categoryModelName } });
}
