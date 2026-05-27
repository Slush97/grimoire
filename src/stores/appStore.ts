import { create } from 'zustand';
import type { Mod, AppSettings, EditLocalModArgs } from '../types/mod';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { setDateFormat } from '../lib/dateFormat';
import * as api from '../lib/api';

// Cache entry with timestamp for TTL support
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

// TTL for download counts cache (1 hour in ms)
const DOWNLOAD_COUNTS_TTL = 60 * 60 * 1000;

// Browse-page UI state. Kept in the store (not local component state) so it
// survives navigation away from /browse and back — user complaint: search
// query, view mode, and filters all reset when switching pages.
export type BrowseSortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';
export type BrowseLayout = 'grid' | 'list';
export type BrowseNsfwFilter = 'all' | 'sfw' | 'nsfw';

// Browse card-size slider bounds (grid column min-width, in px). The slider
// replaced the old fixed Grid/Compact/Dense presets: one continuous control
// over how wide each card gets, with the layout reflowing columns to fit.
// Below BROWSE_COMPACT_CARD_THRESHOLD cards drop to the leaner "compact"
// chrome (4:3 aspect, smaller text), so small sizes stay readable.
export const BROWSE_CARD_SIZE_MIN = 140;
export const BROWSE_CARD_SIZE_MAX = 340;
export const BROWSE_CARD_SIZE_DEFAULT = 300;
export const BROWSE_COMPACT_CARD_THRESHOLD = 250;
export type BrowseTimeRange = 'all' | 'today' | 'week' | 'month' | 'custom';
export interface BrowseUiState {
  search: string;
  layout: BrowseLayout;
  cardSize: number;
  sort: BrowseSortOption;
  section: string;
  // Content-rating filter and recency window. Both route browsing through the
  // local catalog mirror (see useLocalSearch in Browse.tsx). addedFrom/addedTo
  // are 'YYYY-MM-DD' inputs used only when addedWithin === 'custom'.
  nsfw: BrowseNsfwFilter;
  addedWithin: BrowseTimeRange;
  addedFrom: string;
  addedTo: string;
  // 'none' is a Sound-only pseudo-hero: "show me sound mods whose title
  // doesn't resolve to any known hero" (item sounds, UI, music, etc.).
  // For Mod section it collapses to 'all' since every Skin lives under a hero.
  heroCategoryId: number | 'all' | 'none';
  categoryId: number | 'all';
}

// layout + cardSize + sort behave like preferences (the user mentioned wanting
// their "list vs blocks" choice and card size remembered). Cache them in
// localStorage so they survive app restarts. The rest of BrowseUiState is
// session-only — search queries and filters shouldn't follow across launches.
const LAYOUT_KEY = 'browseLayout';
const CARD_SIZE_KEY = 'browseCardSize';
const SORT_KEY = 'browseSort';
// Pre-slider key holding 'grid' | 'compact' | 'dense' | 'list'. Read once for
// migration so existing users keep a comparable layout and card size.
const LEGACY_VIEW_MODE_KEY = 'browseViewMode';

const SORT_OPTIONS: BrowseSortOption[] = ['default', 'popular', 'recent', 'updated', 'views', 'name'];

function readPersistedLayout(): BrowseLayout {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (stored === 'grid' || stored === 'list') return stored;
    // Migrate from the old four-mode key: only 'list' carried structure.
    if (localStorage.getItem(LEGACY_VIEW_MODE_KEY) === 'list') return 'list';
  } catch {
    // localStorage may be unavailable (e.g. SSR, restricted contexts).
  }
  return 'grid';
}

function readPersistedCardSize(): number {
  try {
    const raw = localStorage.getItem(CARD_SIZE_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        return Math.min(BROWSE_CARD_SIZE_MAX, Math.max(BROWSE_CARD_SIZE_MIN, n));
      }
    }
    // Migrate the old density presets to comparable card widths.
    switch (localStorage.getItem(LEGACY_VIEW_MODE_KEY)) {
      case 'dense':
        return 150;
      case 'compact':
        return 200;
    }
  } catch {
    // localStorage may be unavailable.
  }
  return BROWSE_CARD_SIZE_DEFAULT;
}

