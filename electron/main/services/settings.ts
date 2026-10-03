import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { getSettingsPath } from '../utils/paths';

// AppSettings is single-sourced in src/types/mod.ts (type-only import:
// erased at build, so no renderer code is pulled into the main bundle).
// Re-exported so existing `from './settings'` imports keep working.
import type { AppSettings, NsfwContentMode } from '../../../src/types/mod';
export type { AppSettings };

const DEFAULT_SETTINGS: AppSettings = {
    deadlockPath: null,
    devMode: false,
    devDeadlockPath: null,
    nsfwContentMode: 'blur',
    hideOutdatedMods: false,
    hiddenCreators: [],
    hiddenMods: [],
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
    experimentalModSafety: false,
    hasCompletedSetup: false,
    ignoredConflicts: [],
    ignoreConflictsByDefault: false,
    ignoredConflictFiles: {},
    ignoredConflictFilesGlobal: [],
    ignoredConflictMods: [],
    accentColor: '#f97316',
    oledMode: false,
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

/** One hidden creator/mod entry from user-editable settings.json, or null when
 *  its id or name is unusable. */
function parseHiddenEntry(candidate: unknown): { id: number; name: string } | null {
    if (!candidate || typeof candidate !== 'object') return null;
    const { id, name } = candidate as { id?: unknown; name?: unknown };
    if (!Number.isSafeInteger(id) || (id as number) <= 0 || typeof name !== 'string') return null;
    const trimmedName = name.trim();
    if (!trimmedName) return null;
    return { id: id as number, name: trimmedName.slice(0, 200) };
}

/** Normalize settings.json data into a small, deterministic creator list.
 *  Invalid entries are ignored and duplicate ids keep the most recently listed
 *  display name. */
function normalizeHiddenCreators(value: unknown): AppSettings['hiddenCreators'] {
    if (!Array.isArray(value)) return [];

    const byId = new Map<number, AppSettings['hiddenCreators'][number]>();
    for (const candidate of value) {
        const entry = parseHiddenEntry(candidate);
        if (entry) byId.set(entry.id, entry);
    }
    return [...byId.values()];
}

const HIDDEN_MOD_SECTIONS = new Set(['Mod', 'Sound', 'Wip']);

/** Same for hidden mods, keyed by section too: GameBanana numbers Mods, Sounds
 *  and WiPs separately, so a bare id can name two different submissions. */
function normalizeHiddenMods(value: unknown): AppSettings['hiddenMods'] {
    if (!Array.isArray(value)) return [];

    const byKey = new Map<string, AppSettings['hiddenMods'][number]>();
    for (const candidate of value) {
        const entry = parseHiddenEntry(candidate);
        const section = (candidate as { section?: unknown } | null)?.section;
        if (!entry || typeof section !== 'string' || !HIDDEN_MOD_SECTIONS.has(section)) continue;
        byKey.set(`${section}:${entry.id}`, { ...entry, section });
    }
    return [...byKey.values()];
}

/** The three NSFW keys that `nsfwContentMode` replaced. */
interface LegacyNsfwSettings {
    hideNsfwPreviews?: boolean;
    browseNsfwContentMode?: NsfwContentMode;
    installedHideNsfwPreviews?: boolean;
}

/** Collapse the old Browse mode and the old blur toggle into one mode, keeping
 *  whichever was stricter so nobody starts seeing content they had covered. */
function migrateNsfwContentMode(
    browseMode: NsfwContentMode | undefined,
    blur: boolean | undefined,
): NsfwContentMode {
    if (browseMode === 'hide') return 'hide';
    return (browseMode ?? 'show') === 'show' && blur === false ? 'show' : 'blur';
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
        const {
            hideNsfwPreviews,
            browseNsfwContentMode,
            installedHideNsfwPreviews,
            ...settings
        } = JSON.parse(content) as Partial<AppSettings> & LegacyNsfwSettings;
        return {
            ...DEFAULT_SETTINGS,
            ...settings,
            hiddenCreators: normalizeHiddenCreators(settings.hiddenCreators),
            hiddenMods: normalizeHiddenMods(settings.hiddenMods),
            nsfwContentMode:
                settings.nsfwContentMode ??
                migrateNsfwContentMode(browseNsfwContentMode, installedHideNsfwPreviews ?? hideNsfwPreviews),
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
