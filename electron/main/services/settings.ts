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
    browseNsfwContentMode: 'blur',
    installedHideNsfwPreviews: true,
    hideOutdatedMods: false,
    hiddenCreators: [],
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
    experimentalVpkImprinting: false,
    hasCompletedSetup: false,
    ignoredConflicts: [],
    ignoreConflictsByDefault: false,
    ignoredConflictFiles: {},
    ignoredConflictFilesGlobal: [],
    ignoredConflictMods: [],
    accentColor: '#f97316',
    sidebarHeroHighlight: 'Abrams',
    dateFormat: 'MM/DD/YYYY',
    language: null,
    zoomFactor: 1,
    discordRpcEnabled: false,
    contributeMatchSalts: false,
    unifiedLaunchButton: false,
    sidebarTransparent: false,
    backgroundGradient: null,
    verboseModTrace: false,
    forgeLocalInstallEnabled: false,
};

/** Normalize user-editable settings.json data into a small, deterministic
 *  creator list. Invalid ids are ignored and duplicate ids keep the most
 *  recently listed display name. */
function normalizeHiddenCreators(value: unknown): AppSettings['hiddenCreators'] {
    if (!Array.isArray(value)) return [];

    const byId = new Map<number, string>();
    for (const candidate of value) {
        if (!candidate || typeof candidate !== 'object') continue;
        const { id, name } = candidate as { id?: unknown; name?: unknown };
        if (!Number.isSafeInteger(id) || (id as number) <= 0 || typeof name !== 'string') continue;
        const trimmedName = name.trim();
        if (!trimmedName) continue;
        byId.set(id as number, trimmedName.slice(0, 200));
    }

    return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

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
        return {
            ...DEFAULT_SETTINGS,
            ...settings,
            hiddenCreators: normalizeHiddenCreators(settings.hiddenCreators),
            browseNsfwContentMode:
                settings.browseNsfwContentMode ??
                (settings.hideNsfwPreviews === false ? 'show' : DEFAULT_SETTINGS.browseNsfwContentMode),
            installedHideNsfwPreviews:
                settings.installedHideNsfwPreviews ??
                settings.hideNsfwPreviews ??
                DEFAULT_SETTINGS.installedHideNsfwPreviews,
            // PRE-RELEASE SHIM: delete before first release. Migrate the
            // pre-rename flag id so an existing opt-in survives.
            experimentalVpkImprinting:
                settings.experimentalVpkImprinting ??
                (settings as { experimentalVpkTagging?: boolean }).experimentalVpkTagging ??
                DEFAULT_SETTINGS.experimentalVpkImprinting,
        };
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