function readPersistedSort(): BrowseSortOption {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored && (SORT_OPTIONS as string[]).includes(stored)) {
      return stored as BrowseSortOption;
    }
  } catch {
    // ignore
  }
  return 'default';
}

const DEFAULT_BROWSE_UI: BrowseUiState = {
  search: '',
  layout: readPersistedLayout(),
  cardSize: readPersistedCardSize(),
  sort: readPersistedSort(),
  section: 'Mod',
  nsfw: 'all',
  addedWithin: 'all',
  addedFrom: '',
  addedTo: '',
  heroCategoryId: 'all',
  categoryId: 'all',
};

// Cached page state: lets the Browse tab resume exactly where the user left
// it (same loaded mods, same page count, same scroll position) when they
// navigate away and back. In-memory only — we don't persist this across app
// restarts because a stale list of mods could be misleading on next launch.
//
// Import shape from gamebanana types is awkward to wire here, so the cache
// stores opaque `unknown` and Browse.tsx asserts the type at the boundary.
export interface BrowseSessionCache {
  mods: unknown[];
  page: number;
  hasMore: boolean;
  totalCount: number;
  scrollTop: number;
  /** Stamp of the filter state these mods belong to. If any filter changes
   *  while Browse is unmounted (impossible today, but defensive), we'll
   *  refetch instead of restoring stale results. */
  stamp: string;
}

interface AppState {
  // Settings
  settings: AppSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;

  // Mods
  mods: Mod[];
  modsLoaded: boolean;
  modsLoading: boolean;
  modsError: string | null;
  // Non-fatal, transient message (e.g. hitting the 99-enabled cap). Shown as a
  // toast rather than replacing the page the way modsError does.
  modsNotice: string | null;

  // Download counts cache (mod id -> { downloadCount, timestamp })
  downloadCountsCache: Map<number, CacheEntry<number>>;

  // Global sound preview volume (0-1)
  soundVolume: number;

  // Browse-page UI state (preserved across page nav)
  browseUi: BrowseUiState;

  // Cached fetched mods + scroll position so the Browse tab resumes where
  // the user left it instead of refetching + scrolling to top.
  browseSession: BrowseSessionCache | null;

