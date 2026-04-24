import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, RefreshCw, AlertTriangle, Search, X } from 'lucide-react';
import { browseMods, getModDetails, downloadMod } from '../../lib/api';
import { getModThumbnail, getPrimaryFile, formatDate, isModOutdated } from '../../types/gamebanana';
import type { CachedMod } from '../../types/electron';
import type { GameBananaMod } from '../../types/gamebanana';
import ModThumbnail from '../ModThumbnail';
import { Skeleton } from '../common/Skeleton';
import { useAppStore } from '../../stores/appStore';

interface DownloadableSkinsSectionProps {
  categoryId: number;
  installedModIds: number[];
  hideNsfwPreviews: boolean;
  onDownloadComplete: () => void;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

function mapCachedMod(mod: CachedMod): GameBananaMod {
  const thumbnailUrl = mod.thumbnailUrl ?? undefined;
  const lastSlash = thumbnailUrl ? thumbnailUrl.lastIndexOf('/') : -1;
  const baseUrl = lastSlash > 0 ? thumbnailUrl?.slice(0, lastSlash) : undefined;
  const file = lastSlash > 0 ? thumbnailUrl?.slice(lastSlash + 1) : undefined;

  return {
    id: mod.id,
    name: mod.name,
    profileUrl: mod.profileUrl,
    dateAdded: mod.dateAdded,
    dateModified: mod.dateModified,
    hasFiles: mod.hasFiles,
    likeCount: mod.likeCount,
    viewCount: mod.viewCount,
    nsfw: mod.isNsfw,
    rootCategory: mod.categoryId ? { id: mod.categoryId, name: mod.categoryName || '' } : undefined,
    submitter: mod.submitterName
      ? { id: mod.submitterId || 0, name: mod.submitterName }
      : undefined,
    previewMedia:
      baseUrl && file
        ? { images: [{ baseUrl, file, file530: file }] }
        : undefined,
  };
}

export default function DownloadableSkinsSection({
  categoryId,
  installedModIds,
  hideNsfwPreviews,
  onDownloadComplete,
}: DownloadableSkinsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [mods, setMods] = useState<GameBananaMod[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<{ modId: number; fileId: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [query, setQuery] = useState('');

  const hideOutdated = useAppStore((s) => s.settings?.hideOutdatedMods) ?? false;

  // Track categoryId to reset on change
  const prevCategoryRef = useRef(categoryId);

  // Reset when category changes
  useEffect(() => {
    if (prevCategoryRef.current !== categoryId) {
      prevCategoryRef.current = categoryId;
      setExpanded(false);
      setMods([]);
      setLoadState('idle');
      setError(null);
      setQuery('');
    }
  }, [categoryId]);

  const installedSet = useMemo(() => new Set(installedModIds), [installedModIds]);

  const availableMods = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    return mods.filter((mod) => {
      if (installedSet.has(mod.id)) return false;
      if (hideOutdated && mod.dateModified && isModOutdated(mod.dateModified)) return false;
      if (trimmedQuery && !mod.name.toLowerCase().includes(trimmedQuery)) return false;
      return true;
    });
  }, [mods, installedSet, hideOutdated, query]);

  const rawAvailableCount = useMemo(
    () => mods.filter((m) => !installedSet.has(m.id)).length,
    [mods, installedSet]
  );
  const filteredOutCount = rawAvailableCount - availableMods.length;

  const loadMods = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    setMods([]);

    const seenIds = new Set<number>();
    const collectedMods: GameBananaMod[] = [];

    const addMods = (incoming: GameBananaMod[]) => {
      for (const mod of incoming) {
        if (!seenIds.has(mod.id)) {
          seenIds.add(mod.id);
          collectedMods.push(mod);
        }
      }
    };

    try {
      // Check if we should use local cache
      let useLocalCache = false;
      try {
        const count = await window.electronAPI.getLocalModCount('Mod');
        useLocalCache = count > 0;
      } catch {
        // Fall back to API
      }

      if (useLocalCache) {
        // Fetch from local cache
        const limit = 100;
        let offset = 0;
        let totalCount = Infinity;
        let pages = 0;

        while (offset < totalCount && pages < 200) {
          const result = await window.electronAPI.searchLocalMods({
            section: 'Mod',
            categoryId,
            sortBy: 'likes',
            limit,
            offset,
          });

          totalCount = result.totalCount ?? Infinity;
          addMods(result.mods.map(mapCachedMod));

          offset += limit;
          pages++;

          if (result.mods.length === 0) break;
        }

        // If local cache returned nothing, fall back to API
        if (collectedMods.length === 0) {
          await fetchFromApi();
        }
      } else {
        await fetchFromApi();
      }

      async function fetchFromApi() {
        const perPage = 50;
        let page = 1;
        let totalCount = Infinity;

        while (page <= 100 && (page - 1) * perPage < totalCount) {
          const response = await browseMods(page, perPage, undefined, 'Mod', categoryId, 'popular');
          totalCount = response.totalCount ?? Infinity;
          addMods(response.records);

          if (response.isComplete || response.records.length === 0) break;
          page++;
        }
      }

      setMods(collectedMods);
      setLoadState('loaded');
    } catch (err) {
      console.error('Failed to load mods:', err);
      setError(err instanceof Error ? err.message : String(err));
      setLoadState('error');
    }
  }, [categoryId]);

  // Load when first expanded
  useEffect(() => {
    if (expanded && loadState === 'idle') {
      loadMods();
    }
  }, [expanded, loadState, loadMods]);

  // Download event listeners
  useEffect(() => {
    const progressUnsub = window.electronAPI.onDownloadProgress((data) => {
      if (downloading && data.modId === downloading.modId && data.fileId === downloading.fileId) {
        const percent = data.total > 0 ? Math.round((data.downloaded / data.total) * 100) : 0;
        setDownloadProgress(percent);
      }
    });

    const extractingUnsub = window.electronAPI.onDownloadExtracting((data) => {
      if (downloading && data.modId === downloading.modId && data.fileId === downloading.fileId) {
        setExtracting(true);
      }
    });

    const completeUnsub = window.electronAPI.onDownloadComplete((data) => {
      if (downloading && data.modId === downloading.modId && data.fileId === downloading.fileId) {
        setMods((prev) => prev.filter((m) => m.id !== downloading.modId));
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
        onDownloadComplete();
      }
    });

    return () => {
      progressUnsub();
      extractingUnsub();
      completeUnsub();
    };
  }, [downloading, onDownloadComplete]);

  const startDownload = useCallback(
    async (modId: number, file: { id: number; fileName: string }) => {
      try {
        setDownloading({ modId, fileId: file.id });
        setDownloadProgress(0);
        setExtracting(false);

        await downloadMod(modId, file.id, file.fileName, 'Mod', categoryId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
      }
    },
    [categoryId]
  );

  const initiateDownload = useCallback(
    async (mod: GameBananaMod) => {
      if (downloading) return;

      try {
        setError(null);
        // Set a temp loading state for this mod if needed, but for now we rely on the button being disabled
        // actually we can't easily show loading on the specific button during fetch without new state
        // but it's usually fast.

        console.log('[initiateDownload] Fetching details for mod:', mod.id);
        const details = await getModDetails(mod.id, 'Mod');
        console.log('[initiateDownload] Files found:', details.files?.length);

        if (!details.files || details.files.length === 0) {
          setError('No downloadable files');
          return;
        }

        const file = getPrimaryFile(details.files);
        console.log('[initiateDownload] Downloading primary file:', file.id);
        startDownload(mod.id, file);
      } catch (err) {
        console.error('[initiateDownload] Error:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [downloading, startDownload]
  );

  const handleRetry = () => {
    setLoadState('idle');
    setError(null);
    loadMods();
  };

  return (
    <>
      <div className="border-t border-border pt-3 mt-3">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          Download More
        </button>
      </div>

      {expanded && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setExpanded(false)}
        >
          <div
            className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-semibold text-text-primary">Download More Skins</h2>
                {loadState === 'loaded' && (
                  <span className="text-xs text-text-secondary ml-2">
                    {availableMods.length}
                    {filteredOutCount > 0 ? ` of ${rawAvailableCount}` : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search skins…"
                  autoFocus
                  className="w-full pl-9 pr-9 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent/60"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {hideOutdated && filteredOutCount > 0 && (
                <div className="mt-1.5 text-[11px] text-text-secondary">
                  {filteredOutCount} outdated skin{filteredOutCount === 1 ? '' : 's'} hidden by your Settings preference.
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {loadState === 'loading' && (
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
                  aria-busy="true"
                  aria-live="polite"
                >
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-2 p-2 bg-bg-tertiary rounded-lg border border-transparent"
                    >
                      <Skeleton className="aspect-video w-full" rounded="md" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-2.5 w-1/3" />
                        <Skeleton className="h-2.5 w-1/4" />
                      </div>
                      <Skeleton className="h-7 w-full" rounded="md" />
                    </div>
                  ))}
                </div>
              )}

              {loadState === 'error' && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <div className="text-sm text-red-400 max-w-md">{error || 'Failed to load'}</div>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-bg-tertiary hover:bg-bg-secondary text-sm transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                  </button>
                </div>
              )}

              {loadState === 'loaded' && availableMods.length === 0 && (
                <div className="text-sm text-text-secondary text-center py-12">
                  {rawAvailableCount === 0
                    ? 'No additional skins available for this hero.'
                    : query.trim()
                      ? `No matches for "${query.trim()}"${filteredOutCount > 0 ? ` (${filteredOutCount} hidden by filters)` : ''}.`
                      : `All ${rawAvailableCount} available skins are hidden by your filters.`}
                </div>
              )}

              {loadState === 'loaded' && availableMods.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {availableMods.map((mod) => {
                    const isDownloading = downloading?.modId === mod.id;
                    return (
                      <div
                        key={mod.id}
                        className="flex flex-col gap-2 p-2 bg-bg-tertiary rounded-lg border border-transparent hover:border-accent/40 transition-colors"
                      >
                        <div className="aspect-video rounded-md overflow-hidden bg-black/30">
                          <ModThumbnail
                            src={getModThumbnail(mod)}
                            alt={mod.name}
                            nsfw={mod.nsfw}
                            hideNsfw={hideNsfwPreviews}
                            className="w-full h-full"
                          />
                        </div>
                        <div className="text-sm font-medium leading-tight line-clamp-2 min-h-[2.5rem]" title={mod.name}>
                          {mod.name}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-text-secondary">
                          <span>{mod.submitter?.name ?? ''}</span>
                          {mod.dateModified > 0 && (
                            <span
                              className={
                                isModOutdated(mod.dateModified)
                                  ? 'text-yellow-400 flex items-center gap-1'
                                  : ''
                              }
                            >
                              {isModOutdated(mod.dateModified) && (
                                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                              )}
                              {formatDate(mod.dateModified)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => initiateDownload(mod)}
                          disabled={downloading !== null}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors cursor-pointer"
                        >
                          {isDownloading ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              {extracting
                                ? 'Extracting'
                                : downloadProgress !== null
                                  ? `${downloadProgress}%`
                                  : 'Starting'}
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5" />
                              Install
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
