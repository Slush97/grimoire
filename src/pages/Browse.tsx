import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Loader2,
  Download,
  Eye,
  ThumbsUp,
  X,
  Volume2,
  RefreshCw,
  LayoutGrid,
  Grid3x3,
  Grip,
  List,
  AlertTriangle,
  Clock,
  Package,
  Music,
  SlidersHorizontal,
  Power,
  Library,
  ChevronDown,
  Upload,
} from 'lucide-react';
import {
  browseMods,
  getModDetails,
  downloadMod,
  getGamebananaSections,
  getGamebananaCategories,
  backfillGameBananaFileId,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import type {
  GameBananaMod,
  GameBananaModDetails,
  GameBananaSection,
  GameBananaCategoryNode,
} from '../types/gamebanana';
import { getModThumbnail, getSoundPreviewUrl, getPrimaryFile, formatDate, isModOutdated } from '../types/gamebanana';
import { useAppStore } from '../stores/appStore';
import type { BrowseNsfwFilter, BrowseTimeRange } from '../stores/appStore';
import ModThumbnail from '../components/ModThumbnail';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import { DynamicSelect } from '../components/common/DynamicSelect';
import { HeroSelect } from '../components/common/HeroSelect';
import { Button, Tag } from '../components/common/ui';
import { EmptyState } from '../components/common/PageComponents';
import ModDetailsModal from '../components/ModDetailsModal';
import ImportCollectionModal from '../components/ImportCollectionModal';
import ImportProfileDialog from '../components/profiles/ImportProfileDialog';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition } from '../lib/lockerUtils';

const DEFAULT_PER_PAGE = 20;
type SortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';
type ViewMode = 'grid' | 'compact' | 'dense' | 'list';
const SECTION_WHITELIST = new Set(['Mod', 'Sound']);
// Persist filter UI inputs across page navigation. The store keeps these in
// memory so visiting Installed and coming back doesn't blow away the user's
// current search/filter context. Kept out of localStorage so a fresh launch
// starts clean — sessions, not preferences.

type CategoryOption = {
  id: number;
  label: string;
  itemCount: number;
};

type FlattenOptions = {
  excludeIds?: Set<number>;
  includeEmpty?: boolean;
};

function flattenCategories(
  nodes: GameBananaCategoryNode[],
  parentPath = '',
  options: FlattenOptions = {}
): CategoryOption[] {
  const results: CategoryOption[] = [];
  const excludeIds = options.excludeIds ?? new Set<number>();
  const includeEmpty = options.includeEmpty ?? false;

  for (const node of nodes) {
    if (excludeIds.has(node.id)) {
      continue;
    }

    const nextPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (includeEmpty || node.itemCount > 0) {
      results.push({ id: node.id, label: nextPath, itemCount: node.itemCount });
    }

    if (node.children && node.children.length > 0) {
      results.push(...flattenCategories(node.children, nextPath, options));
    }
  }

  return results;
}

// Abbreviate counts (1234 -> 1.2k, 98765 -> 99k). Falsy/non-finite inputs
// render as "0" — without this, undefined slips past every `<` check
// (NaN comparisons are always false) and falls through to the millions
// branch, producing "NaNm" on mods with no recorded likes/views/downloads.
function formatCount(n: number | null | undefined): string {
  if (!Number.isFinite(n) || (n as number) <= 0) return '0';
  const value = n as number;
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

// Treat Enter/Space as a click on role="button" divs (keyboard navigation).
function handleCardKeyDown(e: React.KeyboardEvent, onClick: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onClick();
  }
}

