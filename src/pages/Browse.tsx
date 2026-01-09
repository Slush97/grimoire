import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Loader2,
  Download,
  Eye,
  ThumbsUp,
  ExternalLink,
  X,
  Volume2,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import {
  browseMods,
  getModDetails,
  downloadMod,
  getGamebananaSections,
  getGamebananaCategories,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import type {
  GameBananaMod,
  GameBananaModDetails,
  GameBananaSection,
  GameBananaCategoryNode,
} from '../types/gamebanana';
import { getModThumbnail, getSoundPreviewUrl, getPrimaryFile } from '../types/gamebanana';
import { useAppStore } from '../stores/appStore';
import ModThumbnail from '../components/ModThumbnail';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import { DynamicSelect } from '../components/common/DynamicSelect';

const DEFAULT_PER_PAGE = 20;
type SortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';
type ViewMode = 'grid' | 'compact' | 'list';
const SECTION_WHITELIST = new Set(['Mod', 'Sound']);

// Only show these categories in the dropdown (lowercase for matching)
const ALLOWED_CATEGORIES = new Set(['hud', 'other/misc', 'maps']);

type CategoryOption = {
  id: number;
  label: string;
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
      results.push({ id: node.id, label: nextPath });
    }

    if (node.children && node.children.length > 0) {
      results.push(...flattenCategories(node.children, nextPath, options));
    }
  }

  return results;
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
  const { settings, loadSettings, loadMods, mods: installedMods, soundVolume, setSoundVolume } = useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [mods, setMods] = useState<GameBananaMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const perPage = DEFAULT_PER_PAGE; // Fixed value for infinite scroll
  const [sort, setSort] = useState<SortOption>('default');
  const [sections, setSections] = useState<GameBananaSection[]>([]);
  const [section, setSection] = useState('Mod');
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>([]);
  const [heroCategoryId, setHeroCategoryId] = useState<number | 'all'>('all');
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedMod, setSelectedMod] = useState<GameBananaModDetails | null>(null);
  const [downloading, setDownloading] = useState<{ modId: number; fileId: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [useLocalSearch, setUseLocalSearch] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Load settings on mount (needed for hideNsfwPreviews)
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

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

  const effectiveCategoryId =
    heroCategoryId === 'all'
      ? (categoryId === 'all' ? undefined : categoryId)
      : heroCategoryId;

  const effectiveSearch = search;

  // Only use local search when there's an active search query AND we have cache
  // For default browsing (no search), always fetch fresh from API
  useEffect(() => {
    const hasSearchQuery = search.trim().length > 0;
    setUseLocalSearch(hasSearchQuery && hasLocalCache);
  }, [search, hasLocalCache]);

  const fetchMods = useCallback(async () => {
    // Show loading spinner on first page, loading indicator otherwise
    if (page === 1) {
      setLoading(true);
      setMods([]);
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
      setError(String(err));
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
  ]);

  // Local search function using SQLite cache
  const searchLocal = useCallback(async () => {
    // Show loading spinner on first page, loading indicator otherwise
    if (page === 1) {
      setLoading(true);
      setMods([]);
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

      const result = await window.electronAPI.searchLocalMods({
        query: effectiveSearch.trim() || undefined,
        section: section,
        categoryId: effectiveCategoryId,
        sortBy: sortMap[sort] || 'relevance',
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
          if (!m.thumbnailUrl) return undefined;
          const lastSlash = m.thumbnailUrl.lastIndexOf('/');
          if (lastSlash === -1) return undefined;
          const baseUrl = m.thumbnailUrl.substring(0, lastSlash);
          const file = m.thumbnailUrl.substring(lastSlash + 1);
          if (!baseUrl || !file) return undefined;
          return {
            images: [{ baseUrl, file, file530: file }]
          };
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
      // Setting useLocalSearch to false will trigger the effect to call fetchMods
      setUseLocalSearch(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [page, effectiveSearch, section, sort, perPage, effectiveCategoryId]);

  useEffect(() => {
    setPage(1);
    setHasMore(true);
  }, [search, sort, section, effectiveCategoryId, perPage]);

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
  }, []);

  useEffect(() => {
    let active = true;
    const selected = sections.find((entry) => entry.modelName === section);
    if (!selected) {
      setCategories([]);
      return () => {
        active = false;
      };
    }

    const loadCategories = async () => {
      try {
        const data = await getGamebananaCategories(selected.categoryModelName);
        if (!active) return;
        setCategories(data);
        setHeroCategoryId('all');
        setCategoryId('all');
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
  }, [sections, section]);

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

    return () => {
      progressUnsub();
      extractingUnsub();
      completeUnsub();
    };
  }, [downloading, loadMods]);

  // Infinite scroll observer
  // Infinite scroll observer
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Load more when reaching bottom and not already loading
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loading, loadingMore]);

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
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleModClick = async (mod: GameBananaMod) => {
    try {
      const details = await getModDetails(mod.id, section);
      setSelectedMod(details);

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

    setDownloading({ modId: selectedMod.id, fileId });
    setDownloadProgress({ downloaded: 0, total: 0 });
    setExtracting(false);

    try {
      await downloadMod(selectedMod.id, fileId, fileName, section, effectiveCategoryId);
    } catch (err) {
      setError(String(err));
      setDownloading(null);
      setDownloadProgress(null);
      setExtracting(false);
    }
  };

  const handleQuickDownload = async (mod: GameBananaMod) => {
    if (!activeDeadlockPath || downloading) return;

    try {
      // Fetch mod details to get the first file
      const details = await getModDetails(mod.id, section);
      if (!details.files || details.files.length === 0) {
        setError('No downloadable files found');
        return;
      }

      const file = getPrimaryFile(details.files);
      setDownloading({ modId: mod.id, fileId: file.id });
      setDownloadProgress({ downloaded: 0, total: 0 });
      setExtracting(false);

      await downloadMod(mod.id, file.id, file.fileName, section, effectiveCategoryId);
    } catch (err) {
      setError(String(err));
      setDownloading(null);
      setDownloadProgress(null);
      setExtracting(false);
    }
  };

  const heroOptions = useMemo(() => {
    if (section !== 'Mod') return [];
    const skins = findCategoryByName(categories, 'Skins');
    if (!skins?.children) return [];
    return skins.children
      .filter((child) => child.itemCount > 0)
      .map((child) => ({
        id: child.id,
        label: child.name,
      }));
  }, [categories, section]);

  const categoryOptions = useMemo(() => {
    const heroIds = new Set(heroOptions.map((hero) => hero.id));

    // Get all flattened categories
    let options = flattenCategories(categories, '', { excludeIds: heroIds, includeEmpty: false });

    // Only keep allowed categories (HUD, Other/Misc, Maps)
    options = options.filter(opt => {
      const lowerLabel = opt.label.toLowerCase();
      return ALLOWED_CATEGORIES.has(lowerLabel);
    });

    return options;
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

  // Just use all loaded mods - infinite scroll handles pagination
  const displayMods = mods;

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
    <div className="flex flex-col h-full">
      {/* Header with Search */}
      <div className="p-4 border-b border-border">
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mods..."
                className="w-full bg-bg-secondary border border-border rounded-lg pl-10 pr-10 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); handleSearch(new Event('submit') as unknown as React.FormEvent); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-text-secondary hover:text-text-primary transition-colors"
                  title="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={syncing}
              className="px-4 py-2 bg-bg-tertiary hover:bg-bg-secondary border border-border text-text-primary rounded-lg transition-colors disabled:opacity-50"
              title="Sync fresh data from GameBanana"
            >
              {syncing ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Syncing...
                </span>
              ) : (
                'Refresh'
              )}
            </button>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-secondary p-1">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded-md transition-colors ${viewMode === 'grid'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                  }`}
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode('compact')}
                className={`px-3 py-1.5 rounded-md transition-colors ${viewMode === 'compact'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                  }`}
              >
                Compact
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-md transition-colors ${viewMode === 'list'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                  }`}
              >
                List
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DynamicSelect
              value={section}
              onChange={(val) => setSection(val)}
              options={sections.map((entry) => ({ value: entry.modelName, label: entry.pluralTitle }))}
            />
            {/* Global Volume Slider - visible when Sound section is selected */}
            {section === 'Sound' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-border rounded-lg">
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
            {heroOptions.length > 0 && (
              <DynamicSelect
                value={String(heroCategoryId)}
                onChange={(val) => setHeroCategoryId(val === 'all' ? 'all' : Number(val))}
                options={[
                  { value: 'all', label: 'All Heroes' },
                  ...heroOptions.map((hero) => ({ value: String(hero.id), label: hero.label })),
                ]}
              />
            )}
            <DynamicSelect
              value={String(categoryId)}
              onChange={(val) => setCategoryId(val === 'all' ? 'all' : Number(val))}
              options={[
                { value: 'all', label: 'All Categories' },
                ...categoryOptions.map((cat) => ({ value: String(cat.id), label: cat.label })),
              ]}
              disabled={heroCategoryId !== 'all'}
            />
          </div>
        </form>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <p className="text-red-400">{error}</p>
            <button
              onClick={fetchMods}
              className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : displayMods.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <Search className="w-16 h-16 mb-4 opacity-50" />
            <p>No mods found</p>
          </div>
        ) : (
          <div
            className={
              viewMode === 'list'
                ? 'flex flex-col gap-3'
                : viewMode === 'compact'
                  ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3'
                  : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
            }
          >
            {displayMods.map((mod) => (
              <ModCard
                key={mod.id}
                mod={mod}
                installed={installedIds.has(mod.id)}
                downloading={downloading?.modId === mod.id}
                viewMode={viewMode}
                section={section}
                volume={soundVolume}
                hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
                onClick={() => handleModClick(mod)}
                onQuickDownload={() => handleQuickDownload(mod)}
              />
            ))}
          </div>
        )}
        {/* Infinite Scroll Trigger */}
        <div ref={loadMoreRef} className="flex items-center justify-center p-4">
          {loadingMore && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading more...</span>
            </div>
          )}
          {!hasMore && mods.length > 0 && !loadingMore && (
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
          downloadingFileId={downloading?.modId === selectedMod.id ? downloading.fileId : null}
          extracting={extracting}
          progress={downloadProgress}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
          onClose={() => setSelectedMod(null)}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
}

interface ModCardProps {
  mod: GameBananaMod;
  installed: boolean;
  downloading: boolean;
  viewMode: ViewMode;
  section: string;
  volume: number;
  hideNsfwPreviews: boolean;
  onClick: () => void;
  onQuickDownload: () => void;
}

function ModCard({ mod, installed, downloading, viewMode, section, volume, hideNsfwPreviews, onClick, onQuickDownload }: ModCardProps) {
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  const isCompact = viewMode === 'compact';
  const isList = viewMode === 'list';
  const isSoundSection = section === 'Sound';
  const hasAudioPreview = Boolean(audioPreview);

  return (
    <div
      onClick={onClick}
      className={`bg-bg-secondary border border-border rounded-lg overflow-hidden hover:border-accent/50 transition-colors text-left cursor-pointer ${isList ? 'flex items-center gap-4 p-3' : ''
        }`}
    >
      {/* Thumbnail area - enhanced for Sound mods */}
      <div
        className={`relative bg-bg-tertiary ${isList
          ? 'w-32 h-20 flex-shrink-0 rounded-md overflow-hidden'
          : 'aspect-video'
          }`}
      >
        {isSoundSection ? (
          /* Sound Mod Card - shows audio player overlaid on image or standalone */
          <div className="w-full h-full relative">
            {/* Background: show thumbnail if available, otherwise gradient */}
            {thumbnail ? (
              <>
                <ModThumbnail
                  src={thumbnail}
                  alt={mod.name}
                  nsfw={mod.nsfw}
                  hideNsfw={hideNsfwPreviews}
                  className="w-full h-full"
                />
                {/* Dark overlay for better audio player visibility */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
              </>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary" />
            )}

            {/* Audio controls overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-end p-3">
              {hasAudioPreview ? (
                /* Full audio player when preview exists */
                <>
                  {/* Waveform visualization graphic */}
                  {!thumbnail && (
                    <div className="flex items-end gap-0.5 mb-2 h-8">
                      {[3, 5, 8, 12, 16, 12, 8, 14, 10, 6, 9, 14, 11, 7, 4, 6, 10, 8, 5, 3].map((h, i) => (
                        <div
                          key={i}
                          className="w-1 bg-accent/60 rounded-full transition-all"
                          style={{ height: `${h * 2}px` }}
                        />
                      ))}
                    </div>
                  )}
                  {/* Audio Player with glassmorphism effect */}
                  <div className="w-full backdrop-blur-md bg-black/30 rounded-lg border border-white/10">
                    <AudioPreviewPlayer
                      src={audioPreview!}
                      compact={isCompact || isList}
                      volume={volume}
                      className="w-full"
                    />
                  </div>
                </>
              ) : (
                /* Sound badge when no audio preview available */
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/90 text-white font-medium shadow-lg ${isCompact ? 'text-xs px-2 py-1' : 'text-sm'}`}>
                    <Volume2 className={isCompact ? 'w-3 h-3' : 'w-4 h-4'} />
                    <span>SOUND</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <ModThumbnail
            src={thumbnail}
            alt={mod.name}
            nsfw={mod.nsfw}
            hideNsfw={hideNsfwPreviews}
            className="w-full h-full"
          />
        )}
      </div>

      {/* Info */}
      <div className={isList ? 'min-w-0 flex-1' : isCompact ? 'p-2' : 'p-3'}>
        <div className="flex items-start justify-between gap-2">
          <h3 className={`font-medium truncate flex-1 ${isCompact ? 'text-sm' : ''}`}>{mod.name}</h3>
          {/* Install button */}
          {installed ? (
            <span
              className={`flex-shrink-0 rounded-full bg-green-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ${isCompact ? 'text-[9px] px-1.5' : ''}`}
            >
              ✓
            </span>
          ) : downloading ? (
            <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 bg-bg-primary/80 rounded-full">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
            </span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickDownload();
              }}
              className={`flex-shrink-0 flex items-center justify-center w-7 h-7 bg-accent hover:bg-accent-secondary text-white rounded-full shadow-lg transition-colors ${isCompact ? 'w-6 h-6' : ''}`}
              title="Install"
            >
              <Download className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            </button>
          )}
        </div>
        <div className={`flex items-center gap-3 text-text-secondary mt-1 ${isCompact ? 'text-[11px]' : 'text-xs'}`}>
          <span className="flex items-center gap-1">
            <ThumbsUp className="w-3 h-3" />
            {mod.likeCount}
          </span>
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3" />
            {mod.viewCount}
          </span>
          <span className="flex items-center gap-1">
            <Download className="w-3 h-3" />
            {mod.downloadCount !== undefined ? mod.downloadCount.toLocaleString() : '—'}
          </span>
        </div>
        {mod.submitter && (
          <p className={`text-text-secondary mt-1 truncate ${isCompact ? 'text-[11px]' : 'text-xs'}`}>
            by {mod.submitter.name}
          </p>
        )}
      </div>
    </div>
  );
}

