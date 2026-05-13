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
  Power,
  Maximize2,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import type { GameBananaModDetails, GameBananaComment } from '../types/gamebanana';
import { isModOutdated, formatDate } from '../types/gamebanana';
import { getModComments } from '../lib/api';
import AudioPreviewPlayer from './AudioPreviewPlayer';
import { Skeleton } from './common/Skeleton';

interface ModDetailsModalProps {
  mod: GameBananaModDetails;
  section: string;
  installed: boolean;
  installedFileIds: Set<number>;
  /** GameBanana file id of the currently-enabled variant, when any. The file
   *  row with this id gets an "Active" badge so the user can see which of
   *  several installed variants is the one actually loaded. Browse uses null
   *  (it has no notion of which variant is active across the whole library). */
  activeFileId?: number | null;
  /** Per-file local install state, keyed by GameBanana file id. When provided
   *  (Browse only — Installed leaves this undefined), an installed-but-disabled
   *  file row shows an inline "Enable" pill so the user can flip it on without
   *  leaving the Browse tab after downloading. */
  installedFileStates?: Map<number, { modId: string; enabled: boolean }>;
  /** Handler invoked when the user clicks the inline "Enable" pill. Receives
   *  the local mod id of the disabled install. */
  onEnableFile?: (modId: string) => void;
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
  activeFileId = null,
  installedFileStates,
  onEnableFile,
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
  // Cursor into the images array — only the lightbox cares about this now
  // that previews are stacked vertically rather than swapped via carousel.
  // It tracks which image is currently zoomed and which one keyboard arrows
  // step through while the lightbox is open.
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [comments, setComments] = useState<GameBananaComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsTotalCount, setCommentsTotalCount] = useState(0);
  // Lightbox state — when true, the selected image renders full-screen at
  // its native GB resolution so the user can inspect detail the inline
  // preview hides.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Per-image natural aspect ratio, captured on load so each preview slot
  // can size to its real proportions instead of being forced into 16:9
  // (which letterboxed portraits and chopped UI screenshots).
  const [imageRatios, setImageRatios] = useState<Record<number, number>>({});

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
      if (e.key === 'Escape') {
        // Lightbox eats ESC before the modal does, so users can dismiss the
        // zoomed view without losing their place on the detail card.
        if (lightboxOpen) {
          setLightboxOpen(false);
        } else {
          onClose();
        }
      }
      // Arrow keys only navigate while the lightbox is open — otherwise
      // they'd silently mutate hidden state while the user scrolls the
      // description with the cursor.
      if (lightboxOpen && images.length > 1) {
        if (e.key === 'ArrowLeft') goToPrevious();
        if (e.key === 'ArrowRight') goToNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, images.length, lightboxOpen]);

  const currentImage = images[currentImageIndex];
  // The lightbox loads the original GB asset for detail inspection.
  // The inline stack uses file530 per image directly via raw <img> tags so
  // each thumb can render and load independently as the user scrolls.
  const currentImageFullUrl = currentImage
    ? `${currentImage.baseUrl}/${currentImage.file}`
    : undefined;

  const openLightboxAt = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  };

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
        className="relative bg-bg-secondary rounded-xl w-full max-w-4xl lg:max-w-6xl max-h-[90vh] overflow-hidden flex flex-col border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — single row. Status badges, category, title, and dense
            metadata cluster all fit on one line so the modal's vertical
            budget goes to content, not chrome. Title shrinks/truncates
            first when space gets tight; metadata hides on narrow screens. */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            {updateAvailable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent border border-accent/40">
                <Download className="w-2.5 h-2.5" />
                Update
              </span>
            )}
            {installed && !updateAvailable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400 border border-green-500/40">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Installed
              </span>
            )}
            {outdated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-400 border border-yellow-500/40">
                <AlertTriangle className="w-2.5 h-2.5" />
                Outdated
              </span>
            )}
            {mod.category?.name && (
              <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary border border-border">
                {mod.category.name}
              </span>
            )}
          </div>
          <h2 className="text-lg lg:text-xl font-bold leading-tight truncate min-w-0 flex-1" title={mod.name}>
            {mod.name}
          </h2>
          {(() => {
            // Hide the modified date when it formats to the same day as the
            // added date — common for fresh uploads where both timestamps
            // fall on the same calendar day, which makes the header read
            // "5/12/2026 5/12/2026".
            const addedStr = dateAdded && dateAdded > 0 ? formatDate(dateAdded) : null;
            const modifiedStr = dateModified && dateModified > 0 ? formatDate(dateModified) : null;
            const showModified = modifiedStr !== null && modifiedStr !== addedStr;
            if (!addedStr && !showModified && totalDownloads === 0) return null;
            return (
              <div className="hidden md:flex items-center gap-3 text-xs text-text-secondary flex-shrink-0">
                {addedStr && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span className="text-text-primary">{addedStr}</span>
                  </span>
                )}
                {showModified && (
                  <span className={`flex items-center gap-1 ${outdated ? 'text-yellow-400' : ''}`}>
                    <Clock className="w-3 h-3" />
                    <span className={outdated ? 'text-yellow-300' : 'text-text-primary'}>{modifiedStr}</span>
                  </span>
                )}
                {totalDownloads > 0 && (
                  <span className="flex items-center gap-1">
                    <Download className="w-3 h-3" />
                    <span className="text-text-primary">{totalDownloads.toLocaleString()}</span>
                  </span>
                )}
              </div>
            );
          })()}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — single scroll on narrow (everything flows top to bottom),
            two independently-scrollable columns on lg+. Independent scroll
            on wide is critical now that previews stack vertically: scrolling
            comments shouldn't drag the image column away, and vice versa. */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
            {/* Image / preview column */}
            <div className="lg:w-[460px] lg:flex-shrink-0 lg:overflow-y-auto lg:max-h-full p-5 lg:pr-3 space-y-3">
              {images.length > 0 ? (
                /* Vertical preview stack — every image renders inline so
                   users scroll naturally to see all of them. Click any one
                   to open the lightbox at that image's index. We use the
                   530px preview here (fast load + sharp on the inline slot)
                   and the original asset in the lightbox. */
                <div className="space-y-3" aria-label="Image previews">
                  {images.map((img, index) => {
                    const previewSrc = `${img.baseUrl}/${img.file530 || img.file}`;
                    const ratio = imageRatios[index];
                    // Pre-load: hold a 16:9 placeholder so the column doesn't
                    // jump as images decode. Post-load: snap to the image's
                    // real aspect ratio so portraits, ultrawides, and UI
                    // screenshots all render at their natural shape — no
                    // letterboxing, no cropping, no blurred fill needed.
                    return (
                      <button
                        key={`${img.baseUrl}/${img.file}`}
                        type="button"
                        onClick={() => openLightboxAt(index)}
                        aria-label={`View image ${index + 1} of ${images.length} full size`}
                        style={{ aspectRatio: ratio ? String(ratio) : '16 / 9' }}
                        className="relative block w-full bg-bg-tertiary rounded-lg overflow-hidden border border-border cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 group"
                      >
                        <img
                          src={previewSrc}
                          alt={`${mod.name} - Image ${index + 1}`}
                          loading="lazy"
                          onLoad={(e) => {
                            const el = e.currentTarget;
                            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                              setImageRatios((prev) =>
                                prev[index] ? prev : { ...prev, [index]: el.naturalWidth / el.naturalHeight }
                              );
                            }
                          }}
                          className={`absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.01] ${
                            mod.nsfw && hideNsfwPreviews ? 'blur-xl scale-110' : ''
                          }`}
                        />
                        {mod.nsfw && hideNsfwPreviews && (
                          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-wide text-white/80 bg-black/40">
                            NSFW preview hidden
                          </div>
                        )}
                        {images.length > 1 && (
                          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white/85 text-[11px] border border-white/10">
                            {index + 1} / {images.length}
                          </div>
                        )}
                        <span className="absolute top-2 right-2 p-1.5 rounded-md bg-black/55 backdrop-blur-sm text-white/80 border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Maximize2 className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : section === 'Sound' && !audioPreviewUrl ? (
                <div className="flex items-center justify-center p-8 rounded-lg border border-border bg-bg-tertiary">
                  <div className="flex flex-col items-center gap-2 text-text-secondary">
                    <Volume2 className="w-12 h-12 text-accent/60" />
                    <span className="text-sm">Sound Mod</span>
                    <span className="text-xs opacity-60">No audio preview available</span>
                  </div>
                </div>
              ) : null}

              {audioPreviewUrl && (
                <div className="relative rounded-lg overflow-hidden border border-border bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Volume2 className="w-4 h-4 text-accent" />
                    <h3 className="font-medium text-sm text-text-primary">Audio Preview</h3>
                  </div>
                  <div className="backdrop-blur-md bg-bg-primary/50 rounded-lg border border-white/10 p-1">
                    <AudioPreviewPlayer
                      src={audioPreviewUrl}
                      className="w-full"
                    />
                  </div>
                </div>
              )}

              {outdated && (
                <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-yellow-200 text-xs">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <span>This mod was last updated on {formatDate(dateModified!)} and may not be compatible with the current Deadlock version.</span>
                </div>
              )}
            </div>

            {/* Content column — description / files / comments / GB link.
                Takes the remaining horizontal space on wide layouts.
                Independently scrollable on lg+ so reading comments or
                installing a file doesn't move the image stack on the left. */}
            <div className="flex-1 min-w-0 lg:overflow-y-auto lg:max-h-full p-5 lg:pl-3 space-y-5">
              {mod.description && (
                <section>
                  <h3 className="font-semibold text-xs uppercase tracking-wide text-text-secondary mb-2">
                    About
                  </h3>
                  <div className="text-sm text-text-primary/90 leading-relaxed [&_p]:mb-2 [&_a]:text-accent [&_a]:hover:underline [&_img]:rounded-md [&_img]:my-2 [&_img]:max-w-full">
                    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mod.description) }} />
                  </div>
                </section>
              )}

              {mod.files && mod.files.length > 0 && (
                <section>
                  <h3 className="font-semibold text-xs uppercase tracking-wide text-text-secondary mb-2">
                    Files {mod.files.length > 1 && <span className="text-text-secondary/70 normal-case tracking-normal">({mod.files.length})</span>}
                  </h3>
                  <div className="space-y-2">
                    {mod.files.map((file) => {
                      const isInstalled = installedFileIds.has(file.id);
                      const isUpdate = updateAvailable && isInstalled;
                      const isActive = activeFileId !== null && activeFileId === file.id;
                      const isDownloadingThis = downloadingFileId === file.id;
                      const installedFileState = installedFileStates?.get(file.id);
                      const showEnablePill =
                        !!installedFileState &&
                        !installedFileState.enabled &&
                        !!onEnableFile &&
                        !isDownloadingThis;
                      const pct = progress && progress.total > 0
                        ? Math.round((progress.downloaded / progress.total) * 100)
                        : null;
                      return (
                        <div
                          key={file.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                            isUpdate
                              ? 'border-accent/40 bg-accent/5'
                              : isActive
                                ? 'border-accent/50 bg-accent/10'
                                : isInstalled
                                  ? 'border-green-500/30 bg-green-500/5'
                                  : 'border-border bg-bg-tertiary'
                          }`}
                        >
                          <div className={`flex-shrink-0 w-10 h-10 rounded-md flex items-center justify-center ${
                            isUpdate
                              ? 'bg-accent/15 text-accent'
                              : isActive
                                ? 'bg-accent/20 text-accent'
                                : isInstalled
                                  ? 'bg-green-500/15 text-green-400'
                                  : 'bg-bg-secondary text-text-secondary'
                          }`}>
                            <FileArchive className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="font-medium truncate text-sm" title={file.fileName}>{file.fileName}</p>
                              {isActive && (
                                <span className="flex-shrink-0 text-[10px] uppercase tracking-wide bg-accent/20 text-accent rounded px-1.5 py-0.5">
                                  Active
                                </span>
                              )}
                            </div>
                            {file.description && (
                              <p className="text-xs text-text-secondary/90 mt-0.5 truncate" title={file.description}>
                                {file.description}
                              </p>
                            )}
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
                          {showEnablePill && installedFileState && (
                            <button
                              onClick={() => onEnableFile!(installedFileState.modId)}
                              disabled={downloadingFileId !== null}
                              title="Enable this mod"
                              className="flex-shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-300 border border-yellow-500/40"
                            >
                              <Power className="w-3.5 h-3.5" />
                              Enable
                            </button>
                          )}
                          <button
                            onClick={() => onDownload(file.id, file.fileName)}
                            disabled={downloadingFileId !== null}
                            className={`flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 min-w-[110px] text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                              isUpdate
                                ? 'border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary'
                                : isInstalled
                                  ? 'bg-bg-secondary hover:bg-bg-primary text-text-primary border border-border'
                                  : 'border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary'
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
                </section>
              )}

              <section>
                <h3 className="font-semibold text-xs uppercase tracking-wide text-text-secondary mb-2 flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Comments {commentsTotalCount > 0 && <span className="normal-case tracking-normal text-text-secondary/70">({commentsTotalCount})</span>}
                </h3>
                {commentsLoading ? (
                  <ul className="divide-y divide-border/60">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <li key={i} className="flex gap-3 py-3 first:pt-0">
                        <Skeleton className="w-7 h-7 flex-shrink-0" rounded="full" />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-2.5 w-16" />
                          </div>
                          <Skeleton className="h-2.5 w-full" />
                          <Skeleton className="h-2.5 w-2/3" />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-text-secondary py-1">No comments yet</p>
                ) : (
                  /* Flat threaded layout — no per-comment card. Files stay
                     as bordered action cards (each is something you DO);
                     comments are conversational content (something you
                     READ), so we strip the boxes and let the avatar + name
                     + divider carry the visual hierarchy instead. */
                  <ul className="divide-y divide-border/60">
                    {comments.map((comment) => (
                      <li key={comment.id} className="flex gap-3 py-3 first:pt-0">
                        {comment.poster.avatarUrl ? (
                          <img
                            src={comment.poster.avatarUrl}
                            alt={comment.poster.name}
                            className="w-7 h-7 rounded-full flex-shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex-shrink-0 bg-bg-tertiary" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="text-sm font-medium text-text-primary">{comment.poster.name}</span>
                            <span className="text-[11px] text-text-tertiary">{formatDate(comment.dateAdded)}</span>
                          </div>
                          <div
                            className="text-sm text-text-primary/90 leading-relaxed [&_p]:mb-1 [&_a]:text-accent [&_a]:hover:underline"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.text) }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

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

      {/* Lightbox overlay — sits above the modal so ESC closes it first.
          Click outside the image dismisses; carousel arrows still work via
          the global keydown listener so users can flip pictures while zoomed. */}
      {lightboxOpen && currentImageFullUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => {
            e.stopPropagation();
            setLightboxOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={`${mod.name} — full size image`}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
            aria-label="Close full size view"
            className="absolute top-4 right-4 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer z-10"
          >
            <X className="w-5 h-5" />
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer z-10"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goToNext(); }}
                aria-label="Next image"
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer z-10"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              <div className="absolute top-4 left-4 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white/90 text-xs border border-white/15">
                {currentImageIndex + 1} / {images.length}
              </div>
            </>
          )}
          <img
            src={currentImageFullUrl}
            alt={`${mod.name} - Image ${currentImageIndex + 1} (full size)`}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
