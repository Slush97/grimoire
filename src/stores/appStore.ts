import { create } from 'zustand';
import type { Mod, AppSettings } from '../types/mod';
import { getActiveDeadlockPath } from '../lib/appSettings';
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
export type BrowseViewMode = 'grid' | 'compact' | 'list';
export interface BrowseUiState {
  search: string;
  viewMode: BrowseViewMode;
  sort: BrowseSortOption;
  section: string;
  // 'none' is a Sound-only pseudo-hero: "show me sound mods whose title
  // doesn't resolve to any known hero" (item sounds, UI, music, etc.).
  // For Mod section it collapses to 'all' since every Skin lives under a hero.
  heroCategoryId: number | 'all' | 'none';
  categoryId: number | 'all';
}

// viewMode + sort behave like preferences (the user mentioned wanting their
// "list vs blocks" choice remembered). Cache them in localStorage so they
// survive app restarts. The rest of BrowseUiState is session-only — search
// queries and filters shouldn't follow the user across launches.
const VIEW_MODE_KEY = 'browseViewMode';
const SORT_KEY = 'browseSort';

const VIEW_MODES: BrowseViewMode[] = ['grid', 'compact', 'list'];
const SORT_OPTIONS: BrowseSortOption[] = ['default', 'popular', 'recent', 'updated', 'views', 'name'];

function readPersistedViewMode(): BrowseViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored && (VIEW_MODES as string[]).includes(stored)) {
      return stored as BrowseViewMode;
    }
  } catch {
    // localStorage may be unavailable (e.g. SSR, restricted contexts).
  }
  return 'grid';
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
  viewMode: readPersistedViewMode(),
  sort: readPersistedSort(),
  section: 'Mod',
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
  modsLoading: boolean;
  modsError: string | null;

  // Download counts cache (mod id -> { downloadCount, timestamp })
  downloadCountsCache: Map<number, CacheEntry<number>>;

  // Global sound preview volume (0-1)
  soundVolume: number;

  // Browse-page UI state (preserved across page nav)
  browseUi: BrowseUiState;

  // Cached fetched mods + scroll position so the Browse tab resumes where
  // the user left it instead of refetching + scrolling to top.
  browseSession: BrowseSessionCache | null;

  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  detectDeadlock: () => Promise<string | null>;
  /** Reload the installed-mods list from the main process.
   *  Pass `{ silent: true }` to refresh without toggling `modsLoading`,
   *  so background refreshes (e.g. on window focus) don't replace the
   *  page with the loading skeleton. */
  loadMods: (opts?: { silent?: boolean }) => Promise<void>;
  toggleMod: (modId: string) => Promise<void>;
  deleteMod: (modId: string) => Promise<void>;
  setModPriority: (modId: string, priority: number) => Promise<void>;
  swapModPriority: (modIdA: string, modIdB: string) => Promise<void>;
  reorderMods: (orderedFileNames: string[]) => Promise<void>;
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
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  settings: null,
  settingsLoading: false,
  settingsError: null,
  mods: [],
  modsLoading: false,
  modsError: null,
  downloadCountsCache: new Map(),
  soundVolume: 0.7,
  browseUi: { ...DEFAULT_BROWSE_UI },
  browseSession: null,

  // Load settings from backend
  loadSettings: async () => {
    set({ settingsLoading: true, settingsError: null });
    try {
      const settings = await api.getSettings();
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
      set(silent ? { mods, modsError: null } : { mods, modsLoading: false });
    } catch (err) {
      set(silent ? { modsError: String(err) } : { modsError: String(err), modsLoading: false });
    }
  },

  // Toggle mod enabled/disabled
  toggleMod: async (modId: string) => {
    const mod = get().mods.find((m) => m.id === modId);
    if (!mod) return;

    try {
      const updatedMod = mod.enabled
        ? await api.disableMod(modId)
        : await api.enableMod(modId);

      set({
        mods: get().mods.map((m) => (m.id === modId ? updatedMod : m)),
      });
    } catch (err) {
      set({ modsError: String(err) });
    }
  },

  // Delete a mod
  deleteMod: async (modId: string) => {
    try {
      await api.deleteMod(modId);
      set({ mods: get().mods.filter((m) => m.id !== modId) });
    } catch (err) {
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
      set({ modsError: String(err) });
      get().loadMods();
    }
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
      set({ modsError: String(err) });
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
  // a time without restating the rest. viewMode + sort also mirror to
  // localStorage so they persist across app restarts.
  setBrowseUi: (partial: Partial<BrowseUiState>) => {
    set({ browseUi: { ...get().browseUi, ...partial } });
    try {
      if (partial.viewMode !== undefined) {
        localStorage.setItem(VIEW_MODE_KEY, partial.viewMode);
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
}));

