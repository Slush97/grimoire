import { useEffect, useState } from 'react';
import {
  Volume2,
  Loader2,
  Download,
  MessageSquare,
  ExternalLink,
  AlertTriangle,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  CheckCircle2,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import type { GameBananaModDetails, GameBananaComment } from '../types/gamebanana';
import { isModOutdated, formatDate } from '../types/gamebanana';
import { getModComments } from '../lib/api';
import ModThumbnail from './ModThumbnail';
import AudioPreviewPlayer from './AudioPreviewPlayer';
import { Skeleton } from './common/Skeleton';

interface ModDetailsModalProps {
  mod: GameBananaModDetails;
  section: string;
  installed: boolean;
  installedFileIds: Set<number>;
  downloadingFileId: number | null;
  extracting: boolean;
  progress: { downloaded: number; total: number } | null;
  hideNsfwPreviews: boolean;
  dateAdded?: number;
  dateModified?: number;
  updateAvailable?: boolean;
  onClose: () => void;
  onDownload: (fileId: number, fileName: string) => void;
}

export default function ModDetailsModal({
  mod,
  section,
  installed,
  installedFileIds,
  downloadingFileId,
  extracting,
  progress,
  hideNsfwPreviews,
  dateAdded,
  dateModified,
  updateAvailable,
  onClose,
  onDownload,
}: ModDetailsModalProps) {
  const images = mod.previewMedia?.images ?? [];
  const audioPreviewUrl = mod.previewMedia?.metadata?.audioUrl;
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState(true);
  const [comments, setComments] = useState<GameBananaComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsTotalCount, setCommentsTotalCount] = useState(0);

  // Flip to loading whenever the active image slot changes. The spinner
  // overlay clears when the hidden probe img fires onLoad/onError below.
  useEffect(() => {
    setImageLoading(true);
  }, [currentImageIndex, mod.id]);

  useEffect(() => {
    let cancelled = false;
    setCommentsLoading(true);
    getModComments(mod.id, section)
      .then((res) => {
        if (!cancelled) {
          setComments(res.comments);
          setCommentsTotalCount(res.totalCount);
        }
      })
      .catch((err) => {
        console.error('[ModDetailsModal] Failed to load comments:', err);
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mod.id, section]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (images.length > 1) {
        if (e.key === 'ArrowLeft') goToPrevious();
        if (e.key === 'ArrowRight') goToNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, images.length]);

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

  const actionLabel = (fileId: number) => {
    if (updateAvailable && installedFileIds.has(fileId)) return 'Update';
    if (installedFileIds.has(fileId)) return 'Reinstall';
    return 'Install';
  };

  const totalDownloads = (mod.files ?? []).reduce((sum, f) => sum + f.downloadCount, 0);
  const outdated = dateModified ? isModOutdated(dateModified) : false;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={mod.name}
    >
      <div
        className="relative bg-bg-secondary rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — floats over the hero so it's always reachable */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Hero area: image carousel with title overlay */}
        {images.length > 0 ? (
          <div className="relative w-full aspect-[16/9] max-h-[45vh] bg-black flex-shrink-0 overflow-hidden">
            <ModThumbnail
              src={currentImageUrl}
              alt={`${mod.name} - Image ${currentImageIndex + 1}`}
              nsfw={mod.nsfw}
              hideNsfw={hideNsfwPreviews}
              className={`w-full h-full object-contain transition-opacity duration-200 ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
            />
            {/* Hidden probe img drives load/error signal */}
            {currentImageUrl && (
              <img
                key={currentImageUrl}
                ref={(el) => {
                  if (el && el.complete && el.naturalWidth > 0) {
                    setImageLoading(false);
                  }
                }}
                src={currentImageUrl}
                alt=""
                aria-hidden
                className="hidden"
                onLoad={() => setImageLoading(false)}
                onError={() => setImageLoading(false)}
              />
            )}
            {imageLoading && (
              <Skeleton className="absolute inset-0" rounded="none" />
            )}

            {/* Bottom gradient for title readability */}
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/95 via-black/60 to-transparent pointer-events-none" />

            {/* Carousel controls */}
            {images.length > 1 && (
              <>
                <button
                  onClick={goToPrevious}
                  aria-label="Previous image"
                  className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors cursor-pointer backdrop-blur-sm border border-white/10"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={goToNext}
                  aria-label="Next image"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors cursor-pointer backdrop-blur-sm border border-white/10"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white/90 text-xs border border-white/10">
                  {currentImageIndex + 1} / {images.length}
                </div>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                  {images.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        index === currentImageIndex
                          ? 'w-6 bg-white'
                          : 'w-1.5 bg-white/40 hover:bg-white/60'
                      }`}
                      aria-label={`Go to image ${index + 1}`}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Title + badges overlay */}
            <div className="absolute inset-x-0 bottom-0 p-5 flex items-end justify-between gap-4 z-[5]">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  {updateAvailable && (
                    <span className="rounded-full bg-accent/25 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent border border-accent/40">
                      Update Available
                    </span>
                  )}
                  {installed && !updateAvailable && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/25 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-300 border border-green-500/40">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      Installed
                    </span>
                  )}
                  {outdated && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/25 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-300 border border-yellow-500/40">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Outdated
                    </span>
                  )}
                </div>
                <h2 className="text-2xl font-bold text-white leading-tight drop-shadow-lg truncate">
                  {mod.name}
                </h2>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {updateAvailable && (
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Update Available
                </span>
              )}
              {installed && !updateAvailable && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  Installed
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold">{mod.name}</h2>
          </div>
        )}

        {/* Metadata strip */}
        {(dateAdded || dateModified || totalDownloads > 0) && (
          <div className="flex items-center gap-4 px-5 py-3 border-b border-border bg-bg-primary/30 text-xs text-text-secondary flex-shrink-0 flex-wrap">
            {dateAdded && dateAdded > 0 && (
              <span className="flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Added <span className="text-text-primary">{formatDate(dateAdded)}</span>
              </span>
            )}
            {dateModified && dateModified > 0 && (
              <span className={`flex items-center gap-1.5 ${outdated ? 'text-yellow-400' : ''}`}>
                <Clock className="w-3 h-3" />
                Updated <span className={outdated ? 'text-yellow-300' : 'text-text-primary'}>{formatDate(dateModified)}</span>
              </span>
            )}
            {totalDownloads > 0 && (
              <span className="flex items-center gap-1.5">
                <Download className="w-3 h-3" />
                <span className="text-text-primary">{totalDownloads.toLocaleString()}</span> downloads
              </span>
            )}
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">
            {outdated && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-yellow-200 text-sm">
                <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <span>This mod was last updated on {formatDate(dateModified!)} and may not be compatible with the current version of Deadlock.</span>
              </div>
            )}

            {audioPreviewUrl && (
              <div className="relative rounded-lg overflow-hidden border border-border bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Volume2 className="w-5 h-5 text-accent" />
                  <h3 className="font-medium text-text-primary">Audio Preview</h3>
                </div>
                <div className="flex items-end justify-center gap-0.5 mb-3 h-12">
                  {[3, 5, 8, 12, 16, 20, 16, 12, 18, 14, 10, 6, 9, 14, 18, 14, 11, 7, 4, 6, 10, 14, 18, 14, 8, 5, 3].map((h, i) => (
                    <div
                      key={i}
                      className="w-1.5 bg-accent/50 rounded-full transition-all"
                      style={{ height: `${h * 2}px` }}
                    />
                  ))}
                </div>
                <div className="backdrop-blur-md bg-bg-primary/50 rounded-lg border border-white/10 p-1">
                  <AudioPreviewPlayer
                    src={audioPreviewUrl}
                    className="w-full"
                  />
                </div>
              </div>
            )}

            {section === 'Sound' && !audioPreviewUrl && images.length === 0 && (
              <div className="flex items-center justify-center p-8 rounded-lg border border-border bg-bg-tertiary">
                <div className="flex flex-col items-center gap-2 text-text-secondary">
                  <Volume2 className="w-12 h-12 text-accent/60" />
                  <span className="text-sm">Sound Mod</span>
                  <span className="text-xs opacity-60">No audio preview available</span>
                </div>
              </div>
            )}

            {mod.description && (
              <div className="text-sm text-text-secondary [&_p]:mb-2 [&_a]:text-accent [&_a]:hover:underline [&_img]:rounded-md [&_img]:my-2">
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mod.description) }} />
              </div>
            )}

            {mod.files && mod.files.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm uppercase tracking-wide text-text-secondary">
                  Files {mod.files.length > 1 && <span className="text-text-secondary/70 normal-case tracking-normal">({mod.files.length})</span>}
                </h3>
                <div className="space-y-2">
                  {mod.files.map((file) => {
                    const isInstalled = installedFileIds.has(file.id);
                    const isUpdate = updateAvailable && isInstalled;
                    const isDownloadingThis = downloadingFileId === file.id;
                    const pct = progress && progress.total > 0
                      ? Math.round((progress.downloaded / progress.total) * 100)
                      : null;
                    return (
                      <div
                        key={file.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                          isUpdate
                            ? 'border-accent/40 bg-accent/5'
                            : isInstalled
                              ? 'border-green-500/30 bg-green-500/5'
                              : 'border-border bg-bg-tertiary'
                        }`}
                      >
                        <div className={`flex-shrink-0 w-10 h-10 rounded-md flex items-center justify-center ${
                          isUpdate
                            ? 'bg-accent/15 text-accent'
                            : isInstalled
                              ? 'bg-green-500/15 text-green-400'
                              : 'bg-bg-secondary text-text-secondary'
                        }`}>
                          <FileArchive className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate text-sm" title={file.fileName}>{file.fileName}</p>
                          <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5">
                            <span>{(file.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                            <span className="opacity-50">•</span>
                            <span>{file.downloadCount.toLocaleString()} downloads</span>
                          </div>
                          {isDownloadingThis && pct !== null && (
                            <div className="mt-2 h-1 w-full rounded-full bg-bg-secondary overflow-hidden">
                              <div
                                className="h-full bg-accent transition-all duration-200"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onDownload(file.id, file.fileName)}
                          disabled={downloadingFileId !== null}
                          className={`flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 min-w-[110px] text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                            isUpdate
                              ? 'bg-accent hover:bg-accent-hover text-white'
                              : isInstalled
                                ? 'bg-bg-secondary hover:bg-bg-primary text-text-primary border border-border'
                                : 'bg-accent hover:bg-accent-hover text-white'
                          }`}
                        >
                          {isDownloadingThis ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              {extracting ? 'Extracting…' : pct !== null ? `${pct}%` : 'Starting'}
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4" />
                              {actionLabel(file.id)}
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-text-secondary flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Comments {commentsTotalCount > 0 && <span className="normal-case tracking-normal text-text-secondary/70">({commentsTotalCount})</span>}
              </h3>
              {commentsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex gap-3 p-3 bg-bg-tertiary rounded-lg">
                      <Skeleton className="w-8 h-8 flex-shrink-0" rounded="full" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-2.5 w-16" />
                        </div>
                        <Skeleton className="h-2.5 w-full" />
                        <Skeleton className="h-2.5 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : comments.length === 0 ? (
                <p className="text-sm text-text-secondary py-2">No comments yet</p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {comments.map((comment) => (
                    <div key={comment.id} className="flex gap-3 p-3 bg-bg-tertiary rounded-lg">
                      {comment.poster.avatarUrl ? (
                        <img
                          src={comment.poster.avatarUrl}
                          alt={comment.poster.name}
                          className="w-8 h-8 rounded-full flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex-shrink-0 bg-bg-secondary" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{comment.poster.name}</span>
                          <span className="text-[11px] text-text-secondary">{formatDate(comment.dateAdded)}</span>
                        </div>
                        <div
                          className="text-sm text-text-secondary [&_p]:mb-1 [&_a]:text-accent [&_a]:hover:underline"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.text) }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <a
              href={`https://gamebanana.com/mods/${mod.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-accent hover:text-accent-hover transition-colors text-sm"
            >
              <ExternalLink className="w-4 h-4" />
              View on GameBanana
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
