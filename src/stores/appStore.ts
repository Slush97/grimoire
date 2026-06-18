import { create } from 'zustand';
import type { Mod, AppSettings, EditLocalModArgs, GlobalModType } from '../types/mod';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { setDateFormat } from '../lib/dateFormat';
import { applyLanguagePreference } from '../i18n';
import * as api from '../lib/api';

// Cache entry with timestamp for TTL support
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

// TTL for download counts cache (1 hour in ms)
const DOWNLOAD_COUNTS_TTL = 60 * 60 * 1000;

// Monotonic generation guard for the mods list. loadMods claims a generation
// before its (async) scan and only writes if it's still current; mutations that
// replace the list (e.g. custom-mod import) bump it. This stops a slow silent
// reload — notably the focus refresh fired when the OS file picker closes — from
// resolving late and clobbering a just-completed mutation with a stale scan
// (the "added a custom mod but can't act on it until I refresh" bug).
let modsGeneration = 0;

// Reuse existing Mod object (and array) identities when a rescan returns
// unchanged data. Silent refreshes fire on every Installed mount and on
// window focus; without this each one replaced the whole list, and every
// downstream effect keyed on `mods` re-fired, re-rendering the full card
// grid several times per navigation. Items are compared by JSON since both
// sides come through the same IPC serializer (stable shape and key order).
function reconcileMods(prev: Mod[], next: Mod[]): Mod[] {
  const prevById = new Map(prev.map((m) => [m.id, m]));
  let unchanged = prev.length === next.length;
  const merged = next.map((m, i) => {
    const old = prevById.get(m.id);
    if (old && JSON.stringify(old) === JSON.stringify(m)) {
      if (unchanged && prev[i] !== old) unchanged = false;
      return old;
    }
    unchanged = false;
    return m;
  });
  return unchanged ? prev : merged;
}

// Browse-page UI state. Kept in the store (not local component state) so it
// survives navigation away from /browse and back — user complaint: search
// query, view mode, and filters all reset when switching pages.
export type BrowseSortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';
export type BrowseLayout = 'grid' | 'list';
export type BrowseNsfwFilter = 'all' | 'sfw' | 'nsfw';

export type BrowseTimeRange = 'all' | 'today' | 'week' | 'month' | 'custom';
export interface BrowseUiState {
  search: string;
  layout: BrowseLayout;
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
  // Artist mode: when set, the grid lists only this submitter's mods
  // (GameBanana Generic_Submitter filter) and Browse shows an artist banner.
  // Session-only; carries display fields so the banner needs no extra fetch.
  submitter?: BrowseArtistRef;
}

export interface BrowseArtistRef {
  id: number;
  name: string;
  avatarUrl?: string;
  profileUrl?: string;
  kofiUrl?: string;
}

// layout + sort behave like preferences. Cache them in localStorage so they
// survive app restarts. The rest of BrowseUiState is session-only: search
// queries and filters shouldn't follow across launches.
const LAYOUT_KEY = 'browseLayout';
const SORT_KEY = 'browseSort';
const SOUND_VOLUME_KEY = 'grimoire:sound-preview-volume';
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

function readPersistedSoundVolume(): number {
  try {
    const raw = localStorage.getItem(SOUND_VOLUME_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
    }
  } catch {
    // localStorage may be unavailable.
  }
  return 0.7;
}

