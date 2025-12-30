import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, Download, Loader2, RefreshCw } from 'lucide-react';
import { browseMods, getModDetails, downloadMod } from '../../lib/api';
import { getModThumbnail, getPrimaryFile } from '../../types/gamebanana';
import type { CachedMod } from '../../types/electron';
import type { GameBananaMod } from '../../types/gamebanana';
import ModThumbnail from '../ModThumbnail';

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

    }
  }, [categoryId]);

  // Filter out installed mods from display (use Set internally for O(1) lookup)
  const installedSet = new Set(installedModIds);
  const availableMods = mods.filter((mod) => !installedSet.has(mod.id));

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
    [downloading]
  );

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

  const handleRetry = () => {
    setLoadState('idle');
    setError(null);
    loadMods();
  };

  return (
    <div className="border-t border-border pt-3 mt-3 relative">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <ChevronDown
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
        <span>Download More</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {loadState === 'loading' && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
            </div>
          )}

          {loadState === 'error' && (
            <div className="flex items-center justify-between text-xs text-red-400">
              <span>{error || 'Failed to load'}</span>
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-1 px-2 py-1 hover:bg-bg-tertiary rounded transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </button>
            </div>
          )}

          {loadState === 'loaded' && availableMods.length === 0 && (
            <div className="text-xs text-text-secondary text-center py-2">
              No additional skins available
            </div>
          )}

          {loadState === 'loaded' && availableMods.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {availableMods.map((mod) => {
                const isDownloading = downloading?.modId === mod.id;
                return (
                  <div
                    key={mod.id}
                    className="flex flex-col gap-1.5 p-2 bg-bg-tertiary rounded-lg"
                  >
                    <div className="aspect-video rounded overflow-hidden bg-black/20">
                      <ModThumbnail
                        src={getModThumbnail(mod)}
                        alt={mod.name}
                        nsfw={mod.nsfw}
                        hideNsfw={hideNsfwPreviews}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="text-xs font-medium truncate" title={mod.name}>
                      {mod.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => initiateDownload(mod)}
                      disabled={downloading !== null}
                      className="flex items-center justify-center gap-1 px-2 py-1 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors"
                    >
                      {isDownloading ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {extracting
                            ? 'Extracting'
                            : downloadProgress !== null
                              ? `${downloadProgress}%`
                              : 'Starting'}
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3" />
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
      )}
    </div>
  );
}
