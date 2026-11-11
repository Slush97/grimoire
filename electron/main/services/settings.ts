import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync } from 'fs';
import { dirname } from 'path';
import { getSettingsPath } from '../utils/paths';

// AppSettings is single-sourced in src/types/mod.ts (type-only import:
// erased at build, so no renderer code is pulled into the main bundle).
// Re-exported so existing `from './settings'` imports keep working.
import type { AppSettings, NsfwContentMode } from '../../../src/types/mod';
import { DEFAULT_THEME, normalizeTheme } from '../../../src/lib/theme';
import { MAX_CUSTOM_SWATCHES } from '../../../src/lib/customSwatches';
export type { AppSettings };

const DEFAULT_SETTINGS: AppSettings = {
    updateChannel: 'stable',
    autoCheckAppUpdates: true,
    deadlockPath: null,
    lastDialogDirectory: null,
    devMode: false,
    devDeadlockPath: null,
    nsfwContentMode: 'blur',
    revealNsfwOnHover: false,
    browseAlwaysShowNsfwTag: false,
    hideOutdatedMods: false,
    hiddenCreators: [],
    hiddenMods: [],
    lockerCardsExpandedByDefault: false,
    installedGroupClickOpensDetails: false,
    autoDisableSiblingVariants: true,
    autoMatchRemainingFiles: true,
    skipModReplacementConfirmation: false,
    swapManualReplacementActions: true,
    keepModBackups: false,
    autoEnableDownloads: false,
    steamLaunchOptions: '',
    steamLaunchOptionsManaged: false,
    activeProfileId: null,
    confirmProfileUpdate: true,
    promptOptionalRequirements: false,
    experimentalStats: false,
    experimentalCrosshair: false,
    experimentalSocial: false,
    experimentalUnknownModMatching: false,
    experimentalVpkImprinting: false,
    experimentalModSafety: false,
    experimentalHideoutDefault: false,
    hasCompletedSetup: false,
    ignoredConflicts: [],
    ignoreConflictsByDefault: false,
    ignoredConflictFiles: {},
    ignoredConflictFilesGlobal: [],
    ignoredConflictMods: [],
    accentColor: '#f97316',
    theme: DEFAULT_THEME,
    customAccentColors: [],
    sidebarHeroHighlight: 'Abrams',
    dateFormat: 'MM/DD/YYYY',
    language: null,
    zoomFactor: 1,
    discordRpcEnabled: false,
    contributeMatchSalts: false,
    unifiedLaunchButton: false,
    sidebarTransparent: false,
    backgroundGradient: null,
    customBackgroundGradients: [],
    verboseModTrace: false,
    forgeLocalInstallEnabled: false,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The user's own accent swatches from user-editable settings.json: hex colors
 *  only, no repeats, the newest few. */
function normalizeCustomAccentColors(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const colors: string[] = [];
    for (const candidate of value) {
        if (typeof candidate !== 'string' || !HEX_COLOR.test(candidate)) continue;
        const color = candidate.toLowerCase();
        if (!colors.includes(color)) colors.push(color);
    }
    return colors.slice(-MAX_CUSTOM_SWATCHES);
}

/** Same for the user's own background glows, each a pair of hex colors. */
function normalizeCustomBackgroundGradients(value: unknown): { from: string; to: string }[] {
    if (!Array.isArray(value)) return [];
    const gradients: { from: string; to: string }[] = [];
    for (const candidate of value) {
        const { from, to } = (candidate ?? {}) as { from?: unknown; to?: unknown };
        if (typeof from !== 'string' || typeof to !== 'string' || !HEX_COLOR.test(from) || !HEX_COLOR.test(to)) continue;
        const gradient = { from: from.toLowerCase(), to: to.toLowerCase() };
        if (!gradients.some((entry) => entry.from === gradient.from && entry.to === gradient.to)) gradients.push(gradient);
    }
    return gradients.slice(-MAX_CUSTOM_SWATCHES);
}

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

/** The OLED toggle that `theme` replaced. */
interface LegacyThemeSettings {
    oledMode?: boolean;
}

interface SettingsCacheEntry {
    path: string;
    mtimeMs: number;
    ctimeMs: number;
    size: number;
    ino: number;
    settings: AppSettings;
}

// Metadata lookups also load settings to choose the normal/dev sidecar. Check
// the file fingerprint, but only read, parse and normalize changed settings.
// Callers receive a copy so unsaved edits cannot change the cached preferences.
let settingsCache: SettingsCacheEntry | null = null;

/**
 * Load settings from disk
 * If settings are corrupted, resets to defaults and logs warning (P2 fix #21)
 */
function readSettings(): AppSettings {
    const path = getSettingsPath();

    try {
        const stat = statSync(path, { throwIfNoEntry: false });
        if (!stat) {
            settingsCache = null;
            return DEFAULT_SETTINGS;
        }
        if (settingsCache && settingsCache.path === path &&
            settingsCache.mtimeMs === stat.mtimeMs && settingsCache.ctimeMs === stat.ctimeMs &&
            settingsCache.size === stat.size && settingsCache.ino === stat.ino) {
            return settingsCache.settings;
        }
        const content = readFileSync(path, 'utf-8');
        const {
            hideNsfwPreviews,
            browseNsfwContentMode,
            installedHideNsfwPreviews,
            oledMode,
            ...settings
        } = JSON.parse(content) as Partial<AppSettings> & LegacyNsfwSettings & LegacyThemeSettings;
        const normalized: AppSettings = {
            ...DEFAULT_SETTINGS,
            ...settings,
            updateChannel: settings.updateChannel === 'nightly' ? 'nightly' : 'stable',
            theme: normalizeTheme(settings.theme, oledMode),
            hiddenCreators: normalizeHiddenCreators(settings.hiddenCreators),
            customAccentColors: normalizeCustomAccentColors(settings.customAccentColors),
            customBackgroundGradients: normalizeCustomBackgroundGradients(settings.customBackgroundGradients),
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
        settingsCache = {
            path, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size, ino: stat.ino,
            settings: normalized,
        };
        return normalized;
    } catch (error) {
        settingsCache = null;
        console.warn('[Settings] Failed to load settings, resetting to defaults:', error);
        return DEFAULT_SETTINGS;
    }
}

export function loadSettings(): AppSettings {
    return structuredClone(readSettings());
}

/** The per-mod metadata hot path only needs this primitive, not a settings copy. */
export function isDevModeEnabled(): boolean {
    return readSettings().devMode;
}

/**
 * The Deadlock path IPC handlers should act on: the dev dummy path when dev
 * mode is active, otherwise the user's configured install. Single-sourced
 * here; IPC modules import it instead of keeping local copies.
 * Accepts pending settings so callers can compare paths before saving them.
 */
export function getActiveDeadlockPath(settings: AppSettings = loadSettings()): string | null {
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
    // Invalidate before I/O, including failed writes. Never retain edits that
    // have not been persisted, or skip normalization after a successful save.
    settingsCache = null;
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
