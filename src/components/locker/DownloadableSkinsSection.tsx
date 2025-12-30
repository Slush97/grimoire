import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { browseMods, getModDetails, downloadMod } from '../../lib/api';
import { getModThumbnail } from '../../types/gamebanana';
import type { CachedMod } from '../../types/electron';
import type { GameBananaMod } from '../../types/gamebanana';
import ModThumbnail from '../ModThumbnail';

interface DownloadableSkinsSectionProps {
  categoryId: number;
  installedModIds: Set<number>;
  hideNsfwPreviews: boolean;
  onDownloadComplete: () => void;
}

export default function DownloadableSkinsSection({
  categoryId,
  installedModIds,
  hideNsfwPreviews,
  onDownloadComplete,
}: DownloadableSkinsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [mods, setMods] = useState<GameBananaMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<{ modId: number; fileId: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [useLocalCache, setUseLocalCache] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const checkLocalCache = async () => {
      try {
        const count = await window.electronAPI.getLocalModCount('Mod');
        if (active) {
          setUseLocalCache(count > 0);
        }
      } catch {
        if (active) {
          setUseLocalCache(false);
        }
      }
    };
    checkLocalCache();
    return () => {
      active = false;
    };
  }, []);

  const mapCachedMod = useCallback(
    (mod: CachedMod): GameBananaMod => {
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
            ? {
                images: [{ baseUrl, file, file530: file }],
              }
            : undefined,
      };
    },
    []
  );

  // Load mods when first expanded
  useEffect(() => {
    if (expanded && !hasLoaded && !loading && useLocalCache !== null) {
      let active = true;
      const loadMods = async () => {
        setLoading(true);
        setError(null);
        try {
          const all: GameBananaMod[] = [];
          if (useLocalCache) {
            const limit = 100;
            let offset = 0;
            let totalCount = Number.POSITIVE_INFINITY;
            let page = 0;

            while (offset < totalCount) {
              const result = await window.electronAPI.searchLocalMods({
                section: 'Mod',
                categoryId,
                sortBy: 'likes',
                limit,
                offset,
              });
              totalCount = result.totalCount ?? totalCount;
              all.push(...result.mods.map(mapCachedMod));
              offset += result.limit;
              page += 1;
              if (result.mods.length === 0 || offset >= totalCount || page > 200) {
                break;
              }
            }
          } else {
            const perPage = 50;
            let page = 1;
            let done = false;
            let totalCount = Number.POSITIVE_INFINITY;

            while (!done) {
              const response = await browseMods(page, perPage, undefined, 'Mod', categoryId, 'popular');
              all.push(...response.records);
              totalCount = response.totalCount ?? totalCount;
              page += 1;
              done =
                response.isComplete ||
                response.records.length === 0 ||
                all.length >= totalCount ||
                page > 100;
            }
          }

          if (!active) return;
          // Filter out already installed mods
          const available = all.filter((mod) => !installedModIds.has(mod.id));
          setMods(available);
          setHasLoaded(true);
        } catch (err) {
          if (active) {
            setError(String(err));
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      };
      loadMods();
      return () => {
        active = false;
      };
    }
  }, [expanded, hasLoaded, loading, categoryId, installedModIds, useLocalCache, mapCachedMod]);

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
        // Remove from available list
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

  const handleDownload = useCallback(
    async (mod: GameBananaMod) => {
      if (downloading) return;

      try {
        setError(null);
        const details = await getModDetails(mod.id, 'Mod');
        if (!details.files || details.files.length === 0) {
          setError('No downloadable files');
          return;
        }

        const file = details.files[0];
        setDownloading({ modId: mod.id, fileId: file.id });
        setDownloadProgress(0);
        setExtracting(false);

        await downloadMod(mod.id, file.id, file.fileName, 'Mod', categoryId);
      } catch (err) {
        setError(String(err));
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
      }
    },
    [downloading, categoryId]
  );

  return (
    <div className="border-t border-border pt-3 mt-3">
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
          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          {!loading && !error && mods.length === 0 && hasLoaded && (
            <div className="text-xs text-text-secondary text-center py-2">
              No additional skins available
            </div>
          )}

          {!loading && mods.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {mods.map((mod) => {
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
                      onClick={() => handleDownload(mod)}
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
