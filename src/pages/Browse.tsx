import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Loader2,
  Download,
  Eye,
  ThumbsUp,
  ChevronLeft,
  ChevronRight,
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
import { listen } from '@tauri-apps/api/event';
import ModThumbnail from '../components/ModThumbnail';

const DEFAULT_PER_PAGE = 12;
const FETCH_ALL_PER_PAGE = 50;
const CACHE_TTL_MS = 10 * 60 * 1000;
type SortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';
type ViewMode = 'grid' | 'compact' | 'list';
const SECTION_WHITELIST = new Set(['Mod', 'Sound']);

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
  const { settings, loadMods, mods: installedMods } = useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [mods, setMods] = useState<GameBananaMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [sort, setSort] = useState<SortOption>('default');
  const [sections, setSections] = useState<GameBananaSection[]>([]);
  const [section, setSection] = useState('Mod');
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>([]);
  const [heroCategoryId, setHeroCategoryId] = useState<number | 'all'>('all');
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [forceFullFetch, setForceFullFetch] = useState(true);
  const [selectedMod, setSelectedMod] = useState<GameBananaModDetails | null>(null);
  const [downloading, setDownloading] = useState<{ modId: number; fileId: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [isFullResult, setIsFullResult] = useState(false);
  const cacheRef = useRef<
    Map<string, { records: GameBananaMod[]; totalCount: number; timestamp: number }>
  >(new Map());

  const cacheKey = [
    section,
    search.trim().toLowerCase() || '__all__',
    categoryId === 'all' ? 'all' : String(categoryId),
    heroCategoryId === 'all' ? 'all' : String(heroCategoryId),
  ].join('::');

  const effectiveCategoryId =
    heroCategoryId === 'all' ? (categoryId === 'all' ? undefined : categoryId) : heroCategoryId;
  const fetchMods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (
        forceFullFetch ||
        sort !== 'default' ||
        heroCategoryId !== 'all' ||
        categoryId !== 'all'
      ) {
        if (page !== 1) {
          setLoading(false);
          return;
        }

        const cached = cacheRef.current.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
          setMods(cached.records);
          setTotalCount(cached.totalCount);
          setIsFullResult(true);
          setLoading(false);
          return;
        }

        const first = await browseMods(
          1,
          FETCH_ALL_PER_PAGE,
          search || undefined,
          section,
          effectiveCategoryId
        );
        const allRecords = [...first.records];
        const totalPages = Math.ceil(first.totalCount / FETCH_ALL_PER_PAGE);

        if (totalPages > 1) {
          const requests = [];
          for (let i = 2; i <= totalPages; i += 1) {
            requests.push(
              browseMods(i, FETCH_ALL_PER_PAGE, search || undefined, section, effectiveCategoryId)
            );
          }
          const results = await Promise.all(requests);
          results.forEach((result) => {
            allRecords.push(...result.records);
          });
        }

        setMods(allRecords);
        setTotalCount(first.totalCount);
        cacheRef.current.set(cacheKey, {
          records: allRecords,
          totalCount: first.totalCount,
          timestamp: Date.now(),
        });
        setIsFullResult(true);
      } else {
        const response = await browseMods(
          page,
          perPage,
          search || undefined,
          section,
          effectiveCategoryId
        );
        setMods(response.records);
        setTotalCount(response.totalCount);
        setIsFullResult(false);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [
    page,
    search,
    sort,
    section,
    categoryId,
    heroCategoryId,
    perPage,
    forceFullFetch,
    cacheKey,
    effectiveCategoryId,
  ]);

  useEffect(() => {
    setPage(1);
  }, [search, sort, section, categoryId, heroCategoryId, perPage, forceFullFetch]);

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
    fetchMods();
  }, [fetchMods]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
  }, [activeDeadlockPath, loadMods]);

  useEffect(() => {
    const unlistenProgress = listen<{ modId: number; fileId: number; downloaded: number; total: number }>(
      'download-progress',
      (event) => {
        if (
          downloading &&
          event.payload.modId === downloading.modId &&
          event.payload.fileId === downloading.fileId
        ) {
          setDownloadProgress({
            downloaded: event.payload.downloaded,
            total: event.payload.total,
          });
        }
      }
    );

    const unlistenExtracting = listen<{ modId: number; fileId: number }>(
      'download-extracting',
      (event) => {
        if (
          downloading &&
          event.payload.modId === downloading.modId &&
          event.payload.fileId === downloading.fileId
        ) {
          setExtracting(true);
        }
      }
    );

    const unlistenComplete = listen<{ modId: number; fileId: number }>(
      'download-complete',
      (event) => {
        if (
          downloading &&
          event.payload.modId === downloading.modId &&
          event.payload.fileId === downloading.fileId
        ) {
          setDownloading(null);
          setDownloadProgress(null);
          setExtracting(false);
          loadMods(); // Refresh installed mods
        }
      }
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenExtracting.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, [downloading, loadMods]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };
  const handleRefresh = () => {
    cacheRef.current.delete(cacheKey);
    setPage(1);
    fetchMods();
  };
  const handleFullFetchToggle = () => {
    cacheRef.current.delete(cacheKey);
    setForceFullFetch((value) => !value);
    setPage(1);
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
    return flattenCategories(categories, '', { excludeIds: heroIds, includeEmpty: false });
  }, [categories, heroOptions]);

  const sortedMods = useMemo(() => {
    const filtered = mods.filter((mod) => {
      const searchMatch =
        search.trim() === '' ? true : mod.name.toLowerCase().includes(search.trim().toLowerCase());
      return searchMatch;
    });
    const sorted = [...filtered];
    switch (sort) {
      case 'popular':
        sorted.sort((a, b) => b.likeCount - a.likeCount);
        break;
      case 'recent':
        sorted.sort((a, b) => b.dateAdded - a.dateAdded);
        break;
      case 'updated':
        sorted.sort((a, b) => b.dateModified - a.dateModified);
        break;
      case 'views':
        sorted.sort((a, b) => b.viewCount - a.viewCount);
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        break;
    }
    return sorted;
  }, [mods, sort, search]);

  const installedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaId === 'number') {
        ids.add(mod.gameBananaId);
      }
    }
    return ids;
  }, [installedMods]);

  const totalPages = Math.max(
    1,
    Math.ceil((isFullResult ? sortedMods.length : totalCount) / perPage)
  );
  const displayMods = isFullResult
    ? sortedMods.slice((page - 1) * perPage, page * perPage)
    : sortedMods;

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
              className="px-4 py-2 bg-bg-tertiary hover:bg-bg-secondary border border-border text-text-primary rounded-lg transition-colors"
              title="Refresh results"
            >
              Refresh
            </button>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-secondary p-1">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode('compact')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  viewMode === 'compact'
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Compact
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  viewMode === 'list'
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
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent appearance-none"
            >
              <option value={12}>12 / page</option>
              <option value={24}>24 / page</option>
              <option value={36}>36 / page</option>
              <option value={48}>48 / page</option>
            </select>
            <button
              type="button"
              onClick={handleFullFetchToggle}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                forceFullFetch
                  ? 'bg-bg-tertiary border-accent text-text-primary'
                  : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary'
              }`}
              title="Load all pages to improve category coverage"
            >
              {forceFullFetch ? 'Use Paging' : 'Load All'}
            </button>
          </div>
        </form>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">
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
                viewMode={viewMode}
                section={section}
                hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
                onClick={() => handleModClick(mod)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 p-4 border-t border-border">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Mod Details Modal */}
      {selectedMod && (
        <ModDetailsModal
          mod={selectedMod}
          installed={installedIds.has(selectedMod.id)}
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
  viewMode: ViewMode;
  section: string;
  hideNsfwPreviews: boolean;
  onClick: () => void;
}

function ModCard({ mod, installed, viewMode, section, hideNsfwPreviews, onClick }: ModCardProps) {
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  const isCompact = viewMode === 'compact';
  const isList = viewMode === 'list';

  return (
    <button
      onClick={onClick}
      className={`bg-bg-secondary border border-border rounded-lg overflow-hidden hover:border-accent/50 transition-colors text-left ${
        isList ? 'flex items-center gap-4 p-3' : ''
      }`}
    >
      {/* Thumbnail */}
      <div
        className={`bg-bg-tertiary ${
          isList
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
          {installed && (
            <span
              className={`rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400 ${
                isCompact ? 'text-[9px]' : ''
              }`}
            >
              Installed
            </span>
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
  downloadingFileId: number | null;
  extracting: boolean;
  progress: { downloaded: number; total: number } | null;
  onClose: () => void;
  onDownload: (fileId: number, fileName: string) => void;
}

function ModDetailsModal({
  mod,
  installed,
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
                        {installed ? 'Reinstall' : 'Install'}
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
