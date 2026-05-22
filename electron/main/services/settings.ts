import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { getSettingsPath } from '../utils/paths';

export interface AppSettings {
    deadlockPath: string | null;
    devMode: boolean;
    devDeadlockPath: string | null;
    hideNsfwPreviews: boolean;
    hideOutdatedMods: boolean;       // Hide GameBanana mods flagged as outdated in Browse
    autoDisableSiblingVariants: boolean; // When re-downloading a GB mod, auto-disable older variants
    steamLaunchOptions: string;      // Args written to Steam's localconfig.vdf for Deadlock just before launch
    activeProfileId: string | null;  // Currently active profile
    autoSaveProfile: boolean;        // Auto-save when mods change
    experimentalStats: boolean;
    experimentalCrosshair: boolean;
    experimentalSocial: boolean;     // Grimoire Social: Discover page + publish/account UI
    /** Auto-match unknown local VPKs against GameBanana (CRC-32 + filter
     *  search). Off by default while the matching path is reworked: the
     *  current implementation hits GameBanana rate limits hard on libraries
     *  with many unknown files. When off, the "Fix unknown" UI still opens
     *  but the search/find buttons and bulk auto-find are hidden, leaving
     *  only the manual "Make Custom Mod" path. */
    experimentalUnknownModMatching: boolean;
    hasCompletedSetup: boolean;      // First-run setup completed
    /** Mod pairs the user has dismissed in the Conflicts page. New entries use
     *  stable per-mod identities (GameBanana mod/file ids when available)
     *  joined sorted with `::`; older local-id pairs are still recognized. */
    ignoredConflicts: string[];
    /** When true, the conflict detector returns an empty list — every detected
     *  pair is hidden without persisting it to ignoredConflicts, so toggling
     *  back off restores the original conflict view. */
    ignoreConflictsByDefault: boolean;
    /** UI accent color (hex, e.g. "#f97316"). Used to theme buttons, links, and
     *  focus rings throughout the app. */
    accentColor: string;
}

const DEFAULT_SETTINGS: AppSettings = {
    deadlockPath: null,
    devMode: false,
    devDeadlockPath: null,
    hideNsfwPreviews: false,
    hideOutdatedMods: false,
    autoDisableSiblingVariants: true,
    steamLaunchOptions: '',
    activeProfileId: null,
    autoSaveProfile: false,
    experimentalStats: false,
    experimentalCrosshair: false,
    experimentalSocial: false,
    experimentalUnknownModMatching: false,
    hasCompletedSetup: false,
    ignoredConflicts: [],
    ignoreConflictsByDefault: false,
    accentColor: '#f97316',
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
