import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Loader2,
  Download,
  Eye,
  ThumbsUp,
  ExternalLink,
} from 'lucide-react';
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
import { getModThumbnail, getSoundPreviewUrl } from '../types/gamebanana';
import { useAppStore } from '../stores/appStore';
import ModThumbnail from '../components/ModThumbnail';

const DEFAULT_PER_PAGE = 20;
type SortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';
type ViewMode = 'grid' | 'compact' | 'list';
const SECTION_WHITELIST = new Set(['Mod', 'Sound']);

// Special category ID for "Soul Containers" database search
const SOUL_CONTAINERS_SEARCH_ID = -999;

// Categories to hide from the dropdown (covered by Soul Containers search or not useful)
const HIDDEN_CATEGORIES = new Set(['soul container', 'model replacement']);

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
  const { settings, loadSettings, loadMods, mods: installedMods } = useAppStore();
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

  // Check if Soul Containers search is active
  const isSoulContainersSearch = categoryId === SOUL_CONTAINERS_SEARCH_ID;

  const effectiveCategoryId =
    heroCategoryId === 'all'
      ? (categoryId === 'all' || isSoulContainersSearch ? undefined : categoryId)
      : heroCategoryId;

  // Effective search query - append "soul container" when that category is selected
  const effectiveSearch = isSoulContainersSearch
    ? (search.trim() ? `${search.trim()} soul container` : 'soul container')
    : search;

  // Only use local search when there's an active search query AND we have cache
  // For default browsing (no search), always fetch fresh from API
  // Also use local search for special Soul Containers category
  useEffect(() => {
    const hasSearchQuery = search.trim().length > 0 || isSoulContainersSearch;
    setUseLocalSearch(hasSearchQuery && hasLocalCache);
  }, [search, hasLocalCache, isSoulContainersSearch]);

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

      // Append results for infinite scroll
      if (page === 1) {
        setMods(response.records);
      } else {
        setMods(prev => [...prev, ...response.records]);
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
      const sortMap: Record<SortOption, 'relevance' | 'likes' | 'date' | 'views' | 'name'> = {
        default: 'relevance',
        popular: 'likes',
        recent: 'date',
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
  }, [search, sort, section, effectiveCategoryId, isSoulContainersSearch, perPage]);

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

      const file = details.files[0];
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

    // Filter out hidden categories and their subcategories
    options = options.filter(opt => {
      const lowerLabel = opt.label.toLowerCase();
      for (const hidden of HIDDEN_CATEGORIES) {
        if (lowerLabel === hidden || lowerLabel.startsWith(hidden + ' / ')) {
          return false;
        }
      }
      return true;
    });

    // Add special "Soul Containers" search category at the top (only for Mod section)
    if (section === 'Mod') {
      options = [
        { id: SOUL_CONTAINERS_SEARCH_ID, label: 'Soul Containers' },
        ...options,
      ];
    }

    return options;
  }, [categories, heroOptions, section]);

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
                className="w-full bg-bg-secondary border border-border rounded-lg pl-10 pr-4 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />
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
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent appearance-none"
            >
              {sections.map((entry) => (
                <option key={entry.modelName} value={entry.modelName}>
                  {entry.pluralTitle}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent appearance-none"
            >
              <option value="default">Default</option>
              <option value="popular">Popularity</option>
              <option value="recent">Recently Added</option>
              <option value="updated">Recently Updated</option>
              <option value="views">Most Viewed</option>
              <option value="name">Name (A–Z)</option>
            </select>
            {heroOptions.length > 0 && (
              <select
                value={heroCategoryId}
                onChange={(e) =>
                  setHeroCategoryId(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  )
                }
                className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent appearance-none"
              >
                <option value="all">All Heroes</option>
                {heroOptions.map((hero) => (
                  <option key={hero.id} value={hero.id}>
                    {hero.label}
                  </option>
                ))}
              </select>
            )}
            <select
              value={categoryId}
              onChange={(e) =>
                setCategoryId(
                  e.target.value === 'all' ? 'all' : Number(e.target.value)
                )
              }
              disabled={heroCategoryId !== 'all'}
              className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent appearance-none disabled:opacity-60"
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
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
        </div>
      </div>

      {/* Mod Details Modal */}
      {selectedMod && (
        <ModDetailsModal
          mod={selectedMod}
          installed={installedIds.has(selectedMod.id)}
          installedFileIds={installedFileIds}
          downloadingFileId={downloading?.modId === selectedMod.id ? downloading.fileId : null}
          extracting={extracting}
          progress={downloadProgress}
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
  hideNsfwPreviews: boolean;
  onClick: () => void;
  onQuickDownload: () => void;
}

function ModCard({ mod, installed, downloading, viewMode, section, hideNsfwPreviews, onClick, onQuickDownload }: ModCardProps) {
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  const isCompact = viewMode === 'compact';
  const isList = viewMode === 'list';

  return (
    <button
      onClick={onClick}
      className={`bg-bg-secondary border border-border rounded-lg overflow-hidden hover:border-accent/50 transition-colors text-left ${isList ? 'flex items-center gap-4 p-3' : ''
        }`}
    >
      {/* Thumbnail */}
      <div
        className={`bg-bg-tertiary ${isList
          ? 'w-32 h-20 flex-shrink-0 rounded-md overflow-hidden'
          : 'aspect-video'
          }`}
      >
        <ModThumbnail
          src={thumbnail}
          alt={mod.name}
          nsfw={mod.nsfw}
          hideNsfw={hideNsfwPreviews}
          className="w-full h-full"
        />
      </div>

      {/* Info */}
      <div className={isList ? 'min-w-0 flex-1' : isCompact ? 'p-2' : 'p-3'}>
        <div className="flex items-center gap-2">
          <h3 className={`font-medium truncate ${isCompact ? 'text-sm' : ''}`}>{mod.name}</h3>
          {installed ? (
            <span
              className={`rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400 ${isCompact ? 'text-[9px]' : ''
                }`}
            >
              Installed
            </span>
          ) : downloading ? (
            <span className="flex items-center gap-1 text-xs text-accent">
              <Loader2 className="w-3 h-3 animate-spin" />
            </span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickDownload();
              }}
              className={`flex items-center gap-1 px-2 py-1 bg-accent hover:bg-accent-secondary text-white rounded transition-colors ${isCompact ? 'text-[10px]' : 'text-xs'}`}
            >
              <Download className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
              {!isCompact && 'Install'}
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
        </div>
        {mod.submitter && (
          <p className={`text-text-secondary mt-1 truncate ${isCompact ? 'text-[11px]' : 'text-xs'}`}>
            by {mod.submitter.name}
          </p>
        )}
        {audioPreview && (
          <audio
            className={`mt-2 w-full ${isCompact ? 'h-7' : ''}`}
            controls
            preload="none"
            src={audioPreview}
          />
        )}
      </div>
    </button>
  );
}

interface ModDetailsModalProps {
  mod: GameBananaModDetails;
  installed: boolean;
  installedFileIds: Set<number>;
  downloadingFileId: number | null;
  extracting: boolean;
  progress: { downloaded: number; total: number } | null;
  onClose: () => void;
  onDownload: (fileId: number, fileName: string) => void;
}

function ModDetailsModal({
  mod,
  installed,
  installedFileIds,
  downloadingFileId,
  extracting,
  progress,
  onClose,
  onDownload,
}: ModDetailsModalProps) {
  const thumbnail = mod.previewMedia?.images?.[0];
  const thumbnailUrl = thumbnail
    ? `${thumbnail.baseUrl}/${thumbnail.file530 || thumbnail.file}`
    : undefined;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-bg-secondary rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto">
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
          {/* Preview */}
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt={mod.name}
              className="w-full rounded-lg object-cover max-h-64"
            />
          )}

          {/* Description */}
          {mod.description && (
            <div className="text-sm text-text-secondary">
              <div dangerouslySetInnerHTML={{ __html: mod.description }} />
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
