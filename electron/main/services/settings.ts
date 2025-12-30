import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getSettingsPath } from '../utils/paths';

export interface AppSettings {
    deadlockPath: string | null;
    autoConfigureGameInfo: boolean;
    devMode: boolean;
    devDeadlockPath: string | null;
    hideNsfwPreviews: boolean;
    activeProfileId: string | null;  // Currently active profile
    autoSaveProfile: boolean;        // Auto-save when mods change
}

const DEFAULT_SETTINGS: AppSettings = {
    deadlockPath: null,
    autoConfigureGameInfo: true,
    devMode: false,
    devDeadlockPath: null,
    hideNsfwPreviews: false,
    activeProfileId: null,
    autoSaveProfile: false,
};

/**
 * Load settings from disk
 */
export function loadSettings(): AppSettings {
    const path = getSettingsPath();

    if (!existsSync(path)) {
        return { ...DEFAULT_SETTINGS };
    }

    try {
        const content = readFileSync(path, 'utf-8');
        const settings = JSON.parse(content) as Partial<AppSettings>;
        return { ...DEFAULT_SETTINGS, ...settings };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Save settings to disk
 */
export function saveSettings(settings: AppSettings): void {
    const path = getSettingsPath();
    const dir = dirname(path);

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
}
