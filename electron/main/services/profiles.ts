import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { getUserDataPath } from '../utils/paths';
import { scanMods, enableMod, disableMod, setModPriority, Mod } from './mods';
import { readAutoexec, writeAutoexec } from './autoexec';

export interface ProfileMod {
    fileName: string;   // Use fileName as the stable identifier
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

/**
 * Get the profiles file path
 */
function getProfilesPath(): string {
    return join(getUserDataPath(), 'profiles.json');
}

/**
 * Generate a unique profile ID
 */
function generateProfileId(): string {
    return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Load all profiles from disk
 */
export function loadProfiles(): Profile[] {
    const path = getProfilesPath();

    if (!existsSync(path)) {
        return [];
    }

    try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content) as Profile[];
    } catch (error) {
        console.warn('[Profiles] Failed to load profiles, returning empty:', error);
        return [];
    }
}

/**
 * Save profiles to disk atomically (P1 fix #8, #10)
 * Uses write-to-temp-then-rename pattern to prevent corruption on crash
 */
function saveProfiles(profiles: Profile[]): void {
    const path = getProfilesPath();
    const tempPath = `${path}.tmp`;
    const dir = dirname(path);

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    try {
        writeFileSync(tempPath, JSON.stringify(profiles, null, 2), 'utf-8');
        renameSync(tempPath, path);
    } catch (error) {
        try {
            if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch { /* ignore */ }
        throw error;
    }
}

/**
 * Create a new profile from current mod state and provided crosshair settings
 */
export async function createProfile(deadlockPath: string, name: string, crosshairSettings?: ProfileCrosshairSettings): Promise<Profile> {
    const mods = await scanMods(deadlockPath);
    const enabledMods = mods.filter(mod => mod.enabled);  // Only save enabled mods

    // Read current autoexec commands
    const autoexecData = readAutoexec(deadlockPath);

    const now = new Date().toISOString();

    const profile: Profile = {
        id: generateProfileId(),
        name,
        mods: enabledMods.map(mod => ({
            fileName: mod.fileName,
            enabled: true,  // Always true since we only save enabled mods
            priority: mod.priority,
        })),
        crosshair: crosshairSettings,
        autoexecCommands: autoexecData.commands,
        createdAt: now,
        updatedAt: now,
    };

    const profiles = loadProfiles();
    profiles.push(profile);
    saveProfiles(profiles);

    return profile;
}

/**
 * Update an existing profile with current mod state
 * Only saves enabled mods - disabled mods are not included
 */
export async function updateProfile(deadlockPath: string, profileId: string, crosshairSettings?: ProfileCrosshairSettings): Promise<Profile> {
    const profiles = loadProfiles();
    const index = profiles.findIndex(p => p.id === profileId);

    if (index === -1) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    const mods = await scanMods(deadlockPath);
    const enabledMods = mods.filter(mod => mod.enabled);  // Only save enabled mods

    // Read current autoexec commands
    const autoexecData = readAutoexec(deadlockPath);

    profiles[index] = {
        ...profiles[index],
        mods: enabledMods.map(mod => ({
            fileName: mod.fileName,
            enabled: true,
            priority: mod.priority,
        })),
        crosshair: crosshairSettings || profiles[index].crosshair, // Update if provided, else keep existing? Or maybe undefined to remove? 
        // Logic: if updating from UI, we likely want to snapshot current state. If crosshairSettings is passed, use it.
        autoexecCommands: autoexecData.commands,
        updatedAt: new Date().toISOString(),
    };

    saveProfiles(profiles);
    return profiles[index];
}

function generateCrosshairCommands(settings: ProfileCrosshairSettings): string {
    const commands = [
        `citadel_crosshair_pip_gap ${settings.pipGap}`,
        `citadel_crosshair_pip_height ${settings.pipHeight}`,
        `citadel_crosshair_pip_width ${settings.pipWidth}`,
        `citadel_crosshair_pip_opacity ${settings.pipOpacity.toFixed(2)}`,
        `citadel_crosshair_pip_border ${settings.pipBorder}`,
        `citadel_crosshair_dot_opacity ${settings.dotOpacity.toFixed(2)}`,
        `citadel_crosshair_dot_outline_opacity ${settings.dotOutlineOpacity.toFixed(2)}`,
        `citadel_crosshair_color_r ${settings.colorR}`,
        `citadel_crosshair_color_g ${settings.colorG}`,
        `citadel_crosshair_color_b ${settings.colorB}`,
    ];
    return commands.join('\n');
}

/**
 * Apply a profile - enable/disable mods, restore autoexec and crosshair
 */
export async function applyProfile(deadlockPath: string, profileId: string): Promise<Profile> {
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === profileId);

    if (!profile) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    // 1. Apply Mods
    const currentMods = await scanMods(deadlockPath);
    const profileModMap = new Map<string, ProfileMod>();
    for (const profileMod of profile.mods) {
        profileModMap.set(profileMod.fileName, profileMod);
    }

    for (const mod of currentMods) {
        const profileMod = profileModMap.get(mod.fileName);

        if (profileMod) {
            if (profileMod.enabled !== mod.enabled) {
                if (profileMod.enabled) {
                    await enableMod(deadlockPath, mod.id);
                } else {
                    await disableMod(deadlockPath, mod.id);
                }
            }
        } else {
            // Mod wasn't in the profile - disable it
            if (mod.enabled) {
                await disableMod(deadlockPath, mod.id);
            }
        }
    }

    // 2. Apply Autoexec & Crosshair
    const currentAutoexec = readAutoexec(deadlockPath);

    // Update commands if present in profile
    if (profile.autoexecCommands) {
        currentAutoexec.commands = profile.autoexecCommands;
    }

    // Update crosshair if present in profile
    if (profile.crosshair) {
        currentAutoexec.crosshair = generateCrosshairCommands(profile.crosshair);
    }

    writeAutoexec(deadlockPath, currentAutoexec);

    return profile;
}

/**
 * Delete a profile
 */
export function deleteProfile(profileId: string): void {
    const profiles = loadProfiles();
    const filtered = profiles.filter(p => p.id !== profileId);

    if (filtered.length === profiles.length) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    saveProfiles(filtered);
}

/**
 * Rename a profile
 */
export function renameProfile(profileId: string, newName: string): Profile {
    const profiles = loadProfiles();
    const index = profiles.findIndex(p => p.id === profileId);

    if (index === -1) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    profiles[index].name = newName;
    profiles[index].updatedAt = new Date().toISOString();

    saveProfiles(profiles);
    return profiles[index];
}
