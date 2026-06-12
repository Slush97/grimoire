import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { getSettingsPath } from '../utils/paths';

// AppSettings is single-sourced in src/types/mod.ts (type-only import:
// erased at build, so no renderer code is pulled into the main bundle).
// Re-exported so existing `from './settings'` imports keep working.
import type { AppSettings } from '../../../src/types/mod';
export type { AppSettings };

const DEFAULT_SETTINGS: AppSettings = {
    deadlockPath: null,
    devMode: false,
    devDeadlockPath: null,
    hideNsfwPreviews: true,
    hideOutdatedMods: false,
    lockerCardsExpandedByDefault: false,
    autoDisableSiblingVariants: true,
    autoEnableDownloads: false,
    steamLaunchOptions: '',
    activeProfileId: null,
    confirmProfileUpdate: true,
    experimentalStats: false,
    experimentalCrosshair: false,
    experimentalSocial: false,
    experimentalUnknownModMatching: false,
    hasCompletedSetup: false,
    ignoredConflicts: [],
    ignoreConflictsByDefault: false,
    accentColor: '#f97316',
    sidebarHeroHighlight: 'Abrams',
    dateFormat: 'MM/DD/YYYY',
    language: null,
    zoomFactor: 1,
    discordRpcEnabled: false,
    contributeMatchSalts: false,
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
 * The Deadlock path IPC handlers should act on: the dev dummy path when dev
 * mode is active, otherwise the user's configured install. Single-sourced
 * here; IPC modules import it instead of keeping local copies.
 */
export function getActiveDeadlockPath(): string | null {
    const settings = loadSettings();
    if (settings.devMode && settings.devDeadlockPath) {
        return settings.devDeadlockPath;
    }
    return settings.deadlockPath;
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
