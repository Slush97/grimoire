import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  List,
  AlertTriangle,
  Clock,
  Package,
  Music,
  SlidersHorizontal,
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
import { getModThumbnail, getSoundPreviewUrl, getPrimaryFile, formatDate, isModOutdated } from '../types/gamebanana';
import { useAppStore } from '../stores/appStore';
import ModThumbnail from '../components/ModThumbnail';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import { DynamicSelect } from '../components/common/DynamicSelect';
import { Button, Tag } from '../components/common/ui';
import { EmptyState } from '../components/common/PageComponents';
import ModDetailsModal from '../components/ModDetailsModal';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition } from '../lib/lockerUtils';

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

// Abbreviate counts (1234 -> 1.2k, 98765 -> 99k)
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
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
  const [selectedModDates, setSelectedModDates] = useState<{ dateAdded: number; dateModified: number } | null>(null);
  const [downloading, setDownloading] = useState<{ modId: number; fileId: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [useLocalSearch, setUseLocalSearch] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [downloadQueue, setDownloadQueue] = useState<Array<{ modId: number; fileId: number; fileName: string }>>([]);
  const [playingModId, setPlayingModId] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

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

  const effectiveCategoryId =
    heroCategoryId === 'all'
      ? (categoryId === 'all' ? undefined : categoryId)
      : heroCategoryId;

  const effectiveSearch = search;

  // Use local search when:
  // 1. There's an active search query AND we have cache, OR
  // 2. A hero filter is selected (to enable enhanced OR search)
  useEffect(() => {
    const hasSearchQuery = search.trim().length > 0;
    const hasHeroFilter = heroCategoryId !== 'all';
    setUseLocalSearch((hasSearchQuery || hasHeroFilter) && hasLocalCache);
  }, [search, hasLocalCache, heroCategoryId]);

  const fetchMods = useCallback(async () => {
    // Don't fetch from API if we're using local search
    if (useLocalSearch) return;

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
    useLocalSearch,
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

      // Get hero name and skins category ID for enhanced hero search
      // Look up hero name directly from Skins children to avoid circular dependency
      const skinsCat = findCategoryByName(categories, 'Skins');
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
  }, [page, effectiveSearch, section, sort, perPage, effectiveCategoryId, heroCategoryId, categories]);

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    setMods([]);
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

  // Just use all loaded mods - infinite scroll handles pagination.
  // Hide outdated mods if the user has opted in.
  const displayMods = settings?.hideOutdatedMods
    ? mods.filter((m) => !m.dateModified || !isModOutdated(m.dateModified))
    : mods;

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
    <div className="h-full overflow-y-auto">
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
                className="w-full bg-bg-secondary border border-border rounded-lg pl-3 pr-16 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
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

            {/* Refresh Icon Button */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={syncing}
              className="p-2.5 bg-bg-secondary hover:bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              title="Refresh from GameBanana"
            >
              {syncing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5" />
              )}
            </button>

            {/* View Mode Toggle - Icon Only */}
            <div className="flex items-center rounded-lg border border-border bg-bg-secondary p-1">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === 'grid'
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
              <div className="flex items-center rounded-lg border border-border bg-bg-secondary p-1" role="tablist" aria-label="Section">
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
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-md transition-colors cursor-pointer ${
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

            {/* Filters popover — houses hero + category selectors. Collapses two
                always-visible dropdowns into one control with an active-count badge. */}
            {(heroOptions.length > 0 || categoryOptions.length > 0) && (() => {
              const filterCount =
                (heroCategoryId !== 'all' ? 1 : 0) +
                (categoryId !== 'all' ? 1 : 0);
              return (
                <div className="relative" ref={filtersRef}>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((v) => !v)}
                    aria-haspopup="dialog"
                    aria-expanded={filtersOpen}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
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
                      className="absolute right-0 top-full mt-2 z-20 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl p-4 animate-fade-in"
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
                            <select
                              value={String(heroCategoryId)}
                              onChange={(e) => setHeroCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                            >
                              <option value="all">All Heroes</option>
                              {heroOptions.map((hero) => (
                                <option key={hero.id} value={String(hero.id)}>{hero.label}</option>
                              ))}
                            </select>
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
          if (error) {
            return (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load mods"
                description={renderErrorWithLinks(error)}
                variant="error"
                action={<Button onClick={fetchMods}>Retry</Button>}
              />
            );
          }
          if (displayMods.length === 0) {
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
                return (
                  <ModCard
                    key={mod.id}
                    mod={mod}
                    installed={installedIds.has(mod.id)}
                    downloading={downloading?.modId === mod.id}
                    queuePosition={isQueued ? queueIndex + 1 : undefined}
                    viewMode={viewMode}
                    section={section}
                    volume={soundVolume}
                    onVolumeChange={setSoundVolume}
                    hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
                    isPlaying={playingModId === mod.id}
                    onPlayingChange={(playing) => {
                      setPlayingModId((prev) => {
                        if (playing) return mod.id;
                        return prev === mod.id ? null : prev;
                      });
                    }}
                    onClick={() => handleModClick(mod)}
                    onQuickDownload={() => handleQuickDownload(mod)}
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
          dateAdded={selectedModDates?.dateAdded}
          dateModified={selectedModDates?.dateModified}
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
  const aspect = viewMode === 'compact' ? 'aspect-[4/3]' : 'aspect-[3/2]';
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

function ModCard({ mod, installed, downloading, queuePosition, viewMode, section, volume, onVolumeChange, hideNsfwPreviews, isPlaying, onPlayingChange, onClick, onQuickDownload }: ModCardProps) {
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  const isCompact = viewMode === 'compact';
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
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/80 text-white text-[10px] font-semibold">
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
            {installed ? (
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
                className="flex-shrink-0 flex items-center justify-center w-7 h-7 bg-accent hover:bg-accent-hover text-black rounded-full shadow-lg transition-colors cursor-pointer"
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
      className={`relative bg-bg-tertiary border rounded-lg overflow-hidden focus-visible:border-accent focus-visible:outline-none transition-colors text-left cursor-pointer group ${isCompact ? 'aspect-[4/3]' : 'aspect-[3/2]'} ${
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
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/90 text-white font-medium shadow-lg ${isCompact ? 'text-xs px-2 py-1' : 'text-sm'}`}>
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

      {/* Info — moved to TOP for audio-preview sound cards so it stops covering the player */}
      {isSoundSection && hasAudioPreview ? (
        <div className={`absolute top-0 left-0 right-0 pointer-events-none ${isCompact ? 'p-2.5 pr-10' : 'p-3 pr-12'}`}>
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
          card is decodable without relying on icon color alone. */}
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

      {/* Download button overlay — top right with backdrop */}
      <div className="absolute top-2 right-2">
        {installed ? (
          <span
            className={`flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm ring-1 ring-black/60 shadow-md text-state-success ${isCompact ? 'w-7 h-7 text-sm' : 'w-8 h-8 text-base'}`}
            title="Installed"
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
            className={`flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm ring-1 ring-black/60 shadow-md text-accent hover:bg-accent hover:text-black hover:ring-black/70 transition-all cursor-pointer ${isCompact ? 'w-7 h-7' : 'w-8 h-8'}`}
            title="Install"
          >
            <Download className={isCompact ? 'w-4 h-4' : 'w-5 h-5'} />
          </button>
        )}
      </div>
    </div>
  );
}