// Render an error string with any embedded https:// URLs as clickable links.
function renderErrorWithLinks(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer noopener"
          className="underline text-accent hover:text-accent-hover"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function findCategoryByName(
  nodes: GameBananaCategoryNode[],
  name: string
): GameBananaCategoryNode | null {
  for (const node of nodes) {
    if (node.name.toLowerCase() === name.toLowerCase()) {
      return node;
    }
    if (node.children) {
      const match = findCategoryByName(node.children, name);
      if (match) return match;
    }
  }
  return null;
}

export default function Browse() {
  const { settings, loadSettings, loadMods, mods: installedMods, soundVolume, setSoundVolume, browseUi, setBrowseUi } = useAppStore();
  const browseSession = useAppStore((s) => s.browseSession);
  const setBrowseSession = useAppStore((s) => s.setBrowseSession);
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  // Filter inputs are mirrored from the store so they survive page nav.
  // `setBrowseUi({...})` is the write path; reads come straight from `browseUi`.
  const { search, viewMode, sort, section, nsfw, addedWithin, addedFrom, addedTo, heroCategoryId, categoryId } = browseUi;
  const setSearch = useCallback((v: string) => setBrowseUi({ search: v }), [setBrowseUi]);
  const setViewMode = useCallback((v: ViewMode) => setBrowseUi({ viewMode: v }), [setBrowseUi]);
  const setSort = useCallback((v: SortOption) => setBrowseUi({ sort: v }), [setBrowseUi]);
  const setSection = useCallback((v: string) => setBrowseUi({ section: v }), [setBrowseUi]);
  const setNsfw = useCallback((v: BrowseNsfwFilter) => setBrowseUi({ nsfw: v }), [setBrowseUi]);
  const setAddedWithin = useCallback((v: BrowseTimeRange) => setBrowseUi({ addedWithin: v }), [setBrowseUi]);
  const setAddedFrom = useCallback((v: string) => setBrowseUi({ addedFrom: v }), [setBrowseUi]);
  const setAddedTo = useCallback((v: string) => setBrowseUi({ addedTo: v }), [setBrowseUi]);
  const setHeroCategoryId = useCallback((v: number | 'all' | 'none') => setBrowseUi({ heroCategoryId: v }), [setBrowseUi]);
  const setCategoryId = useCallback((v: number | 'all') => setBrowseUi({ categoryId: v }), [setBrowseUi]);

  // Hydrate from session cache on mount so navigating away + back doesn't
  // wipe loaded results or scroll position. The cache stamp encodes current
  // filters; if filters changed in between (impossible today since they only
  // change on Browse, but defensive) we ignore the stale cache.
  const initialFilterStamp = `${browseUi.section}|${browseUi.search}|${browseUi.sort}|${browseUi.categoryId}|${browseUi.heroCategoryId}`;
  const initialCache = browseSession && browseSession.stamp === initialFilterStamp
    ? browseSession
    : null;

  const [mods, setMods] = useState<GameBananaMod[]>(
    () => (initialCache?.mods as GameBananaMod[] | undefined) ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => initialCache?.page ?? 1);
  const [_totalCount, setTotalCount] = useState(() => initialCache?.totalCount ?? 0);
  const perPage = DEFAULT_PER_PAGE; // Fixed value for infinite scroll
  const [sections, setSections] = useState<GameBananaSection[]>([]);
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>([]);
  // Hero list comes from the Mod section's category tree (Mod -> Skins -> heroes).
  // Cached separately so hero filtering still works on the Sound tab, where the
  // current section's category tree has no Skins parent.
  const [modCategories, setModCategories] = useState<GameBananaCategoryNode[]>([]);
  const [selectedMod, setSelectedMod] = useState<GameBananaModDetails | null>(null);
  const [selectedModDates, setSelectedModDates] = useState<{ dateAdded: number; dateModified: number } | null>(null);
  const [downloading, setDownloading] = useState<{ modId: number; fileId: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => initialCache?.hasMore ?? true);
  // A page>1 (or stale-results) fetch failure routes here instead of `error`
  // so the already-loaded grid stays on screen and only the load-more row
  // surfaces the failure. `error` stays reserved for the no-results case.
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Set when a browse fetch fails. Freezes the infinite-scroll observer so it
  // stops auto-advancing the page into an API that's already refusing requests.
  // Without this, a rate-limited fetch + auto-retry looped, flashing the grid
  // between results and the error state (issue #99). Lifted on filter change,
  // refresh, or an explicit retry.
  const [autoLoadPaused, setAutoLoadPaused] = useState(false);

  // Last fetch's identity stamp. Value-comparison gate: if the next call to
  // fetchMods/searchLocal would target the same (page + filters), skip it.
  // Initialized from the session cache so hydrated state isn't re-fetched.
  // Value-based (not "skip first run" ref) so it survives React StrictMode's
  // double effect run in dev — the second setup compares stamps and short-
  // circuits, instead of consuming a one-shot skip flag.
  const lastFetchedStampRef = useRef<string | null>(
    initialCache ? `${initialCache.page}|${browseUi.search}|${browseUi.sort}|${browseUi.section}|${browseUi.categoryId}|${browseUi.heroCategoryId}` : null
  );
  // Cached scroll position waiting to be applied once the grid is mounted
  // and laid out. Cleared after restoration.
  const pendingScrollTopRef = useRef<number | null>(initialCache?.scrollTop ?? null);
  // The outer scroll container — same element with `h-full overflow-y-auto`.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Live mirror of the scroll container's scrollTop. Updated from a scroll
  // listener so the unmount cleanup has a valid value to persist — by the
  // time a useEffect cleanup runs, React has already detached
  // `scrollContainerRef.current`, so reading scrollTop from the DOM ref
  // there always returned 0 and the saved position was useless.
  const latestScrollTopRef = useRef<number>(initialCache?.scrollTop ?? 0);
  // When local search fails (e.g. SQLite error), this flips so the main fetch
  // effect falls back to the API path. Resets whenever filter inputs change.
  const [localSearchFailed, setLocalSearchFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [downloadQueue, setDownloadQueue] = useState<Array<{ modId: number; fileId: number; fileName: string }>>([]);
  const [playingModId, setPlayingModId] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [importProfileOpen, setImportProfileOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);

  // Load settings on mount (needed for hideNsfwPreviews)
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Close the filters popover on outside click or Escape
  useEffect(() => {
    if (!filtersOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  // Close the import menu on outside click or Escape.
  useEffect(() => {
    if (!importMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImportMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [importMenuOpen]);

  // Check if local cache is available for search
  const [hasLocalCache, setHasLocalCache] = useState(false);
  useEffect(() => {
    const checkLocalCache = async () => {
      try {
        const count = await window.electronAPI.getLocalModCount();
        setHasLocalCache(count > 100);
      } catch {
        setHasLocalCache(false);
      }
    };
    checkLocalCache();
  }, []);

  // Fetch initial download queue state on mount
  useEffect(() => {
    const fetchInitialQueueState = async () => {
      try {
        const [queue, currentDownload] = await Promise.all([
          window.electronAPI.getDownloadQueue(),
          window.electronAPI.getCurrentDownload(),
        ]);
        setDownloadQueue(queue);
        if (currentDownload) {
          setDownloading({ modId: currentDownload.modId, fileId: currentDownload.fileId });
        }
      } catch (err) {
        console.error('Failed to fetch initial queue state:', err);
      }
    };
    fetchInitialQueueState();
  }, []);

  // 'none' = client-side post-filter for Sound mods without a hero in the
  // title. The fetch path sees it as "no category filter" so the API doesn't
  // get a nonsense id; the actual exclusion happens against displayMods.
  const effectiveCategoryId =
    heroCategoryId === 'all' || heroCategoryId === 'none'
      ? (categoryId === 'all' ? undefined : categoryId)
      : heroCategoryId;

  // Debounce the search input: every keystroke previously fired a full FTS5
  // query + count + render, which felt slow even when the DB was fast. 250ms
  // is short enough that typing-to-results still feels responsive but long
  // enough to absorb fast typing into a single request.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const effectiveSearch = debouncedSearch;

  // Custom-range date inputs (YYYY-MM-DD) -> inclusive Unix-second bounds for the
  // local query. Parsed as UTC to line up with date_added (a UTC timestamp).
  // Undefined when not in custom mode, blank, or unparseable.
  const customAddedFrom = useMemo(() => {
    if (addedWithin !== 'custom' || !addedFrom) return undefined;
    const t = Date.parse(`${addedFrom}T00:00:00Z`);
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }, [addedWithin, addedFrom]);
  const customAddedTo = useMemo(() => {
    if (addedWithin !== 'custom' || !addedTo) return undefined;
    const t = Date.parse(`${addedTo}T23:59:59Z`);
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }, [addedWithin, addedTo]);

  // Keep a fresh `mods` reference outside the fetch closures so they can check
  // "did the user already have results visible?" without making `mods` a
  // useCallback dep (that would self-trigger). Also doubles as the source
  // for the unmount-time cache save.
  const modsRef = useRef<GameBananaMod[]>(mods);
  const pageRef = useRef<number>(page);
  const hasMoreRef = useRef<boolean>(hasMore);
  const totalCountRef = useRef<number>(_totalCount);
  useEffect(() => {
    modsRef.current = mods;
  }, [mods]);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    totalCountRef.current = _totalCount;
  }, [_totalCount]);

  // Restore cached scroll position once the first paint with hydrated mods
  // is on screen. useLayoutEffect (not useEffect) so we scroll before the
  // browser paints, avoiding a visible jump from 0 to the saved offset.
  useLayoutEffect(() => {
    const target = pendingScrollTopRef.current;
    if (target === null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = target;
    pendingScrollTopRef.current = null;
  }, []);

  // Mirror scrollTop into a ref on every scroll. The unmount cleanup below
  // runs as a passive effect — by then React has already nulled
  // `scrollContainerRef.current`, so we can't read scrollTop off the DOM
  // there. The ref gives us the last-known value to persist instead.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      latestScrollTopRef.current = container.scrollTop;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Persist session cache on unmount so navigating back resumes exactly
  // where the user left off. Refs feed the cleanup with current values
  // since the closure captures at first render.
  useEffect(() => {
    return () => {
      const ui = useAppStore.getState().browseUi;
      const stamp = `${ui.section}|${ui.search}|${ui.sort}|${ui.categoryId}|${ui.heroCategoryId}`;
      const cachedMods = modsRef.current;
      // Don't cache an empty state — would just bypass the next fetch
      // unhelpfully. Clear instead so the next mount starts fresh.
      if (cachedMods.length === 0) {
        setBrowseSession(null);
        return;
      }
      // Read scrollTop from the live mirror — `scrollContainerRef.current` is
      // already null here (React detaches DOM refs before passive cleanups).
      const scrollTop = latestScrollTopRef.current;
      setBrowseSession({
        mods: cachedMods,
        page: pageRef.current,
        hasMore: hasMoreRef.current,
        totalCount: totalCountRef.current,
        scrollTop,
        stamp,
      });
    };
  }, [setBrowseSession]);

  // Derived (not state) so the right code path runs in the same render the
  // user picks a hero/types a query. Storing it in useState lagged a render,
  // which caused fetchMods (API, no hero filter) to race with searchLocal and
  // overwrite real results with an empty API response.
  const useLocalSearch = useMemo(() => {
    const hasSearchQuery = debouncedSearch.trim().length > 0;
    const hasHeroFilter = heroCategoryId !== 'all';
    // NSFW and recency filters only the local catalog mirror can satisfy: the
    // live API enriches NSFW after the fact and doesn't window by date, so route
    // those through local search (the cache is a full mirror of the index).
    const hasContentFilter = nsfw !== 'all' || addedWithin !== 'all';
    return (hasSearchQuery || hasHeroFilter || hasContentFilter) && hasLocalCache && !localSearchFailed;
  }, [debouncedSearch, heroCategoryId, nsfw, addedWithin, hasLocalCache, localSearchFailed]);

  // Reset the failure flag whenever the user changes filters so a one-off
  // backend error doesn't permanently disable local search.
  useEffect(() => {
    setLocalSearchFailed(false);
  }, [debouncedSearch, heroCategoryId, nsfw, addedWithin, section]);

  const fetchMods = useCallback(async () => {
    // Don't fetch from API if we're using local search
    if (useLocalSearch) return;
    // Value-compare gate: skip when we'd be re-fetching the exact same state
    // we already loaded. Covers cache hydration on mount AND React
    // StrictMode's double-effect setup. Set BEFORE the network call so
    // a second setup hitting this line sees the stamp and returns.
    const stamp = `${page}|${effectiveSearch}|${sort}|${section}|${effectiveCategoryId}|${heroCategoryId}|${nsfw}|${addedWithin}|${customAddedFrom ?? ''}|${customAddedTo ?? ''}`;
    if (lastFetchedStampRef.current === stamp) return;
    lastFetchedStampRef.current = stamp;

    // On a fresh load (no results yet) show the skeleton; on a refetch keep
    // the stale list visible and just surface a soft progress indicator so
    // each keystroke doesn't repaint the whole grid as gray boxes.
    if (page === 1) {
      const hadResults = modsRef.current.length > 0;
      if (hadResults) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const response = await browseMods(
        page,
        perPage,
        effectiveSearch || undefined,
        section,
        effectiveCategoryId,
        sort !== 'default' ? sort : undefined
      );

      // Enrich results with cached NSFW status from local database
      // The API doesn't reliably return NSFW flags in list responses
      let enrichedRecords = response.records;
      if (response.records.length > 0) {
        try {
          const ids = response.records.map(m => m.id);
          const nsfwStatus = await window.electronAPI.getModsNsfwStatus(ids);
          enrichedRecords = response.records.map(mod => ({
            ...mod,
            nsfw: nsfwStatus[mod.id] ?? mod.nsfw ?? false,
          }));
        } catch (enrichErr) {
          // If enrichment fails, continue with original data
          console.warn('Failed to enrich NSFW status from cache:', enrichErr);
        }
      }

      // Append results for infinite scroll
      if (page === 1) {
        setMods(enrichedRecords);
      } else {
        setMods(prev => [...prev, ...enrichedRecords]);
      }
      setTotalCount(response.totalCount);
      setHasMore(response.records.length === perPage && page * perPage < response.totalCount);
    } catch (err) {
      const message = String(err);
      // Keep any already-loaded results on screen: route the failure to the
      // inline load-more row rather than `error`, which would blank the whole
      // grid. Only a truly empty list falls back to the full-page error state.
      if (modsRef.current.length > 0) {
        setLoadMoreError(message);
      } else {
        setError(message);
      }
      // Stop the observer from auto-retrying against an API that just refused.
      setAutoLoadPaused(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [
    page,
    effectiveSearch,
    sort,
    section,
    perPage,
    effectiveCategoryId,
    heroCategoryId,
    nsfw,
    addedWithin,
    customAddedFrom,
    customAddedTo,
    useLocalSearch,
  ]);

  // Local search function using SQLite cache
  const searchLocal = useCallback(async () => {
    // Same value-compare gate as fetchMods so the shared stamp prevents
    // re-fetching cached state and survives StrictMode double-mount.
    const stamp = `${page}|${effectiveSearch}|${sort}|${section}|${effectiveCategoryId}|${heroCategoryId}|${nsfw}|${addedWithin}|${customAddedFrom ?? ''}|${customAddedTo ?? ''}`;
    if (lastFetchedStampRef.current === stamp) return;
    lastFetchedStampRef.current = stamp;
    // Same anti-flash logic as fetchMods: skeleton only on truly empty first
    // load. Subsequent refetches keep the previous result set visible until
    // the new one arrives.
    if (page === 1) {
      const hadResults = modsRef.current.length > 0;
      if (hadResults) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const sortMap: Record<SortOption, 'relevance' | 'likes' | 'date' | 'date_added' | 'views' | 'name'> = {
        default: 'relevance',
        popular: 'likes',
        recent: 'date_added',
        updated: 'date',
        views: 'views',
        name: 'name',
      };

      // Hero list lives under Mod -> Skins, but we want the filter to work on
      // any section (Sound mods include the hero name in the title), so always
      // resolve the hero from the Mod-category tree.
      const skinsCat = findCategoryByName(modCategories, 'Skins');
      const selectedHeroName = heroCategoryId !== 'all' && skinsCat?.children
        ? skinsCat.children.find(c => c.id === heroCategoryId)?.name
        : undefined;

      const result = await window.electronAPI.searchLocalMods({
        query: effectiveSearch.trim() || undefined,
        section: section,
        categoryId: effectiveCategoryId,
        // Enhanced hero search: pass hero name and skins parent ID
        heroName: selectedHeroName,
        skinsCategoryId: skinsCat?.id,
        sortBy: sortMap[sort] || 'relevance',
        nsfw,
        addedWithin,
        addedFrom: customAddedFrom,
        addedTo: customAddedTo,
        limit: perPage,
        offset: (page - 1) * perPage,
      });

      // Convert CachedMod to GameBananaMod format
      const convertedMods: GameBananaMod[] = result.mods.map(m => ({
        id: m.id,
        name: m.name,
        profileUrl: m.profileUrl,
        dateAdded: m.dateAdded,
        dateModified: m.dateModified,
        hasFiles: m.hasFiles,
        likeCount: m.likeCount,
        viewCount: m.viewCount,
        nsfw: m.isNsfw,
        rootCategory: m.categoryId ? { id: m.categoryId, name: m.categoryName || '' } : undefined,
        submitter: m.submitterName ? { id: m.submitterId || 0, name: m.submitterName } : undefined,
        previewMedia: (() => {
          let images: { baseUrl: string; file: string; file530: string }[] | undefined;
          if (m.thumbnailUrl) {
            const lastSlash = m.thumbnailUrl.lastIndexOf('/');
            if (lastSlash !== -1) {
              const baseUrl = m.thumbnailUrl.substring(0, lastSlash);
              const file = m.thumbnailUrl.substring(lastSlash + 1);
              if (baseUrl && file) {
                images = [{ baseUrl, file, file530: file }];
              }
            }
          }
          const metadata = m.audioUrl ? { audioUrl: m.audioUrl } : undefined;
          if (!images && !metadata) return undefined;
          return { images, metadata };
        })(),
      }));

      if (page === 1) {
        setMods(convertedMods);
      } else {
        setMods(prev => [...prev, ...convertedMods]);
      }
      setTotalCount(result.totalCount);
      setHasMore(convertedMods.length === perPage && page * perPage < result.totalCount);
    } catch (err) {
      console.error('Local search failed, falling back to API:', err);
      setLocalSearchFailed(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [page, effectiveSearch, section, sort, perPage, effectiveCategoryId, heroCategoryId, nsfw, addedWithin, customAddedFrom, customAddedTo, modCategories]);

  // Value-compare gate for the filter-reset: remember what filters last
  // triggered a reset; only reset when the new combination is actually
  // different. This survives both initial cache hydration and React
  // StrictMode's double-effect run (the second setup sees the same stamp
  // and short-circuits, instead of consuming a one-shot skip flag).
  const lastResetFiltersRef = useRef<string | null>(
    `${debouncedSearch}|${sort}|${section}|${effectiveCategoryId}|${nsfw}|${addedWithin}|${customAddedFrom ?? ''}|${customAddedTo ?? ''}|${perPage}`
  );
  useEffect(() => {
    const current = `${debouncedSearch}|${sort}|${section}|${effectiveCategoryId}|${nsfw}|${addedWithin}|${customAddedFrom ?? ''}|${customAddedTo ?? ''}|${perPage}`;
    if (lastResetFiltersRef.current === current) return;
    lastResetFiltersRef.current = current;
    // Reset pagination when filters change but keep previous results visible
    // until the new query lands. Blanking mods here is what produced the
    // skeleton flash on every keystroke pre-debounce.
    setPage(1);
    setHasMore(true);
    // New filters: drop any prior load-more failure and re-enable
    // auto-pagination for the fresh result set.
    setLoadMoreError(null);
    setAutoLoadPaused(false);
  }, [debouncedSearch, sort, section, effectiveCategoryId, nsfw, addedWithin, customAddedFrom, customAddedTo, perPage]);

  useEffect(() => {
    let active = true;
    getGamebananaCategories('ModCategory')
      .then((data) => {
        if (active) setModCategories(data);
      })
      .catch(() => {
        // Hero filter just won't be available; not fatal.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadSections = async () => {
      try {
        const data = await getGamebananaSections();
        const filtered = data.filter((entry) => SECTION_WHITELIST.has(entry.modelName));
        if (!active) return;
        if (filtered.length === 0) {
          setSections([{ pluralTitle: 'Mods', modelName: 'Mod', categoryModelName: 'ModCategory', itemCount: 0 }]);
          return;
        }
        setSections(filtered);
        if (!filtered.some((entry) => entry.modelName === section)) {
          setSection(filtered[0].modelName);
        }
      } catch (err) {
        if (active) {
          setError(String(err));
        }
      }
    };

    loadSections();

    return () => {
      active = false;
    };
    // Run once on mount: section selection is read inside but we don't want
    // refires on every tab switch (that would re-fetch the section list
    // unnecessarily). setSection is stable from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether `section` actually changed (vs. the effect just firing on
  // mount because deps populated for the first time). Without this guard the
  // hero/category filters were reset to 'all' on every remount, which then
  // triggered a refetch and threw away the cached scroll position.
  const lastLoadedSectionRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const selected = sections.find((entry) => entry.modelName === section);
    if (!selected) {
      setCategories([]);
      return () => {
        active = false;
      };
    }

    const sectionChanged = lastLoadedSectionRef.current !== null && lastLoadedSectionRef.current !== section;
    lastLoadedSectionRef.current = section;

    const loadCategories = async () => {
      try {
        const data = await getGamebananaCategories(selected.categoryModelName);
        if (!active) return;
        setCategories(data);
        // Only reset the hero/category filter when the user actually
        // switched sections — not on every remount.
        if (sectionChanged) {
          setHeroCategoryId('all');
          setCategoryId('all');
        }
      } catch (err) {
        if (active) {
          setError(String(err));
        }
      }
    };

    loadCategories();

    return () => {
      active = false;
    };
  }, [sections, section, setCategoryId, setHeroCategoryId]);

  useEffect(() => {
    if (useLocalSearch) {
      searchLocal();
    } else {
      fetchMods();
    }
  }, [fetchMods, searchLocal, useLocalSearch, refreshKey]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
  }, [activeDeadlockPath, loadMods]);

  useEffect(() => {
    const progressUnsub = window.electronAPI.onDownloadProgress((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setDownloadProgress({
          downloaded: data.downloaded,
          total: data.total,
        });
      }
    });

    const extractingUnsub = window.electronAPI.onDownloadExtracting((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setExtracting(true);
      }
    });

    const completeUnsub = window.electronAPI.onDownloadComplete((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
        loadMods(); // Refresh installed mods
      }
    });

    const errorUnsub = window.electronAPI.onDownloadError((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
        const fullMessage =
          data.helpUrl && !data.message.includes(data.helpUrl)
            ? `${data.message} ${data.helpUrl}`
            : data.message;
        setError(fullMessage);
      }
    });

    const queueUnsub = window.electronAPI.onDownloadQueueUpdated((data) => {
      setDownloadQueue(data.queue);
      // Sync local downloading state with backend - this is the source of truth
      if (data.currentDownload) {
        setDownloading({ modId: data.currentDownload.modId, fileId: data.currentDownload.fileId });
      } else {
        // Only clear if we don't have a current download from backend
        // Don't clear during race conditions - let the complete event handle that
      }
    });

    return () => {
      progressUnsub();
      extractingUnsub();
      completeUnsub();
      errorUnsub();
      queueUnsub();
    };
  }, [downloading, loadMods]);

  // Infinite scroll observer
  // Infinite scroll observer
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Load more when reaching bottom and not already loading. autoLoadPaused
        // gates this after a fetch failure so a refusing API isn't hammered in a
        // loop (the sentinel re-enters view when the grid shrinks).
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore && !autoLoadPaused) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loading, loadingMore, autoLoadPaused]);

  // Background fetch download counts for visible mods (using global cache with TTL)
  // DISABLED: This makes N API calls per page load which is very slow and risks rate limiting.
  // Download counts are now only fetched when the modal is opened (via handleModClick).
  // To re-enable, uncomment the useEffect below.
  /*
  useEffect(() => {
    if (mods.length === 0) return;
    let cancelled = false;

    // Find mods that don't have download counts cached (or are stale)
    const missingMods = mods.filter((mod) => getDownloadCount(mod.id) === undefined);
    if (missingMods.length === 0) return;

    // Fetch in batches to avoid rate limiting
    const fetchBatch = async (batch: typeof missingMods) => {
      for (const mod of batch) {
        if (cancelled) return;
        try {
          const details = await getModDetails(mod.id, section);
          if (cancelled) return;
          // Sum download counts across all files
          const totalDownloads = details.files?.reduce((sum, f) => sum + (f.downloadCount || 0), 0) ?? 0;
          setDownloadCount(mod.id, totalDownloads);
        } catch {
          // Ignore errors silently
        }
        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    // Fetch up to first 10 mods immediately
    fetchBatch(missingMods.slice(0, 10));

    return () => {
      cancelled = true;
    };
  }, [mods, section, getDownloadCount, setDownloadCount]);
  */

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      // Sync current section from GameBanana API to local DB
      await window.electronAPI.syncSection(section);
      // Reset state and force re-fetch
      setMods([]);
      setHasMore(true);
      setPage(1);
      setError(null);
      setLoadMoreError(null);
      setAutoLoadPaused(false);
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  };

  // Retry a failed browse fetch (full-page or load-more). Clears the failure
  // flags, lifts the auto-pagination pause, and forces a re-fetch of the
  // current page. The stamp guard would otherwise treat the retry as a
  // duplicate and skip it, so the stamp is cleared too. loadingMore is set
  // up front so the observer can't also advance the page in the same commit.
  const handleRetryFetch = useCallback(() => {
    setError(null);
    setLoadMoreError(null);
    setAutoLoadPaused(false);
    setLoadingMore(true);
    lastFetchedStampRef.current = null;
    setRefreshKey((k) => k + 1);
  }, []);

  const handleModClick = async (mod: GameBananaMod) => {
    try {
      const details = await getModDetails(mod.id, section);
      setSelectedMod(details);
      setSelectedModDates({ dateAdded: mod.dateAdded, dateModified: mod.dateModified });

      // Update the mods array with the correct nsfw flag from details
      // This ensures grid cards show blur after clicking once
      if (details.nsfw !== mod.nsfw) {
        setMods(prev => prev.map(m =>
          m.id === mod.id ? { ...m, nsfw: details.nsfw } : m
        ));

        // Also update the local cache so future browses show correct status
        try {
          await window.electronAPI.updateModNsfw(mod.id, details.nsfw);
        } catch (cacheErr) {
          console.warn('Failed to update NSFW cache:', cacheErr);
        }
      }

      // Cache the download count from mod details (sum across all files)
      if (details.files && details.files.length > 0) {
        const totalDownloads = details.files.reduce((sum, f) => sum + (f.downloadCount || 0), 0);
        try {
          await window.electronAPI.updateModDownloadCount(mod.id, totalDownloads);
          // Update local state so the card shows the count immediately
          setMods(prev => prev.map(m =>
            m.id === mod.id ? { ...m, downloadCount: totalDownloads } : m
          ));
        } catch (cacheErr) {
          console.warn('Failed to cache download count:', cacheErr);
        }
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDownload = async (fileId: number, fileName: string) => {
    if (!selectedMod || !activeDeadlockPath) return;

    // The first file claims the active slot (shows progress); additional clicks
    // queue behind it. The backend's download-queue-updated event is the source
    // of truth for what's queued, so don't clobber the active progress UI here.
    if (!downloading) {
      setDownloading({ modId: selectedMod.id, fileId });
      setDownloadProgress({ downloaded: 0, total: 0 });
      setExtracting(false);
    }

    try {
      await downloadMod(selectedMod.id, fileId, fileName, section, effectiveCategoryId);
    } catch (err) {
      setError(String(err));
      // Reset the active UI only if the file that failed is the active one.
      // Functional update reads fresh state, not this closure's snapshot.
      setDownloading((cur) =>
        cur && cur.modId === selectedMod.id && cur.fileId === fileId ? null : cur
      );
    }
  };

  const handleQuickDownload = async (mod: GameBananaMod) => {
    if (!activeDeadlockPath) return;

    // Check if already downloading or in queue
    if (downloading?.modId === mod.id) return;
    if (downloadQueue.some(q => q.modId === mod.id)) return;

    try {
      // Fetch mod details to get the first file
      const details = await getModDetails(mod.id, section);
      if (!details.files || details.files.length === 0) {
        setError('No downloadable files found');
        return;
      }

      // When a mod has more than one downloadable file (different versions,
      // variant builds, etc.) we used to silently pick whichever had the
      // highest download count. Forum feedback flagged that — surface the
      // details modal so the user can choose which file to install.
      if (details.files.length > 1) {
        setSelectedMod(details);
        setSelectedModDates({ dateAdded: mod.dateAdded, dateModified: mod.dateModified });
        return;
      }

      const file = getPrimaryFile(details.files);

      // If nothing is currently downloading, set this as the active download
      if (!downloading) {
        setDownloading({ modId: mod.id, fileId: file.id });
        setDownloadProgress({ downloaded: 0, total: 0 });
        setExtracting(false);
      }

      await downloadMod(mod.id, file.id, file.fileName, section, effectiveCategoryId);
    } catch (err) {
      setError(String(err));
      // Only clear downloading state if this was the active download
      if (downloading?.modId === mod.id) {
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
      }
    }
  };

  const heroOptions = useMemo(() => {
    const skins = findCategoryByName(modCategories, 'Skins');
    if (!skins?.children) return [];
    return skins.children
      .filter((child) => child.itemCount > 0)
      .map((child) => ({
        id: child.id,
        label: child.name,
      }));
  }, [modCategories]);

  const categoryOptions = useMemo(() => {
    // Per-hero entries under Skins are handled by the dedicated Hero filter, so
    // exclude them here. Everything else (Skins, Model Replacement, HUD,
    // Gameplay Modifications, Maps, Music, Killsounds, ...) becomes a mod-type
    // filter. This surfaces GameBanana's real categories instead of the old
    // hardcoded hud/other-misc/maps allowlist (issue #91).
    const heroIds = new Set(heroOptions.map((hero) => hero.id));
    const flat = flattenCategories(categories, '', { excludeIds: heroIds, includeEmpty: false });

    // GameBanana keeps several legacy duplicate categories that share a name
    // (e.g. multiple "Skins" / "Other/Misc" buckets). Collapse by label and keep
    // the most populated one so the dropdown stays short and points at the
    // canonical category.
    const byLabel = new Map<string, CategoryOption>();
    for (const opt of flat) {
      const key = opt.label.toLowerCase();
      const existing = byLabel.get(key);
      if (!existing || opt.itemCount > existing.itemCount) {
        byLabel.set(key, opt);
      }
    }

    return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [categories, heroOptions]);

  const installedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaId === 'number') {
        ids.add(mod.gameBananaId);
      }
    }
    return ids;
  }, [installedMods]);

  // Per-card lookup so each ModCard knows the local mod's id + enabled state.
  // Drives the inline "Enable" affordance: once a download finishes, the
  // top-right of the card flips from a downloading spinner into either a
  // green ✓ (already enabled) or a yellow Enable pill (still disabled).
  const installedByGbId = useMemo(() => {
    const map = new Map<number, { id: string; enabled: boolean }>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaId !== 'number') continue;
      // If a user has multiple variants of the same GB mod installed, prefer
      // the enabled one — that's the relevant state to show.
      const existing = map.get(mod.gameBananaId);
      if (!existing || (mod.enabled && !existing.enabled)) {
        map.set(mod.gameBananaId, { id: mod.id, enabled: mod.enabled });
      }
    }
    return map;
  }, [installedMods]);

  const toggleMod = useAppStore((state) => state.toggleMod);

  // Track installed file IDs for per-file "Reinstall" button state
  const installedFileIds = useMemo(() => {
    const ids = new Set<number>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaFileId === 'number') {
        ids.add(mod.gameBananaFileId);
      }
    }
    return ids;
  }, [installedMods]);

  // Per-file install map for the details modal. Lets a row that's installed
  // but currently disabled surface an inline "Enable" pill — matches the
  // affordance already on the tile card. If multiple local mods share a
  // file id (rare, e.g. dupe installs), prefer the enabled one as the
  // representative since that's the actionable state.
  const installedFileStates = useMemo(() => {
    const map = new Map<number, { modId: string; enabled: boolean }>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaFileId !== 'number') continue;
      const existing = map.get(mod.gameBananaFileId);
      if (!existing || (mod.enabled && !existing.enabled)) {
        map.set(mod.gameBananaFileId, { modId: mod.id, enabled: mod.enabled });
      }
    }
    return map;
  }, [installedMods]);

  // Heal legacy 1-click installs that pre-date the forward fix. Those variants
  // have the right gameBananaId but no gameBananaFileId, so ModDetailsModal
  // can't recognise the matching file row as installed and the user ends up
  // clicking Install again, creating a duplicate. When the modal opens, try
  // to recover the file id by matching the local sourceFileName against the
  // GB file list; if only one variant lacks an id and only one file row
  // exists on the page, match unambiguously by position. Healed variants
  // become visible to installedFileIds on the next loadMods.
  useEffect(() => {
    if (!selectedMod) return;
    const candidates = installedMods.filter(
      (m) => m.gameBananaId === selectedMod.id && typeof m.gameBananaFileId !== 'number'
    );
    if (candidates.length === 0) return;
    const files = selectedMod.files ?? [];
    if (files.length === 0) return;

    const usedFileIds = new Set<number>();
    for (const m of installedMods) {
      if (m.gameBananaId === selectedMod.id && typeof m.gameBananaFileId === 'number') {
        usedFileIds.add(m.gameBananaFileId);
      }
    }
    const availableFiles = files.filter((f) => !usedFileIds.has(f.id));

    type Match = {
      modId: string;
      payload: { gameBananaFileId: number; fileDescription?: string; sourceFileName?: string };
    };
    const matches: Match[] = [];
    for (const mod of candidates) {
      const source = mod.sourceFileName?.toLowerCase();
      // Skip the placeholder our old 1-click flow used so we don't try to
      // match "gamebanana-mod-1778634670877" against real GB file rows.
      const usableSource = source && !/^gamebanana-mod-\d+$/.test(source) ? source : undefined;
      let matched = usableSource
        ? availableFiles.find(
            (f) => f.fileName.replace(/\.(zip|7z|rar|vpk)$/i, '').toLowerCase() === usableSource
          )
        : undefined;
      if (!matched && candidates.length === 1 && availableFiles.length === 1) {
        matched = availableFiles[0];
      }
      if (matched) {
        const stem = matched.fileName.replace(/\.(zip|7z|rar|vpk)$/i, '').trim();
        matches.push({
          modId: mod.id,
          payload: {
            gameBananaFileId: matched.id,
            fileDescription: matched.description?.trim() || undefined,
            sourceFileName: stem.length > 0 ? stem : undefined,
          },
        });
        usedFileIds.add(matched.id);
      }
    }
    if (matches.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        for (const m of matches) {
          await backfillGameBananaFileId(m.modId, m.payload);
        }
        if (!cancelled) await loadMods();
      } catch (err) {
        console.warn('[Browse] backfill gameBananaFileId failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMod, installedMods, loadMods]);

  // Just use all loaded mods - infinite scroll handles pagination.
  // Hide outdated mods if the user has opted in.
  let displayMods = settings?.hideOutdatedMods
    ? mods.filter((m) => !m.dateModified || !isModOutdated(m.dateModified))
    : mods;
  // "(No hero)" Sound filter — GameBanana Sound categories don't carry hero
  // metadata, so hero association is purely from the title. When the user
  // picks the pseudo-hero "none", drop anything whose title matches a known
  // hero so they see item/UI/music/announcer sounds only.
  if (section === 'Sound' && heroCategoryId === 'none') {
    displayMods = displayMods.filter((m) => inferHeroFromTitle(m.name) === null);
  }

  if (!activeDeadlockPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Search className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Configure Game Path</h2>
        <p className="text-center max-w-md">
          Set your Deadlock installation path in Settings (or enable dev mode) before downloading mods.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" ref={scrollContainerRef}>
      {/* Header with Search */}
      <div className="sticky top-0 z-10 p-4 border-b border-border bg-bg-primary">
        <form onSubmit={handleSearch}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input with integrated submit */}
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mods..."
                className="w-full h-10 bg-bg-secondary border border-border rounded-lg pl-3 pr-16 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {/* Inline spinner while debouncing or refetching with stale results.
                    Replaces the prior whole-grid skeleton flash on every keystroke. */}
                {(search !== debouncedSearch || (loadingMore && page === 1)) && (
                  <Loader2
                    className="w-4 h-4 mx-1 animate-spin text-text-secondary"
                    aria-label="Searching"
                  />
                )}
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); handleSearch(new Event('submit') as unknown as React.FormEvent); }}
                    className="p-1.5 text-text-secondary hover:text-text-primary transition-colors rounded-md hover:bg-bg-tertiary cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  className="p-1.5 text-text-secondary hover:text-accent transition-colors rounded-md hover:bg-bg-tertiary cursor-pointer"
                  title="Search"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Import menu: GameBanana collection or portable profile. */}
            <div className="relative" ref={importMenuRef}>
              <button
                type="button"
                onClick={() => setImportMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={importMenuOpen}
                className="h-10 flex items-center justify-center gap-1 pl-2.5 pr-1.5 bg-bg-secondary hover:bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title="Import"
              >
                <Library className="w-5 h-5" />
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>

              {importMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 z-20 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl p-1 animate-fade-in"
                  role="menu"
                  aria-label="Import"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      setCollectionModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-tertiary rounded-md transition-colors cursor-pointer"
                  >
                    <Library className="w-4 h-4 text-text-secondary shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span>GameBanana Collection</span>
                      <span className="text-[11px] text-text-secondary truncate">Import items from a collection URL</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      setImportProfileOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-tertiary rounded-md transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-text-secondary shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span>Grimoire Profile</span>
                      <span className="text-[11px] text-text-secondary truncate">Share code or .modprofile.json from the Profiles tab</span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Refresh Icon Button */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={syncing}
              className="h-10 w-10 flex items-center justify-center bg-bg-secondary hover:bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              title="Refresh from GameBanana"
            >
              {syncing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5" />
              )}
            </button>

            {/* View Mode Toggle - Icon Only */}
            <div className="flex items-center h-10 rounded-lg border border-border bg-bg-secondary p-1">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'grid'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                  }`}
                title="Grid view"
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('compact')}
                className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === 'compact'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                  }`}
                title="Compact view"
              >
                <Grid3x3 className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('dense')}
                className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === 'dense'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                  }`}
                title="Dense view"
              >
                <Grip className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === 'list'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                  }`}
                title="List view"
              >
                <List className="w-5 h-5" />
              </button>
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-border" />

            {/* Section toggle — Mods vs Sounds as icon buttons */}
            {sections.length > 1 && (
              <div className="flex items-center h-10 rounded-lg border border-border bg-bg-secondary p-1" role="tablist" aria-label="Section">
                {sections.map((entry) => {
                  const Icon = entry.modelName === 'Sound' ? Music : Package;
                  const active = section === entry.modelName;
                  return (
                    <button
                      key={entry.modelName}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSection(entry.modelName)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                        active
                          ? 'bg-bg-tertiary text-text-primary'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                      title={entry.pluralTitle}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-sm">{entry.pluralTitle}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Global Volume Slider - visible when Sound section is selected */}
            {section === 'Sound' && (
              <div className="flex items-center h-10 gap-2 px-3 bg-bg-secondary border border-border rounded-lg">
                <Volume2 className="w-4 h-4 text-text-secondary flex-shrink-0" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(soundVolume * 100)}
                  onChange={(e) => setSoundVolume(parseInt(e.target.value) / 100)}
                  className="w-24 h-1.5 bg-bg-primary rounded-full appearance-none cursor-pointer accent-accent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
                  title={`Volume: ${Math.round(soundVolume * 100)}%`}
                />
                <span className="text-xs text-text-secondary tabular-nums w-8">{Math.round(soundVolume * 100)}%</span>
              </div>
            )}

            <DynamicSelect
              value={sort}
              onChange={(val) => setSort(val as SortOption)}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'popular', label: 'Popularity' },
                { value: 'recent', label: 'Recently Added' },
                { value: 'updated', label: 'Recently Updated' },
                { value: 'views', label: 'Most Viewed' },
                { value: 'name', label: 'Name (A–Z)' },
              ]}
            />

            {/* Filters popover — houses hero + category selectors. Collapses two
                always-visible dropdowns into one control with an active-count badge. */}
            {(heroOptions.length > 0 || categoryOptions.length > 0 || hasLocalCache) && (() => {
              const filterCount =
                (heroCategoryId !== 'all' ? 1 : 0) +
                (categoryId !== 'all' ? 1 : 0) +
                (nsfw !== 'all' ? 1 : 0) +
                (addedWithin !== 'all' ? 1 : 0);
              return (
                <div className="relative" ref={filtersRef}>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((v) => !v)}
                    aria-haspopup="dialog"
                    aria-expanded={filtersOpen}
                    className={`flex items-center h-10 gap-2 px-3 rounded-lg border text-sm transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      filterCount > 0
                        ? 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/20'
                        : 'bg-bg-secondary border-border text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>Filters</span>
                    {filterCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-black text-[11px] font-semibold flex items-center justify-center">
                        {filterCount}
                      </span>
                    )}
                  </button>

                  {filtersOpen && (
                    <div
                      className="absolute right-0 top-full mt-2 z-50 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl p-4 animate-fade-in"
                      role="dialog"
                      aria-label="Filters"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-text-primary">Filters</h4>
                        {filterCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setHeroCategoryId('all');
                              setCategoryId('all');
                              setNsfw('all');
                              setAddedWithin('all');
                              setAddedFrom('');
                              setAddedTo('');
                            }}
                            className="text-xs text-text-secondary hover:text-accent cursor-pointer"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      <div className="space-y-3">
                        {heroOptions.length > 0 && (
                          <label className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Hero</span>
                            <HeroSelect
                              ariaLabel="Filter by hero"
                              value={String(heroCategoryId)}
                              onChange={(v) => {
                                if (v === 'all') setHeroCategoryId('all');
                                else if (v === 'none') setHeroCategoryId('none');
                                else setHeroCategoryId(Number(v));
                              }}
                              options={[
                                { value: 'all', label: 'All Heroes', muted: true },
                                ...(section === 'Sound'
                                  ? [{ value: 'none', label: 'No hero (item / UI / music)', muted: true }]
                                  : []),
                                ...heroOptions.map((hero) => ({
                                  value: String(hero.id),
                                  label: hero.label,
                                  heroName: hero.label,
                                })),
                              ]}
                            />
                          </label>
                        )}

                        {categoryOptions.length > 0 && (
                          <label className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Category</span>
                            <select
                              value={String(categoryId)}
                              onChange={(e) => setCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                              disabled={heroCategoryId !== 'all'}
                              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="all">All Categories</option>
                              {categoryOptions.map((cat) => (
                                <option key={cat.id} value={String(cat.id)}>{cat.label}</option>
                              ))}
                            </select>
                            {heroCategoryId !== 'all' && (
                              <span className="block text-[11px] text-text-tertiary mt-1">Hero filter overrides categories.</span>
                            )}
                          </label>
                        )}

                        {/* Content rating + recency are served by the local catalog
                            mirror, so they only show once it's available. */}
                        {hasLocalCache && (
                          <label className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Content</span>
                            <select
                              value={nsfw}
                              onChange={(e) => setNsfw(e.target.value as BrowseNsfwFilter)}
                              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                            >
                              <option value="all">All</option>
                              <option value="sfw">SFW only</option>
                              <option value="nsfw">NSFW only</option>
                            </select>
                          </label>
                        )}

                        {hasLocalCache && (
                          <div className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Added</span>
                            <select
                              aria-label="Filter by date added"
                              value={addedWithin}
                              onChange={(e) => setAddedWithin(e.target.value as BrowseTimeRange)}
                              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                            >
                              <option value="all">Any time</option>
                              <option value="today">Today</option>
                              <option value="week">This week</option>
                              <option value="month">This month</option>
                              <option value="custom">Custom range</option>
                            </select>
                            {addedWithin === 'custom' && (
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <label className="block">
                                  <span className="block text-[11px] text-text-tertiary mb-1">From</span>
                                  <input
                                    type="date"
                                    value={addedFrom}
                                    max={addedTo || undefined}
                                    onChange={(e) => setAddedFrom(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded-md text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                                  />
                                </label>
                                <label className="block">
                                  <span className="block text-[11px] text-text-tertiary mb-1">To</span>
                                  <input
                                    type="date"
                                    value={addedTo}
                                    min={addedFrom || undefined}
                                    onChange={(e) => setAddedTo(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded-md text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </form>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4">
        {(() => {
          const gridClass =
            viewMode === 'list'
              ? 'flex flex-col gap-3'
              : viewMode === 'dense'
                ? 'grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2'
                : viewMode === 'compact'
                  ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3'
                  : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3';
          const hasActiveFilters =
            search.trim().length > 0 || heroCategoryId !== 'all' || categoryId !== 'all' || sort !== 'default';

          if (loading) {
            // Match perPage so the skeleton grid fills roughly the same footprint
            // as the real results once they arrive.
            return (
              <div className={gridClass} aria-busy="true" aria-live="polite">
                {Array.from({ length: DEFAULT_PER_PAGE }).map((_, i) => (
                  <ModCardSkeleton key={i} viewMode={viewMode} />
                ))}
              </div>
            );
          }
          // Only blank the page for the error/empty states when there are no
          // results to show. When the grid already has mods, a fetch failure
          // is surfaced inline at the load-more row instead (see below), so the
          // grid never flashes out from under the user.
          if (displayMods.length === 0) {
            if (error) {
              return (
                <EmptyState
                  icon={AlertTriangle}
                  title="Couldn't load mods"
                  description={renderErrorWithLinks(error)}
                  variant="error"
                  action={<Button onClick={handleRetryFetch}>Retry</Button>}
                />
              );
            }
            return (
              <EmptyState
                icon={Search}
                title={hasActiveFilters ? 'No mods match your filters' : 'No mods found'}
                description={hasActiveFilters ? 'Try widening your search or clearing filters.' : undefined}
                action={
                  hasActiveFilters ? (
                    <Button
                      onClick={() => {
                        setSearch('');
                        setHeroCategoryId('all');
                        setCategoryId('all');
                        setSort('default');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            );
          }
          return (
            <div className={gridClass}>
              {displayMods.map((mod) => {
                const queueIndex = downloadQueue.findIndex(q => q.modId === mod.id);
                const isQueued = queueIndex >= 0;
                const installedLocal = installedByGbId.get(mod.id);
                return (
                  <ModCard
                    key={mod.id}
                    mod={mod}
                    installed={installedIds.has(mod.id)}
                    installedDisabled={!!installedLocal && !installedLocal.enabled}
                    downloading={downloading?.modId === mod.id}
                    queuePosition={isQueued ? queueIndex + 1 : undefined}
                    viewMode={viewMode}
                    section={section}
                    volume={soundVolume}
                    onVolumeChange={setSoundVolume}
                    hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
                    isPlaying={playingModId === mod.id}
                    onPlayingChange={(playing) => {
                      setPlayingModId((prev) => {
                        if (playing) return mod.id;
                        return prev === mod.id ? null : prev;
                      });
                    }}
                    onClick={() => handleModClick(mod)}
                    onQuickDownload={() => handleQuickDownload(mod)}
                    onEnable={installedLocal && !installedLocal.enabled
                      ? () => toggleMod(installedLocal.id)
                      : undefined}
                  />
                );
              })}
            </div>
          );
        })()}
        {/* Infinite Scroll Trigger */}
        <div ref={loadMoreRef} className="flex items-center justify-center p-4">
          {loadingMore && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading more...</span>
            </div>
          )}
          {loadMoreError && !loadingMore && (
            <div className="flex flex-col items-center gap-2 text-center max-w-md">
              <div className="flex items-center gap-2 text-text-secondary">
                <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
                <span className="text-sm">Couldn't load more. {renderErrorWithLinks(loadMoreError)}</span>
              </div>
              <Button onClick={handleRetryFetch} variant="secondary" size="sm">Retry</Button>
            </div>
          )}
          {!hasMore && !loadMoreError && mods.length > 0 && !loadingMore && (
            <span className="text-sm text-text-secondary">No more mods to load</span>
          )}
        </div>
      </div>

      {/* Mod Details Modal */}
      {selectedMod && (
        <ModDetailsModal
          mod={selectedMod}
          section={section}
          installed={installedIds.has(selectedMod.id)}
          installedFileIds={installedFileIds}
          installedFileStates={installedFileStates}
          onEnableFile={(modId) => toggleMod(modId)}
          downloadingFileId={downloading?.modId === selectedMod.id ? downloading.fileId : null}
          queuedFileIds={new Set(downloadQueue.filter((q) => q.modId === selectedMod.id).map((q) => q.fileId))}
          extracting={extracting}
          progress={downloadProgress}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          dateAdded={selectedModDates?.dateAdded}
          dateModified={selectedModDates?.dateModified}
          onClose={() => setSelectedMod(null)}
          onDownload={handleDownload}
        />
      )}

      {collectionModalOpen && (
        <ImportCollectionModal
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          installedIds={installedIds}
          queuedIds={new Set(downloadQueue.map((q) => q.modId))}
          activeDeadlockPath={activeDeadlockPath}
          onClose={() => setCollectionModalOpen(false)}
        />
      )}

      {importProfileOpen && (
        <ImportProfileDialog
          activeDeadlockPath={activeDeadlockPath}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          onClose={() => setImportProfileOpen(false)}
          onImported={() => { void loadMods(); }}
        />
      )}
    </div>
  );
}

interface ModCardProps {
  mod: GameBananaMod;
  installed: boolean;
  /** True when the local install for this GB mod is currently disabled.
   *  Drives the inline Enable affordance shown after a fresh download. */
  installedDisabled?: boolean;
  downloading: boolean;
  queuePosition?: number;
  viewMode: ViewMode;
  section: string;
  volume: number;
  onVolumeChange: (v: number) => void;
  hideNsfwPreviews: boolean;
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
  onClick: () => void;
  onQuickDownload: () => void;
  /** Toggle the local mod's enabled state. Provided only when there's an
   *  installed-but-disabled mod to enable. */
  onEnable?: () => void;
}

function ModCardSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <div className="bg-bg-secondary border border-border rounded-lg p-3 flex items-center gap-4">
        <div className="bg-bg-tertiary skeleton-shimmer w-32 h-20 flex-shrink-0 rounded-md" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="bg-bg-tertiary skeleton-shimmer h-4 rounded w-2/3" />
          <div className="bg-bg-tertiary skeleton-shimmer h-3 rounded w-1/3" />
        </div>
      </div>
    );
  }
  const aspect = viewMode === 'compact' || viewMode === 'dense' ? 'aspect-[4/3]' : 'aspect-[3/2]';
  return (
    <div className={`relative bg-bg-tertiary border border-border rounded-lg overflow-hidden ${aspect}`}>
      <div className="absolute inset-0 skeleton-shimmer bg-bg-secondary" />
      <div className="absolute bottom-0 left-0 right-0 p-3 space-y-2">
        <div className="h-3.5 bg-bg-tertiary/80 skeleton-shimmer rounded w-3/4" />
        <div className="h-2.5 bg-bg-tertiary/80 skeleton-shimmer rounded w-1/2" />
      </div>
    </div>
  );
}

function ModCard({ mod, installed, installedDisabled, downloading, queuePosition, viewMode, section, volume, onVolumeChange, hideNsfwPreviews, isPlaying, onPlayingChange, onClick, onQuickDownload, onEnable }: ModCardProps) {
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  // Dense reuses the compact card chrome (4:3 aspect, smaller text/padding); it
  // only differs in how many columns the grid packs in.
  const isCompact = viewMode === 'compact' || viewMode === 'dense';
  const isList = viewMode === 'list';
  const isSoundSection = section === 'Sound';
  const hasAudioPreview = Boolean(audioPreview);
  // Sound mods don't carry hero info in the API, so guess from the title.
  // Used to swap in the locker hero portrait as the card backdrop.
  const inferredHero = isSoundSection ? inferHeroFromTitle(mod.name) : null;
  const heroRenderUrl = inferredHero ? getHeroRenderPath(inferredHero) : undefined;
  const heroFacePos = inferredHero ? getHeroFacePosition(inferredHero) : 55;

  // List view keeps original layout
  if (isList) {
    return (
      <div
        onClick={onClick}
        onKeyDown={(e) => handleCardKeyDown(e, onClick)}
        role="button"
        tabIndex={0}
        aria-label={`Open details for ${mod.name}`}
        className={`relative bg-bg-secondary border rounded-lg overflow-hidden focus-visible:border-accent focus-visible:outline-none transition-colors text-left cursor-pointer flex items-center gap-4 p-3 ${
          isPlaying
            ? 'border-state-danger ring-2 ring-state-danger/60 shadow-lg shadow-state-danger/20'
            : 'border-border hover:border-accent/50'
        }`}
      >
        <div className="relative bg-bg-tertiary w-32 h-20 flex-shrink-0 rounded-md overflow-hidden">
          {isSoundSection ? (
            heroRenderUrl ? (
              <img
                src={heroRenderUrl}
                alt={inferredHero ?? mod.name}
                className="w-full h-full object-cover"
                style={{ objectPosition: `${heroFacePos}% 25%` }}
              />
            ) : thumbnail ? (
              <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary flex items-center justify-center">
                <div className="flex items-center gap-1 px-2 py-1 rounded-full border border-accent/40 bg-accent/10 text-text-primary text-[10px] font-semibold">
                  <Volume2 className="w-3 h-3" />
                  SOUND
                </div>
              </div>
            )
          ) : (
            <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium truncate flex-1">{mod.name}</h3>
            {installed && installedDisabled && onEnable ? (
              <button
                onClick={(e) => { e.stopPropagation(); onEnable(); }}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 h-7 bg-state-warning/15 hover:bg-state-warning/25 border border-state-warning/40 text-state-warning rounded-full text-xs font-semibold transition-colors cursor-pointer"
                title="Enable this mod (currently in your disabled folder)"
              >
                <Power className="w-3 h-3" />
                Enable
              </button>
            ) : installed ? (
              <Tag tone="success" variant="overlay" title="Installed" className="flex-shrink-0">
                <span aria-hidden>✓</span>
                Installed
              </Tag>
            ) : downloading ? (
              <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 bg-bg-primary/80 rounded-full">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onQuickDownload(); }}
                className="flex-shrink-0 flex items-center justify-center w-7 h-7 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary rounded-full shadow-lg transition-colors cursor-pointer"
                title="Install"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 text-text-secondary mt-1 text-xs flex-wrap">
            <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{formatCount(mod.likeCount)}</span>
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(mod.viewCount)}</span>
            {typeof mod.downloadCount === 'number' && mod.downloadCount > 0 && (
              <span className="flex items-center gap-1" title={`${mod.downloadCount} downloads`}><Download className="w-3 h-3" />{formatCount(mod.downloadCount)}</span>
            )}
            {mod.nsfw && <Tag tone="danger">18+</Tag>}
          </div>
          {mod.submitter && <p className="text-text-secondary mt-1 truncate text-xs">by {mod.submitter.name}</p>}
          {mod.dateModified > 0 && (
            <div className={`flex items-center gap-1 mt-1 text-xs ${isModOutdated(mod.dateModified) ? 'text-state-warning' : 'text-text-secondary'}`}>
              {isModOutdated(mod.dateModified) ? <AlertTriangle className="w-3 h-3 flex-shrink-0" /> : <Clock className="w-3 h-3 flex-shrink-0" />}
              <span className="truncate">{isModOutdated(mod.dateModified) ? 'Outdated · ' : ''}{formatDate(mod.dateModified)}</span>
            </div>
          )}
        </div>

        {/* Right-side audio cluster for sound mods — fills the empty space on wide rows */}
        {isSoundSection && hasAudioPreview && (
          <div
            className="flex-shrink-0 w-72 hidden md:flex items-center gap-3 bg-bg-tertiary/50 rounded-full border border-border px-3 py-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 min-w-0">
              <AudioPreviewPlayer src={audioPreview!} compact variant="inline" volume={volume} onPlayingChange={onPlayingChange} />
            </div>
            <div className="w-px h-4 bg-border flex-shrink-0" />
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Volume2 className="w-3.5 h-3.5 text-text-secondary" />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(volume * 100)}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
                className="w-14 h-1 accent-accent cursor-pointer"
                aria-label="Volume"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Grid/Compact: overlay card — image fills card, info overlaid at bottom
  const isOutdated = mod.dateModified > 0 && isModOutdated(mod.dateModified);
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => handleCardKeyDown(e, onClick)}
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${mod.name}`}
      className={`relative isolate bg-bg-tertiary border rounded-lg overflow-hidden focus-visible:border-accent focus-visible:outline-none transition-colors text-left cursor-pointer group ${isCompact ? 'aspect-[4/3]' : 'aspect-[3/2]'} ${
        isPlaying
          ? 'border-state-danger ring-2 ring-state-danger/60 shadow-lg shadow-state-danger/20'
          : downloading
            ? 'border-accent ring-2 ring-accent/40 ring-offset-0'
            : installed
              ? 'border-state-success/40 hover:border-state-success/70'
              : 'border-border hover:border-accent/50'
      }`}
    >
      {/* Full-bleed image */}
      <div className="absolute inset-0">
        {isSoundSection ? (
          <div className="w-full h-full relative">
            {heroRenderUrl ? (
              <img
                src={heroRenderUrl}
                alt={inferredHero ?? mod.name}
                className="w-full h-full object-cover"
                style={{ objectPosition: `${heroFacePos}% 20%` }}
              />
            ) : thumbnail ? (
              <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary" />
            )}
            {!hasAudioPreview && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent/40 bg-accent/10 text-text-primary font-medium shadow-lg backdrop-blur-sm ${isCompact ? 'text-xs px-2 py-1' : 'text-sm'}`}>
                  <Volume2 className={isCompact ? 'w-3 h-3' : 'w-4 h-4'} />
                  <span>SOUND</span>
                </div>
              </div>
            )}
            {!thumbnail && !heroRenderUrl && hasAudioPreview && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-end gap-0.5 h-10">
                  {[3, 5, 8, 12, 16, 12, 8, 14, 10, 6, 9, 14, 11, 7, 4, 6, 10, 8, 5, 3].map((h, i) => (
                    <div key={i} className="w-1 bg-accent/60 rounded-full transition-all" style={{ height: `${h * 2}px` }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" />
        )}
      </div>

      {/* Gradient: for sound cards with audio preview, darken TOP (title) and BOTTOM (player).
          For other cards, the classic bottom-darkest gradient. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={
          isSoundSection && hasAudioPreview
            ? {
                background:
                  'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.9) 100%)',
              }
            : {
                background:
                  'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 22%, rgba(0,0,0,0.25) 55%, transparent 80%)',
              }
        }
      />

      {/* Info: moved to TOP for audio-preview sound cards so it stops covering the player.
          State tags (NSFW/Installed/Outdated) live inside this block too, on a row
          ABOVE the title. The default top-left overlay covers the title text on this
          variant because the title is anchored at top:0 instead of bottom:0. */}
      {isSoundSection && hasAudioPreview ? (
        <div className={`absolute top-0 left-0 right-0 pointer-events-none ${isCompact ? 'p-2.5 pr-10' : 'p-3 pr-12'}`}>
          {(mod.nsfw || installed || isOutdated) && (
            <div className="flex flex-wrap items-center gap-1 mb-1.5">
              {mod.nsfw && <Tag tone="danger" variant="overlay">18+</Tag>}
              {installed && (
                <Tag tone="success" variant="overlay">
                  <span aria-hidden>✓</span>
                  Installed
                </Tag>
              )}
              {!installed && isOutdated && (
                <Tag
                  tone="warning"
                  variant="overlay"
                  icon={AlertTriangle}
                  title={`Last updated ${formatDate(mod.dateModified)}`}
                >
                  Outdated
                </Tag>
              )}
            </div>
          )}
          <h3 className={`font-semibold truncate text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] ${isCompact ? 'text-sm' : 'text-base'}`}>{mod.name}</h3>
          <div className={`flex items-center gap-3 text-white/90 mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] flex-wrap ${isCompact ? 'text-[11px]' : 'text-xs'}`}>
            <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{formatCount(mod.likeCount)}</span>
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(mod.viewCount)}</span>
            {typeof mod.downloadCount === 'number' && mod.downloadCount > 0 && (
              <span className="flex items-center gap-1"><Download className="w-3 h-3" />{formatCount(mod.downloadCount)}</span>
            )}
            {mod.submitter && <span className="truncate">by {mod.submitter.name}</span>}
          </div>
        </div>
      ) : (
        <div className={`absolute bottom-0 left-0 right-0 ${isCompact ? 'p-2.5' : 'p-3'}`}>
          <h3 className={`font-semibold truncate text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] ${isCompact ? 'text-sm' : 'text-base'}`}>{mod.name}</h3>
          <div className={`flex items-center gap-3 text-white/90 mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] flex-wrap ${isCompact ? 'text-xs' : 'text-sm'}`}>
            <span className="flex items-center gap-1"><ThumbsUp className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />{formatCount(mod.likeCount)}</span>
            <span className="flex items-center gap-1"><Eye className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />{formatCount(mod.viewCount)}</span>
            {typeof mod.downloadCount === 'number' && mod.downloadCount > 0 && (
              <span className="flex items-center gap-1" title={`${mod.downloadCount} downloads`}>
                <Download className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />{formatCount(mod.downloadCount)}
              </span>
            )}
            {mod.submitter && <span className="truncate">by {mod.submitter.name}</span>}
          </div>
          {mod.dateModified > 0 && isModOutdated(mod.dateModified) && (
            <div className={`flex items-center gap-1 mt-1 text-state-warning ${isCompact ? 'text-xs' : 'text-sm'}`}>
              <AlertTriangle className={isCompact ? 'w-3 h-3 flex-shrink-0' : 'w-3.5 h-3.5 flex-shrink-0'} />
              <span className="truncate">Outdated · {formatDate(mod.dateModified)}</span>
            </div>
          )}
        </div>
      )}

      {/* State tag stack — top-left. Stacks NSFW / INSTALLED / OUTDATED so the
          card is decodable without relying on icon color alone. Skipped for
          sound+audio cards because those render the same tags inline above the
          title (the title moves to top:0 on that variant and the absolute
          overlay would cover it). */}
      {!(isSoundSection && hasAudioPreview) && (
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 items-start">
          {mod.nsfw && <Tag tone="danger" variant="overlay">18+</Tag>}
          {installed && (
            <Tag tone="success" variant="overlay">
              <span aria-hidden>✓</span>
              Installed
            </Tag>
          )}
          {!installed && isOutdated && (
            <Tag
              tone="warning"
              variant="overlay"
              icon={AlertTriangle}
              title={`Last updated ${formatDate(mod.dateModified)}`}
            >
              Outdated
            </Tag>
          )}
        </div>
      )}

      {/* Audio preview + volume, pinned to bottom with its own pointer-events layer.
          z-20 keeps it above the gradient + any overlays so clicks always land.
          Single spacious pill: [play + progress + time] | divider | [volume icon + slider] */}
      {isSoundSection && hasAudioPreview && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 ${isCompact ? 'p-2' : 'p-2.5'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 backdrop-blur-md bg-black/60 rounded-full border border-white/10 px-3 py-2 shadow-lg">
            <div className="flex-1 min-w-0">
              <AudioPreviewPlayer
                src={audioPreview!}
                compact
                variant="inline"
                volume={volume}
                onPlayingChange={onPlayingChange}
              />
            </div>
            <div className="w-px h-5 bg-white/20 flex-shrink-0" />
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Volume2 className="w-3.5 h-3.5 text-white/70" />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(volume * 100)}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
                className="w-16 h-1 accent-accent cursor-pointer"
                title={`Volume: ${Math.round(volume * 100)}%`}
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      )}

      {/* Download / Enable button overlay — top right with backdrop */}
      <div className="absolute top-2 right-2">
        {installed && installedDisabled && onEnable ? (
          // Mod just installed but still in the disabled folder. Surface an
          // inline Enable affordance right where the user's eye is rather
          // than forcing them to the Installed tab.
          <button
            onClick={(e) => { e.stopPropagation(); onEnable(); }}
            className={`flex items-center gap-1.5 rounded-full bg-state-warning/90 hover:bg-state-warning text-black backdrop-blur-sm ring-1 ring-black/40 shadow-md font-semibold transition-colors cursor-pointer ${isCompact ? 'h-7 px-2 text-[11px]' : 'h-8 px-2.5 text-xs'}`}
            title="Enable this mod (currently in your disabled folder)"
          >
            <Power className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            Enable
          </button>
        ) : installed ? (
          <span
            className={`flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm ring-1 ring-black/60 shadow-md text-state-success ${isCompact ? 'w-7 h-7 text-sm' : 'w-8 h-8 text-base'}`}
            title="Installed and enabled"
          >
            ✓
          </span>
        ) : downloading ? (
          <div className={`flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm ring-1 ring-black/60 shadow-md ${isCompact ? 'w-7 h-7' : 'w-8 h-8'}`} title="Downloading...">
            <Loader2 className={`animate-spin text-accent ${isCompact ? 'w-4 h-4' : 'w-5 h-5'}`} />
          </div>
        ) : queuePosition ? (
          <div
            className={`flex items-center justify-center bg-accent text-black rounded-full font-bold ring-1 ring-black/50 shadow-md ${isCompact ? 'w-7 h-7 text-[11px]' : 'w-8 h-8 text-xs'}`}
            title={`Queued #${queuePosition}`}
          >
            {queuePosition}
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onQuickDownload(); }}
            className={`flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm ring-1 ring-black/60 shadow-md text-accent hover:bg-accent/20 hover:text-text-primary hover:ring-accent/60 transition-all cursor-pointer ${isCompact ? 'w-7 h-7' : 'w-8 h-8'}`}
            title="Install"
          >
            <Download className={isCompact ? 'w-4 h-4' : 'w-5 h-5'} />
          </button>
        )}
      </div>
    </div>
  );
}