  // Installed-page scroll position. Kept in memory so returning from another
  // tab can restore the page without persisting UI session state to disk.
  installedScrollTop: number;

  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  detectDeadlock: () => Promise<string | null>;
  /** Reload the installed-mods list from the main process.
   *  Pass `{ silent: true }` to refresh without toggling `modsLoading`,
   *  so background refreshes (e.g. on window focus) don't replace the
   *  page with the loading skeleton. */
  loadMods: (opts?: { silent?: boolean }) => Promise<void>;
  /** Returns false when the toggle was blocked (e.g. the 99-enabled cap), so
   *  batch callers can stop early. */
  toggleMod: (modId: string) => Promise<boolean>;
  clearModsNotice: () => void;
  deleteMod: (modId: string) => Promise<void>;
  setModPriority: (modId: string, priority: number) => Promise<void>;
  swapModPriority: (modIdA: string, modIdB: string) => Promise<void>;
  reorderMods: (orderedFileNames: string[]) => Promise<void>;
  editLocalMod: (modId: string, args: EditLocalModArgs) => Promise<void>;
  setModLockerHero: (modId: string, heroName: string | null) => Promise<void>;
  setVariantLabel: (modId: string, label: string) => Promise<void>;
  importCustomMod: (args: { vpkPath: string; name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;

  // Download counts cache actions
  getDownloadCount: (modId: number) => number | undefined;
  setDownloadCount: (modId: number, count: number) => void;
  isDownloadCountStale: (modId: number) => boolean;

  // Sound volume
  setSoundVolume: (volume: number) => void;

  // Browse UI state
  setBrowseUi: (partial: Partial<BrowseUiState>) => void;
  resetBrowseUi: () => void;

  // Browse session cache (loaded mods + scroll position)
  setBrowseSession: (cache: BrowseSessionCache | null) => void;
  setInstalledScrollTop: (scrollTop: number) => void;
}

// The main process throws this exact phrase from every "can't add a 100th
// active mod" path (enable, reorder/compact, local import, merge). We surface
// it as a transient toast instead of the full-page modsError screen.
const ENABLE_CAP_NOTICE =
  'You can have at most 99 mods enabled at once. Disable one to make room.';
const isEnableCapError = (err: unknown): boolean => /99 mods enabled/.test(String(err));

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  settings: null,
  settingsLoading: false,
  settingsError: null,
  mods: [],
  modsLoaded: false,
  modsLoading: false,
  modsError: null,
  modsNotice: null,
  downloadCountsCache: new Map(),
  soundVolume: 0.7,
  browseUi: { ...DEFAULT_BROWSE_UI },
  browseSession: null,
  installedScrollTop: 0,

  // Load settings from backend
  loadSettings: async () => {
    set({ settingsLoading: true, settingsError: null });
    try {
      const settings = await api.getSettings();
      setDateFormat(settings.dateFormat);
      set({ settings, settingsLoading: false });
    } catch (err) {
      set({ settingsError: String(err), settingsLoading: false });
    }
  },

  // Save settings to backend
  saveSettings: async (settings: AppSettings) => {
    set({ settingsLoading: true, settingsError: null });
    try {
      await api.setSettings(settings);
      setDateFormat(settings.dateFormat);
      set({ settings, settingsLoading: false });
      // Reload mods if path changed
      if (getActiveDeadlockPath(settings)) {
        get().loadMods();
      }
    } catch (err) {
      set({ settingsError: String(err), settingsLoading: false });
    }
  },

  // Auto-detect Deadlock installation
  detectDeadlock: async () => {
    try {
      return await api.detectDeadlock();
    } catch {
      return null;
    }
  },

  // Load mods from backend.
  // Silent refreshes (window focus, etc.) skip the loading flag so the UI
  // doesn't flash the skeleton over already-rendered content.
  loadMods: async (opts) => {
    const silent = !!opts?.silent;
    if (!silent) set({ modsLoading: true, modsError: null });
    try {
      const mods = await api.getMods();
      set(silent ? { mods, modsLoaded: true, modsError: null } : { mods, modsLoaded: true, modsLoading: false });
    } catch (err) {
      set(silent ? { modsError: String(err) } : { modsError: String(err), modsLoading: false });
    }
  },

  // Toggle mod enabled/disabled
  toggleMod: async (modId: string) => {
    const mod = get().mods.find((m) => m.id === modId);
    if (!mod) return false;

    try {
      const updatedMod = mod.enabled
        ? await api.disableMod(modId)
        : await api.enableMod(modId);

      set({
        mods: get().mods.map((m) => (m.id === modId ? updatedMod : m)),
      });
      return true;
    } catch (err) {
      // The 99-enabled cap is an expected, recoverable outcome - surface it as
      // a transient notice (toast) instead of the full-page modsError screen.
      if (isEnableCapError(err)) {
        set({ modsNotice: ENABLE_CAP_NOTICE });
        return false;
      }
      set({ modsError: String(err) });
      return false;
    }
  },

  clearModsNotice: () => set({ modsNotice: null }),

  // Delete a mod.
  // "Mod not found" is treated as idempotent success: the file is already
  // gone (most often because scanMods' reconcile pass renamed a colliding
  // pakNN file between the renderer's last load and this delete), so the
  // desired end state is already reached. Surfacing it as modsError would
  // replace the whole Installed page with the full-page error screen,
  // which is especially bad mid-batch in bulk delete.
  deleteMod: async (modId: string) => {
    try {
      await api.deleteMod(modId);
      set({ mods: get().mods.filter((m) => m.id !== modId) });
    } catch (err) {
      if (/Mod not found/.test(String(err))) {
        set({ mods: get().mods.filter((m) => m.id !== modId) });
        return;
      }
      set({ modsError: String(err) });
    }
  },

  // Set mod priority
  setModPriority: async (modId: string, priority: number) => {
    try {
      const updatedMod = await api.setModPriority(modId, priority);
      set({
        mods: get()
          .mods.map((m) => (m.id === modId ? updatedMod : m))
          .sort((a, b) => a.priority - b.priority),
      });
    } catch (err) {
      set({ modsError: String(err) });
    }
  },

  // Swap the priority of two mods (mod IDs change after rename, so we replace the full list)
  swapModPriority: async (modIdA: string, modIdB: string) => {
    try {
      const updated = await api.swapModPriority(modIdA, modIdB);
      set({ mods: updated });
    } catch (err) {
      if (isEnableCapError(err)) { set({ modsNotice: ENABLE_CAP_NOTICE }); return; }
      set({ modsError: String(err) });
    }
  },

  // Reorder mods via drag-and-drop. Accepts the target enabled-list order as filenames.
  // Rolls back to a fresh scan on error so the UI can't desync from disk.
  reorderMods: async (orderedFileNames: string[]) => {
    try {
      const updated = await api.reorderMods(orderedFileNames);
      set({ mods: updated });
    } catch (err) {
      if (isEnableCapError(err)) { set({ modsNotice: ENABLE_CAP_NOTICE }); }
      else { set({ modsError: String(err) }); }
      get().loadMods();
    }
  },

  editLocalMod: async (modId: string, args: EditLocalModArgs) => {
    const updated = await api.editLocalMod(modId, args);
    set({
      mods: get().mods.map((m) => (m.id === modId ? updated : m)),
    });
  },

  setModLockerHero: async (modId: string, heroName: string | null) => {
    const updated = await api.setModLockerHero(modId, heroName);
    set({
      mods: get().mods.map((m) => (m.id === modId ? updated : m)),
    });
  },

  setVariantLabel: async (modId: string, label: string) => {
    try {
      const updated = await api.setVariantLabel(modId, label);
      set({
        mods: get().mods.map((m) => (m.id === modId ? updated : m)),
      });
    } catch (err) {
      set({ modsError: String(err) });
    }
  },

  importCustomMod: async (args) => {
    try {
      const updated = await api.importCustomMod(args);
      set({ mods: updated });
    } catch (err) {
      // At the 99-active cap, importing (which lands enabled) can't claim a
      // slot. Toast it rather than blanking the page; still rethrow so the
      // import dialog knows it failed.
      if (isEnableCapError(err)) { set({ modsNotice: ENABLE_CAP_NOTICE }); }
      else { set({ modsError: String(err) }); }
      throw err;
    }
  },

  // Get download count from cache (returns undefined if not cached or stale)
  getDownloadCount: (modId: number) => {
    const entry = get().downloadCountsCache.get(modId);
    if (!entry) return undefined;
    // Return undefined if stale (will trigger refetch)
    if (Date.now() - entry.timestamp > DOWNLOAD_COUNTS_TTL) return undefined;
    return entry.value;
  },

  // Set download count in cache with current timestamp
  setDownloadCount: (modId: number, count: number) => {
    const newCache = new Map(get().downloadCountsCache);
    newCache.set(modId, { value: count, timestamp: Date.now() });
    set({ downloadCountsCache: newCache });
  },

  // Check if a cached download count is stale
  isDownloadCountStale: (modId: number) => {
    const entry = get().downloadCountsCache.get(modId);
    if (!entry) return true;
    return Date.now() - entry.timestamp > DOWNLOAD_COUNTS_TTL;
  },

  // Set global sound preview volume
  setSoundVolume: (volume: number) => {
    set({ soundVolume: Math.max(0, Math.min(1, volume)) });
  },

  // Patch Browse UI state. Use a partial so callers can update one field at
  // a time without restating the rest. layout + cardSize + sort also mirror to
  // localStorage so they persist across app restarts.
  setBrowseUi: (partial: Partial<BrowseUiState>) => {
    set({ browseUi: { ...get().browseUi, ...partial } });
    try {
      if (partial.layout !== undefined) {
        localStorage.setItem(LAYOUT_KEY, partial.layout);
      }
      if (partial.cardSize !== undefined) {
        localStorage.setItem(CARD_SIZE_KEY, String(partial.cardSize));
      }
      if (partial.sort !== undefined) {
        localStorage.setItem(SORT_KEY, partial.sort);
      }
    } catch {
      // localStorage write may fail (quota, restricted context); state still
      // updates in memory so the user's current session works.
    }
  },

  resetBrowseUi: () => {
    set({ browseUi: { ...DEFAULT_BROWSE_UI } });
  },

  setBrowseSession: (cache: BrowseSessionCache | null) => {
    set({ browseSession: cache });
  },

  setInstalledScrollTop: (scrollTop: number) => {
    set({ installedScrollTop: Math.max(0, scrollTop) });
  },
}));

