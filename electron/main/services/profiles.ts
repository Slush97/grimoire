import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getUserDataPath } from '../utils/paths';
import { scanMods, enableMod, disableMod, setModPriority, Mod } from './mods';

export interface ProfileMod {
    fileName: string;   // Use fileName as the stable identifier
    enabled: boolean;
    priority: number;
}

export interface Profile {
    id: string;
    name: string;
    mods: ProfileMod[];
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
    } catch {
        return [];
    }
}

/**
 * Save profiles to disk
 */
function saveProfiles(profiles: Profile[]): void {
    const path = getProfilesPath();
    const dir = dirname(path);

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    writeFileSync(path, JSON.stringify(profiles, null, 2), 'utf-8');
}

/**
 * Create a new profile from current mod state
 * Only saves enabled mods - disabled mods are not included
 */
export function createProfile(deadlockPath: string, name: string): Profile {
    const mods = scanMods(deadlockPath);
    const enabledMods = mods.filter(mod => mod.enabled);  // Only save enabled mods
    const now = new Date().toISOString();

    const profile: Profile = {
        id: generateProfileId(),
        name,
        mods: enabledMods.map(mod => ({
            fileName: mod.fileName,
            enabled: true,  // Always true since we only save enabled mods
            priority: mod.priority,
        })),
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
export function updateProfile(deadlockPath: string, profileId: string): Profile {
    const profiles = loadProfiles();
    const index = profiles.findIndex(p => p.id === profileId);

    if (index === -1) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    const mods = scanMods(deadlockPath);
    const enabledMods = mods.filter(mod => mod.enabled);  // Only save enabled mods

    profiles[index] = {
        ...profiles[index],
        mods: enabledMods.map(mod => ({
            fileName: mod.fileName,
            enabled: true,
            priority: mod.priority,
        })),
        updatedAt: new Date().toISOString(),
    };

    saveProfiles(profiles);
    return profiles[index];
}

/**
 * Apply a profile - enable/disable mods to match the profile state
 */
export function applyProfile(deadlockPath: string, profileId: string): void {
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === profileId);

    if (!profile) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    const currentMods = scanMods(deadlockPath);

    // Create a map of profile mod states by fileName
    const profileModMap = new Map<string, ProfileMod>();
    for (const profileMod of profile.mods) {
        profileModMap.set(profileMod.fileName, profileMod);
    }

    // Apply the profile state to each mod
    for (const mod of currentMods) {
        const profileMod = profileModMap.get(mod.fileName);

        if (profileMod) {
            // Match the enabled state
            if (profileMod.enabled !== mod.enabled) {
                if (profileMod.enabled) {
                    enableMod(deadlockPath, mod.id);
                } else {
                    disableMod(deadlockPath, mod.id);
                }
            }

            // TODO: Priority changes would require rescanning after each change
            // For now, we just sync enabled/disabled state
        } else {
            // Mod wasn't in the profile - disable it
            if (mod.enabled) {
                disableMod(deadlockPath, mod.id);
            }
        }
    }
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
