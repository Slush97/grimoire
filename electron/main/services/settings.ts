import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
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
    experimentalStats: boolean;
    experimentalCrosshair: boolean;
    hasCompletedSetup: boolean;      // First-run setup completed
}

const DEFAULT_SETTINGS: AppSettings = {
    deadlockPath: null,
    autoConfigureGameInfo: true,
    devMode: false,
    devDeadlockPath: null,
    hideNsfwPreviews: false,
    activeProfileId: null,
    autoSaveProfile: false,
    experimentalStats: false,
    experimentalCrosshair: false,
    hasCompletedSetup: false,
};

/**
 * Load settings from disk
 * If settings are corrupted, resets to defaults and logs warning (P2 fix #21)
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
    } catch (error) {
        console.warn('[Settings] Failed to load settings, resetting to defaults:', error);
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Save settings to disk atomically (P1 fix #8)
 * Uses write-to-temp-then-rename pattern to prevent corruption on crash
 */
export function saveSettings(settings: AppSettings): void {
    const path = getSettingsPath();
    const tempPath = `${path}.tmp`;
    const dir = dirname(path);

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    try {
        // Write to temp file first
        writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf-8');

        // Atomic rename (on most filesystems, rename is atomic)
        renameSync(tempPath, path);
    } catch (error) {
        // Clean up temp file if rename failed
        try {
            if (existsSync(tempPath)) {
                unlinkSync(tempPath);
            }
        } catch { /* ignore cleanup errors */ }

        throw error;
    }
}