interface ModDetailsModalProps {
  mod: GameBananaModDetails;
  section: string;
  installed: boolean;
  installedFileIds: Set<number>;
  downloadingFileId: number | null;
  extracting: boolean;
  progress: { downloaded: number; total: number } | null;
  hideNsfwPreviews: boolean;
  onClose: () => void;
  onDownload: (fileId: number, fileName: string) => void;
}

function ModDetailsModal({
  mod,
  section,
  installed,
  installedFileIds,
  downloadingFileId,
  extracting,
  progress,
  hideNsfwPreviews,
  onClose,
  onDownload,
}: ModDetailsModalProps) {
  const images = mod.previewMedia?.images ?? [];
  const audioPreviewUrl = mod.previewMedia?.metadata?.audioUrl;
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const currentImage = images[currentImageIndex];
  const currentImageUrl = currentImage
    ? `${currentImage.baseUrl}/${currentImage.file530 || currentImage.file}`
    : undefined;

  const goToPrevious = () => {
    setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-bg-secondary border-b border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-xl font-bold truncate">{mod.name}</h2>
            {installed && (
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400">
                Installed
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Image Carousel */}
          {images.length > 0 && (
            <div className="relative w-full rounded-lg overflow-hidden border border-border">
              {/* Current Image */}
              <div className="relative">
                <ModThumbnail
                  src={currentImageUrl}
                  alt={`${mod.name} - Image ${currentImageIndex + 1}`}
                  nsfw={mod.nsfw}
                  hideNsfw={hideNsfwPreviews}
                  className="w-full max-h-[60vh] object-contain bg-bg-tertiary"
                />
              </div>

              {/* Navigation Arrows (only if more than 1 image) */}
              {images.length > 1 && (
                <>
                  <button
                    onClick={goToPrevious}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors"
                    aria-label="Previous image"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={goToNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors"
                    aria-label="Next image"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* Dot Indicators */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentImageIndex(index)}
                        className={`w-2 h-2 rounded-full transition-colors ${index === currentImageIndex
                          ? 'bg-white'
                          : 'bg-white/40 hover:bg-white/60'
                          }`}
                        aria-label={`Go to image ${index + 1}`}
                      />
                    ))}
                  </div>

                  {/* Image Counter */}
                  <div className="absolute top-2 right-2 px-2 py-1 rounded bg-black/50 text-white/80 text-xs">
                    {currentImageIndex + 1} / {images.length}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Audio Preview - for Sound mods or any mod with audio */}
          {audioPreviewUrl && (
            <div className="relative rounded-lg overflow-hidden border border-border bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary p-4">
              <div className="flex items-center gap-3 mb-3">
                <Volume2 className="w-5 h-5 text-accent" />
                <h3 className="font-medium text-text-primary">Audio Preview</h3>
              </div>
              {/* Waveform visualization */}
              <div className="flex items-end justify-center gap-0.5 mb-3 h-12">
                {[3, 5, 8, 12, 16, 20, 16, 12, 18, 14, 10, 6, 9, 14, 18, 14, 11, 7, 4, 6, 10, 14, 18, 14, 8, 5, 3].map((h, i) => (
                  <div
                    key={i}
                    className="w-1.5 bg-accent/50 rounded-full transition-all"
                    style={{ height: `${h * 2}px` }}
                  />
                ))}
              </div>
              {/* Audio Player with enhanced styling */}
              <div className="backdrop-blur-md bg-bg-primary/50 rounded-lg border border-white/10 p-1">
                <AudioPreviewPlayer
                  src={audioPreviewUrl}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {/* Sound Indicator - for Sound section without audio preview */}
          {section === 'Sound' && !audioPreviewUrl && images.length === 0 && (
            <div className="flex items-center justify-center p-8 rounded-lg border border-border bg-bg-tertiary">
              <div className="flex flex-col items-center gap-2 text-text-secondary">
                <Volume2 className="w-12 h-12 text-accent/60" />
                <span className="text-sm">Sound Mod</span>
                <span className="text-xs opacity-60">No audio preview available</span>
              </div>
            </div>
          )}

          {/* Description */}
          {mod.description && (
            <div className="text-sm text-text-secondary">
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mod.description) }} />
            </div>
          )}

          {/* Files */}
          {mod.files && mod.files.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">Files</h3>
              {mod.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{file.fileName}</p>
                    <p className="text-xs text-text-secondary">
                      {(file.fileSize / 1024 / 1024).toFixed(2)} MB •{' '}
                      {file.downloadCount.toLocaleString()} downloads
                    </p>
                  </div>
                  <button
                    onClick={() => onDownload(file.id, file.fileName)}
                    disabled={downloadingFileId !== null}
                    className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors ml-4"
                  >
                    {downloadingFileId === file.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {extracting
                          ? 'Extracting...'
                          : progress && progress.total > 0
                            ? `${Math.round((progress.downloaded / progress.total) * 100)}%`
                            : 'Downloading...'}
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        {installedFileIds.has(file.id) ? 'Reinstall' : 'Install'}
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* GameBanana Link */}
          <a
            href={`https://gamebanana.com/mods/${mod.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-accent hover:text-accent-hover transition-colors text-sm"
          >
            <ExternalLink className="w-4 h-4" />
            View on GameBanana
          </a>
        </div>
      </div>
    </div>
  );
}
