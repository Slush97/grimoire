import { useEffect, useState } from 'react';
import {
  Volume2,
  Loader2,
  Download,
  MessageSquare,
  ExternalLink,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import type { GameBananaModDetails, GameBananaComment } from '../types/gamebanana';
import { isModOutdated, formatDate } from '../types/gamebanana';
import { getModComments } from '../lib/api';
import ModThumbnail from './ModThumbnail';
import AudioPreviewPlayer from './AudioPreviewPlayer';

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

  const actionLabel = (fileId: number) => {
    if (updateAvailable && installedFileIds.has(fileId)) return 'Update';
    if (installedFileIds.has(fileId)) return 'Reinstall';
    return 'Install';
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-bg-secondary border-b border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-xl font-bold truncate">{mod.name}</h2>
            {updateAvailable && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                Update Available
              </span>
            )}
            {installed && !updateAvailable && (
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400">
                Installed
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {dateModified && isModOutdated(dateModified) && (
          <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-200 text-sm">
            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            <span>This mod was last updated on {formatDate(dateModified)} and may not be compatible with the current version of Deadlock.</span>
          </div>
        )}

        <div className="p-4 space-y-4">
          {(dateAdded || dateModified) && (
            <div className="flex items-center gap-4 text-xs text-text-secondary">
              {dateAdded && dateAdded > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Added: {formatDate(dateAdded)}
                </span>
              )}
              {dateModified && dateModified > 0 && (
                <span className={`flex items-center gap-1 ${isModOutdated(dateModified) ? 'text-yellow-400' : ''}`}>
                  <Clock className="w-3 h-3" />
                  Updated: {formatDate(dateModified)}
                </span>
              )}
            </div>
          )}

          {images.length > 0 && (
            <div className="relative w-full rounded-lg overflow-hidden border border-border">
              <div className="relative">
                <ModThumbnail
                  src={currentImageUrl}
                  alt={`${mod.name} - Image ${currentImageIndex + 1}`}
                  nsfw={mod.nsfw}
                  hideNsfw={hideNsfwPreviews}
                  className={`w-full max-h-[60vh] object-contain bg-bg-tertiary transition-opacity duration-200 ${imageLoading ? 'opacity-40' : 'opacity-100'}`}
                />
                {/* Hidden probe img drives the load/error signal without
                    requiring ModThumbnail to expose onLoad. The ref callback
                    checks img.complete on attach so already-cached images
                    never flash the loading overlay. */}
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
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="flex items-center gap-2 rounded-full bg-black/60 backdrop-blur-sm px-3 py-1.5 text-xs text-white/90 border border-white/10 shadow animate-fade-in">
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      Loading image…
                    </div>
                  </div>
                )}
              </div>

              {images.length > 1 && (
                <>
                  <button
                    onClick={goToPrevious}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors cursor-pointer"
                    aria-label="Previous image"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={goToNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white transition-colors cursor-pointer"
                    aria-label="Next image"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentImageIndex(index)}
                        className={`w-2 h-2 rounded-full transition-colors cursor-pointer ${index === currentImageIndex
                          ? 'bg-white'
                          : 'bg-white/40 hover:bg-white/60'
                          }`}
                        aria-label={`Go to image ${index + 1}`}
                      />
                    ))}
                  </div>

                  <div className="absolute top-2 right-2 px-2 py-1 rounded bg-black/50 text-white/80 text-xs">
                    {currentImageIndex + 1} / {images.length}
                  </div>
                </>
              )}
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
            <div className="text-sm text-text-secondary">
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mod.description) }} />
            </div>
          )}

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
                    className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors ml-4 cursor-pointer"
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
                        {actionLabel(file.id)}
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="font-medium flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Comments {commentsTotalCount > 0 && <span className="text-xs text-text-secondary">({commentsTotalCount})</span>}
            </h3>
            {commentsLoading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading comments...
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-text-secondary py-2">No comments yet</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3 p-3 bg-bg-tertiary rounded-lg">
                    {comment.poster.avatarUrl && (
                      <img
                        src={comment.poster.avatarUrl}
                        alt={comment.poster.name}
                        className="w-8 h-8 rounded-full flex-shrink-0"
                      />
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