const DEFAULT_BROWSE_UI: BrowseUiState = {
  search: '',
  layout: readPersistedLayout(),
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
  previewAudioPlaying: boolean;

  // Browse-page UI state (preserved across page nav)
  browseUi: BrowseUiState;

  // Cached fetched mods + scroll position so the Browse tab resumes where
  // the user left it instead of refetching + scrolling to top.
  browseSession: BrowseSessionCache | null;

  // Installed-page scroll position. Kept in memory so returning from another
  // tab can restore the page without persisting UI session state to disk.
  installedScrollTop: number;

  // Display name of the hero currently open in the Locker (e.g. "Abrams"), or
  // null. Published by the Locker page and read by DiscordPresence so Rich
  // Presence can show the viewed hero. Renderer-only, never persisted.
  lockerHeroName: string | null;

  // Issue #208: per-mod (per-skin) Locker view images (display override).
  // Map is { skinKey -> data URL }, loaded lazily when the Locker opens. Keyed
  // by getLockerSkinKey(mod). A skin without an entry falls back to its
  // GameBanana thumbnail; a hero card falls back to the hero render.
  lockerModImages: Record<string, string>;

  // Per-skin "hide the hero name label" flags for the Locker image override.
  // Map is { skinKey -> true } (sparse: only hidden skins are present), loaded
  // alongside lockerModImages. Used when the art already shows the hero's name.
  lockerHideHeroName: Record<string, boolean>;

  // Issue #208: per-skin hero-detail backdrop images (framed to 16:9). Map is
  // { skinKey -> data URL }. Independent of the card image; a skin without an
  // entry falls back to the hero render in the focus view.
  lockerModBackgrounds: Record<string, string>;

  // Per-skin "hide the hero name logo" flags for the focus-view backdrop, the
  // backdrop counterpart of lockerHideHeroName. Sparse { skinKey -> true }.
  lockerBgHideHeroName: Record<string, boolean>;

  // Per-skin grid thumbnail images (framed 3:4) for the main Locker hero-grid
  // card. Map is { skinKey -> data URL }. Independent of the card image; the
  // grid card falls back to the card image, then the hero render.
  lockerModThumbnails: Record<string, string>;

  // Per-skin "hide the hero name label" flags for the grid thumbnail, the
  // thumbnail counterpart of lockerHideHeroName. Sparse { skinKey -> true }.
  lockerThumbHideHeroName: Record<string, boolean>;

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
  reorderMods: (orderedIds: string[]) => Promise<void>;
  editLocalMod: (modId: string, args: EditLocalModArgs) => Promise<void>;
  setModLockerHero: (modId: string, heroName: string | null) => Promise<void>;
  setModGlobalType: (modId: string, globalType: GlobalModType | null) => Promise<void>;
  setVariantLabel: (modId: string, label: string) => Promise<void>;
  importCustomMod: (args: { vpkPath: string; name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;

  // Download counts cache actions
  getDownloadCount: (modId: number) => number | undefined;
  setDownloadCount: (modId: number, count: number) => void;
  isDownloadCountStale: (modId: number) => boolean;

  // Sound volume
  setSoundVolume: (volume: number) => void;
  setPreviewAudioPlaying: (playing: boolean) => void;

  // Browse UI state
  setBrowseUi: (partial: Partial<BrowseUiState>) => void;
  resetBrowseUi: () => void;

  // Browse session cache (loaded mods + scroll position)
  setBrowseSession: (cache: BrowseSessionCache | null) => void;
  setInstalledScrollTop: (scrollTop: number) => void;
  setLockerHeroName: (name: string | null) => void;
  loadLockerModImages: () => Promise<void>;
  /** `source` is a `data:` URL (custom upload) or an `http(s)` gallery URL. */
  setLockerModImage: (skinKey: string, source: string) => Promise<void>;
  removeLockerModImage: (skinKey: string) => Promise<void>;
  /** Hide (or show) the hero name label for this skin's Locker card. */
  setLockerModImageHideName: (skinKey: string, hide: boolean) => Promise<void>;
  setLockerModBackground: (skinKey: string, source: string) => Promise<void>;
  removeLockerModBackground: (skinKey: string) => Promise<void>;
  /** Hide (or show) the hero name logo over this skin's focus-view backdrop. */
  setLockerModBackgroundHideName: (skinKey: string, hide: boolean) => Promise<void>;
  setLockerModThumbnail: (skinKey: string, source: string) => Promise<void>;
  removeLockerModThumbnail: (skinKey: string) => Promise<void>;
  /** Hide (or show) the hero name label over this skin's grid thumbnail. */
  setLockerModThumbnailHideName: (skinKey: string, hide: boolean) => Promise<void>;
}

// The main process throws this exact phrase from every "out of enabled slots"
// path (enable, reorder/compact, local import, merge). We surface it as a
// transient toast instead of the full-page modsError screen. Match on the
// cap-agnostic tail so a future MAX_ADDON_FOLDERS bump doesn't break detection.
const ENABLE_CAP_NOTICE =
  'You can have at most 990 mods enabled at once. Disable one to make room.';
const isEnableCapError = (err: unknown): boolean => /mods enabled at once/.test(String(err));

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
  soundVolume: readPersistedSoundVolume(),
  previewAudioPlaying: false,
  browseUi: { ...DEFAULT_BROWSE_UI },
  browseSession: null,
  installedScrollTop: 0,
  lockerHeroName: null,
  lockerModImages: {},
  lockerHideHeroName: {},
  lockerModBackgrounds: {},
  lockerBgHideHeroName: {},
  lockerModThumbnails: {},
  lockerThumbHideHeroName: {},

  // Load settings from backend
  loadSettings: async () => {
    set({ settingsLoading: true, settingsError: null });
    try {
      const settings = await api.getSettings();
      setDateFormat(settings.dateFormat);
      applyLanguagePreference(settings.language);
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
      applyLanguagePreference(settings.language);
      set({ settings, settingsLoading: false });
      // Reload mods if path changed
      if (getActiveDeadlockPath(settings)) {
        get().loadMods();
      }
    } catch (err) {
      set({ settingsError: String(err), settingsLoading: false });
    }
  },

  // Issue #208: per-mod (per-skin) Locker view image overrides (display only).
  loadLockerModImages: async () => {
    try {
      const [images, flags, backgrounds, bgFlags, thumbnails, thumbFlags] = await Promise.all([
        api.getLockerModImages(),
        api.getLockerModImageFlags(),
        api.getLockerModBackgrounds(),
        api.getLockerModBackgroundFlags(),
        api.getLockerModThumbnails(),
        api.getLockerModThumbnailFlags(),
      ]);
      set({
        lockerModImages: images,
        lockerHideHeroName: flags,
        lockerModBackgrounds: backgrounds,
        lockerBgHideHeroName: bgFlags,
        lockerModThumbnails: thumbnails,
        lockerThumbHideHeroName: thumbFlags,
      });
    } catch {
      // Non-fatal: skins just fall back to their GameBanana thumbnail.
    }
  },
  setLockerModImage: async (skinKey: string, source: string) => {
    const dataUrl = await api.setLockerModImage(skinKey, source);
    set((state) => ({
      lockerModImages: { ...state.lockerModImages, [skinKey]: dataUrl },
    }));
  },
  removeLockerModImage: async (skinKey: string) => {
    await api.removeLockerModImage(skinKey);
    set((state) => {
      const next = { ...state.lockerModImages };
      delete next[skinKey];
      // The flag is metadata about the image; removing one clears the other.
      const nextFlags = { ...state.lockerHideHeroName };
      delete nextFlags[skinKey];
      return { lockerModImages: next, lockerHideHeroName: nextFlags };
    });
  },
  setLockerModImageHideName: async (skinKey: string, hide: boolean) => {
    await api.setLockerModImageHideName(skinKey, hide);
    set((state) => {
      const nextFlags = { ...state.lockerHideHeroName };
      if (hide) nextFlags[skinKey] = true;
      else delete nextFlags[skinKey];
      return { lockerHideHeroName: nextFlags };
    });
  },
  setLockerModBackground: async (skinKey: string, source: string) => {
    const dataUrl = await api.setLockerModBackground(skinKey, source);
    set((state) => ({
      lockerModBackgrounds: { ...state.lockerModBackgrounds, [skinKey]: dataUrl },
    }));
  },
  removeLockerModBackground: async (skinKey: string) => {
    await api.removeLockerModBackground(skinKey);
    set((state) => {
      const next = { ...state.lockerModBackgrounds };
      delete next[skinKey];
      // The flag is metadata about the backdrop; removing one clears the other.
      const nextFlags = { ...state.lockerBgHideHeroName };
      delete nextFlags[skinKey];
      return { lockerModBackgrounds: next, lockerBgHideHeroName: nextFlags };
    });
  },
  setLockerModBackgroundHideName: async (skinKey: string, hide: boolean) => {
    await api.setLockerModBackgroundHideName(skinKey, hide);
    set((state) => {
      const nextFlags = { ...state.lockerBgHideHeroName };
      if (hide) nextFlags[skinKey] = true;
      else delete nextFlags[skinKey];
      return { lockerBgHideHeroName: nextFlags };
    });
  },
  setLockerModThumbnail: async (skinKey: string, source: string) => {
    const dataUrl = await api.setLockerModThumbnail(skinKey, source);
    set((state) => ({
      lockerModThumbnails: { ...state.lockerModThumbnails, [skinKey]: dataUrl },
    }));
  },
  removeLockerModThumbnail: async (skinKey: string) => {
    await api.removeLockerModThumbnail(skinKey);
    set((state) => {
      const next = { ...state.lockerModThumbnails };
      delete next[skinKey];
      // The flag is metadata about the thumbnail; removing one clears the other.
      const nextFlags = { ...state.lockerThumbHideHeroName };
      delete nextFlags[skinKey];
      return { lockerModThumbnails: next, lockerThumbHideHeroName: nextFlags };
    });
  },
  setLockerModThumbnailHideName: async (skinKey: string, hide: boolean) => {
    await api.setLockerModThumbnailHideName(skinKey, hide);
    set((state) => {
      const nextFlags = { ...state.lockerThumbHideHeroName };
      if (hide) nextFlags[skinKey] = true;
      else delete nextFlags[skinKey];
      return { lockerThumbHideHeroName: nextFlags };
    });
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
    const gen = ++modsGeneration;
    if (!silent) set({ modsLoading: true, modsError: null });
    try {
      const scanned = await api.getMods();
      if (gen === modsGeneration) {
        const mods = reconcileMods(get().mods, scanned);
        set(silent ? { mods, modsLoaded: true, modsError: null } : { mods, modsLoaded: true, modsLoading: false });
      } else if (!silent) {
        // Superseded by a newer load/mutation: drop the stale list, but still
        // clear our own spinner so the page doesn't hang on it.
        set({ modsLoading: false });
      }
    } catch (err) {
      if (gen === modsGeneration) {
        set(silent ? { modsError: String(err) } : { modsError: String(err), modsLoading: false });
      } else if (!silent) {
        set({ modsLoading: false });
      }
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

  // Reorder mods via drag-and-drop. Accepts the target enabled-list order as mod ids.
  // Rolls back to a fresh scan on error so the UI can't desync from disk.
  reorderMods: async (orderedIds: string[]) => {
    try {
      const updated = await api.reorderMods(orderedIds);
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

  setModGlobalType: async (modId: string, globalType: GlobalModType | null) => {
    const updated = await api.setModGlobalType(modId, globalType);
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
      // Bump the generation so any in-flight silent reload (e.g. the focus
      // refresh from the just-closed file picker) can't overwrite this with a
      // scan taken before the new VPK landed.
      modsGeneration++;
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
    const next = Math.max(0, Math.min(1, volume));
    set({ soundVolume: next });
    try {
      localStorage.setItem(SOUND_VOLUME_KEY, String(next));
    } catch {
      // localStorage may be unavailable.
    }
  },

  setPreviewAudioPlaying: (playing: boolean) => {
    set({ previewAudioPlaying: playing });
  },

  // Patch Browse UI state. Use a partial so callers can update one field at
  // a time without restating the rest. layout + sort also mirror to
  // localStorage so they persist across app restarts.
  setBrowseUi: (partial: Partial<BrowseUiState>) => {
    set({ browseUi: { ...get().browseUi, ...partial } });
    try {
      if (partial.layout !== undefined) {
        localStorage.setItem(LAYOUT_KEY, partial.layout);
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

  setLockerHeroName: (name: string | null) => {
    set({ lockerHeroName: name });
  },
}));
