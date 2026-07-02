import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  Volume2,
  Loader2,
  Download,
  MessageSquare,
  ExternalLink,
  AlertTriangle,
  Clock,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileArchive,
  CheckCircle2,
  Power,
  Maximize2,
  PanelRight,
  BellOff,
  Bell,
  Trash2,
  Coffee,
  Link2,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import type { GameBananaModDetails, GameBananaComment, GameBananaFile, GameBananaModUpdate } from '../types/gamebanana';
import { isModOutdated, formatDate } from '../types/gamebanana';
import { getModComments, getModUpdates } from '../lib/api';
import { useAppStore } from '../stores/appStore';
import AudioPreviewPlayer from './AudioPreviewPlayer';
import { Skeleton } from './common/Skeleton';
import { ArchivedTag, Button, IconButton } from './common/ui';
import ImageContextMenu from './ImageContextMenu';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from './common/menu';
import { showToast } from '../stores/toastStore';

type ModDetailsNavigationDirection = 'previous' | 'next';

interface ModDetailsModalProps {
  mod: GameBananaModDetails;
  section: string;
  installed: boolean;
  installedFileIds: Set<number>;
  /** GameBanana file ids of enabled files, when known. Matching file rows get
   *  an "Active" badge so the user can see what is actually loaded. */
  activeFileIds?: Set<number>;
  /** Per-file local install state, keyed by GameBanana file id. When provided
   *  (Browse only - Installed leaves this undefined), an installed-but-disabled
   *  file row shows an inline "Enable" pill so the user can flip it on without
   *  leaving the Browse tab after downloading. */
  installedFileStates?: Map<number, { modId: string; enabled: boolean }>;
  /** Handler invoked when the user clicks the inline "Enable" pill. Receives
   *  the local mod id of the disabled install. */
  onEnableFile?: (modId: string) => void;
  downloadingFileId: number | null;
  /** GameBanana file ids for this mod that are queued behind the active
   *  download. Their rows show a "Queued" state but other rows stay clickable,
   *  so the user can line up several variants at once. */
  queuedFileIds?: Set<number>;
  extracting: boolean;
  progress: { downloaded: number; total: number } | null;
  hideNsfwPreviews: boolean;
  dateAdded?: number;
  dateModified?: number;
  isNavigating?: boolean;
  navigationDirection?: ModDetailsNavigationDirection;
  navigationLabel?: string;
  updateAvailable?: boolean;
  /** When provided, render a toggle next to the Update/Installed badge that
   *  flips the underlying mod's ignoreUpdates flag. Only meaningful in the
   *  installed-mod path; Browse leaves both undefined. */
  ignoreUpdates?: boolean;
  onToggleIgnoreUpdates?: () => void;
  onClose: () => void;
  onDownload: (fileId: number, fileName: string) => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  previousLabel?: string;
  nextLabel?: string;
  /** Browse-only file removal. Receives the local installed mod id that backs
   *  the GameBanana file row. */
  onDeleteFile?: (modId: string) => Promise<void> | void;
  /** 'modal' (centered overlay, the default) or 'sidebar' (docked right-side
   *  panel that lets the user keep browsing the grid). The sidebar shell
   *  (width, full-height, border) is provided by the caller; this component
   *  fills it and forces a single-column stacked body. */
  variant?: 'modal' | 'sidebar';
  /** When provided, render a dock/pop-out button in the header that switches
   *  between the two presentations. The caller persists the choice. */
  onChangeView?: (view: 'modal' | 'sidebar') => void;
  /** When provided, clicking the artist opens "artist mode" (a grid of all the
   *  artist's mods) instead of their GameBanana profile. */
  onViewArtist?: (artist: { id: number; name: string; avatarUrl?: string; profileUrl?: string; kofiUrl?: string }) => void;
}

function ModDetailsModal({
  mod,
  section,
  installed,
  installedFileIds,
  activeFileIds = new Set<number>(),
  installedFileStates,
  onEnableFile,
  downloadingFileId,
  queuedFileIds = new Set<number>(),
  extracting,
  progress,
  hideNsfwPreviews,
  dateAdded,
  dateModified,
  isNavigating = false,
  navigationDirection = 'next',
  navigationLabel,
  updateAvailable,
  ignoreUpdates,
  onToggleIgnoreUpdates,
  onClose,
  onDownload,
  onNavigatePrevious,
  onNavigateNext,
  previousLabel,
  nextLabel,
  onDeleteFile,
  variant = 'modal',
  onChangeView,
  onViewArtist,
}: ModDetailsModalProps) {
  const { t } = useTranslation();
  // Canonical GameBanana page for this submission. WiPs live under /wips, Sounds
  // under /sounds, etc., which section.toLowerCase()+'s' already yields.
  const gbUrl = `https://gamebanana.com/${section.toLowerCase()}s/${mod.id}`;
  const copyGbLink = async () => {
    try {
      await navigator.clipboard.writeText(gbUrl);
      showToast(t('modDetails.linkCopied'), { tone: 'success' });
    } catch (err) {
      console.error('[ModDetails] Failed to copy GameBanana link:', err);
    }
  };
  // Wrap a GameBanana link in a right-click menu (Open / Copy link). A render
  // helper, not a component, so the trigger keeps its element identity across
  // re-renders (an inline component type would remount and close an open menu).
  const withGbLinkMenu = (trigger: ReactNode) => (
    <MenuRoot>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent>
        <MenuItem icon={ExternalLink} onSelect={() => window.open(gbUrl, '_blank', 'noopener,noreferrer')}>
          {t('modDetails.viewOnGamebanana')}
        </MenuItem>
        <MenuItem icon={Link2} onSelect={copyGbLink}>
          {t('modDetails.copyLink')}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
  const isSidebar = variant === 'sidebar';
  const images = mod.previewMedia?.images ?? [];
  const audioPreviewUrl = mod.previewMedia?.metadata?.audioUrl;
  const soundVolume = useAppStore((state) => state.soundVolume);
  // Cursor into the images array - only the lightbox cares about this now
  // that previews are stacked vertically rather than swapped via carousel.
  // It tracks which image is currently zoomed and which one keyboard arrows
  // step through while the lightbox is open.
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  // Pointer X at the start of a sidebar-carousel swipe; compared on pointer-up
  // to decide whether the gesture stepped to the prev/next image.
  const swipeStartXRef = useRef<number | null>(null);
  // Falls back to a monogram when the artist avatar URL 404s or is blocked.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [comments, setComments] = useState<GameBananaComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsTotalCount, setCommentsTotalCount] = useState(0);
  const [updates, setUpdates] = useState<GameBananaModUpdate[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(true);
  const [updatesTotalCount, setUpdatesTotalCount] = useState(0);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  // The whole changelog is minimized behind an outer dropdown; each version
  // entry inside is its own collapsed dropdown.
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [openUpdates, setOpenUpdates] = useState<Set<number>>(new Set());
  const [archivedFilesOpen, setArchivedFilesOpen] = useState(false);
  // Lightbox state - when true, the selected image renders full-screen at
  // its native GB resolution so the user can inspect detail the inline
  // preview hides.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Per-image natural aspect ratio, captured on load so each preview slot
  // can size to its real proportions instead of being forced into 16:9
  // (which letterboxed portraits and chopped UI screenshots).
  const [imageRatios, setImageRatios] = useState<Record<number, number>>({});
  const [deleteCandidate, setDeleteCandidate] = useState<{ modId: string; fileName: string } | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);

  // Default the archived section open when the file you currently have installed
  // lives there. That's the common update case: an author archives the old
  // version and uploads a new current file, so your installed file drops into
  // the (collapsed) archived list while the new "Update" target shows above.
  // Leaving it collapsed hid which row you actually have, giving no anchor for
  // what you're replacing.
  const installedFileIsArchived = (mod.files ?? []).some(
    (f) => f.isArchived && installedFileIds.has(f.id),
  );
  useEffect(() => {
    setArchivedFilesOpen(installedFileIsArchived);
  }, [mod.id, installedFileIsArchived]);

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
    let cancelled = false;
    setUpdatesLoading(true);
    setUpdatesError(null);
    getModUpdates(mod.id, section)
      .then((res) => {
        if (!cancelled) {
          setUpdates(
            res.updates.filter(
              (update) => update.text || update.changes?.length || update.title || update.version
            )
          );
          setUpdatesTotalCount(res.totalCount);
          setOpenUpdates(new Set());
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ModDetailsModal] Failed to load updates:', err);
          setUpdates([]);
          setUpdatesTotalCount(0);
          setUpdatesError(String(err).replace(/^Error:\s*/, ''));
        }
      })
      .finally(() => {
        if (!cancelled) setUpdatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mod.id, section]);

  // Reset the image cursor when the mod changes so the sidebar carousel (and a
  // subsequently-opened lightbox) starts on the first preview rather than a
  // stale index that may be out of range for the new mod's image count.
  useEffect(() => {
    setCurrentImageIndex(0);
    swipeStartXRef.current = null;
    setAvatarFailed(false);
  }, [mod.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteCandidate) {
          if (!deleteInProgress) setDeleteCandidate(null);
          return;
        }
        // Lightbox eats ESC before the modal does, so users can dismiss the
        // zoomed view without losing their place on the detail card.
        if (lightboxOpen) {
          setLightboxOpen(false);
        } else {
          onClose();
        }
      }
      // Arrow keys only navigate while the lightbox is open - otherwise
      // they step between mods when the caller provides modal navigation.
      if (lightboxOpen && images.length > 1) {
        if (e.key === 'ArrowLeft') goToPrevious();
        if (e.key === 'ArrowRight') goToNext();
      } else if (!deleteCandidate && !isNavigating) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editing =
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          target?.isContentEditable;
        if (!editing && e.key === 'ArrowLeft' && onNavigatePrevious) {
          e.preventDefault();
          onNavigatePrevious();
        }
        if (!editing && e.key === 'ArrowRight' && onNavigateNext) {
          e.preventDefault();
          onNavigateNext();
        }
      }
    };
    // Side mouse buttons (3 = back, 4 = forward) would otherwise let Chromium
    // walk the router history out from under an open modal/lightbox. While this
    // modal is mounted, repurpose both to close the topmost overlay (same
    // precedence as Escape) and suppress the navigation. The physical
    // back/forward mapping varies by mouse, so handle either button.
    const isSideButton = (e: MouseEvent) => e.button === 3 || e.button === 4;
    const suppressNav = (e: MouseEvent) => {
      if (isSideButton(e)) e.preventDefault();
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (!isSideButton(e)) return;
      e.preventDefault();
      if (lightboxOpen) {
        setLightboxOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    // mousedown/auxclick are the gesture's cancelable phases; preventing default
    // on them is what actually blocks the history navigation in Chromium.
    window.addEventListener('mousedown', suppressNav);
    window.addEventListener('auxclick', suppressNav);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', suppressNav);
      window.removeEventListener('auxclick', suppressNav);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    onClose,
    images.length,
    lightboxOpen,
    deleteCandidate,
    deleteInProgress,
    isNavigating,
    onNavigatePrevious,
    onNavigateNext,
  ]);

  const currentImage = images[currentImageIndex];
  // The lightbox loads the original GB asset for detail inspection.
  // The inline stack uses file530 per image directly via plain image elements so
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

  const actionLabel = (fileId: number, archived = false) => {
    // A file you already own re-downloads itself = "Reinstall". A not-installed
    // current file shown while an update is available is the update target:
    // clicking it replaces the now-superseded installed version, so call it
    // "Update". Archived files are never update targets (they're the old ones).
    // Browse never sets updateAvailable, so its non-installed files stay
    // "Install" (Browse adds files, it doesn't replace).
    if (installedFileIds.has(fileId)) return t('modDetails.actions.reinstall');
    if (updateAvailable && !archived) return t('profiles.actions.update');
    return t('modDetails.actions.install');
  };

  const files = mod.files ?? [];
  const currentFiles = files.filter((file) => !file.isArchived);
  const archivedFiles = files.filter((file) => file.isArchived);
  const totalDownloads = files.reduce((sum, f) => sum + f.downloadCount, 0);
  const outdated = dateModified ? isModOutdated(dateModified) : false;
  const submitterProfileUrl = mod.submitter?.profileUrl
    ?? (mod.submitter && mod.submitter.id > 0 ? `https://gamebanana.com/members/${mod.submitter.id}` : undefined);
  const submitterKofiUrl = mod.submitter?.kofiUrl;
  // When the host provides onViewArtist, the artist becomes a click target that
  // opens "artist mode" (all of their mods) instead of the GameBanana profile.
  const submitter = mod.submitter;
  const openArtist =
    submitter && submitter.id > 0 && onViewArtist
      ? () =>
          onViewArtist({
            id: submitter.id,
            name: submitter.name,
            avatarUrl: submitter.avatarUrl,
            profileUrl: submitterProfileUrl,
            kofiUrl: submitterKofiUrl,
          })
      : undefined;
  const avatarVisual = submitter ? (
    submitter.avatarUrl && !avatarFailed ? (
      <img
        src={submitter.avatarUrl}
        alt={submitter.name}
        loading="lazy"
        onError={() => setAvatarFailed(true)}
        className="h-11 w-11 flex-shrink-0 rounded-full border border-border object-cover"
      />
    ) : (
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-base font-bold uppercase text-accent">
        {submitter.name.charAt(0)}
      </div>
    )
  ) : null;
  const modalBodyTransitionClass = isNavigating
    ? navigationDirection === 'previous'
      ? 'mod-details-body--loading-previous'
      : 'mod-details-body--loading-next'
    : '';
  const formatUpdateVersion = (version: string) =>
    version.trim().match(/^v/i) ? version.trim() : `v${version.trim()}`;

  const toggleUpdate = (id: number) => {
    setOpenUpdates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Color the GameBanana changelog label (Bugfix, Feature, ...). Grouped so
  // related labels share a hue; anything unrecognized falls back to neutral.
  const changeCategoryStyle = (category: string): string => {
    switch (category.toLowerCase()) {
      case 'feature':
      case 'addition':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'bugfix':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      case 'improvement':
      case 'optimization':
      case 'overhaul':
      case 'rewrite':
        return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
      case 'adjustment':
      case 'tweak':
      case 'amendment':
      case 'refactor':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'removal':
        return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40';
      case 'suggestion':
        return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
      default:
        return 'bg-bg-secondary text-text-secondary border-border';
    }
  };

  const renderFileRow = (file: GameBananaFile, archived = false) => {
    const isInstalled = installedFileIds.has(file.id);
    // Highlight the update *target* (the new, not-yet-installed current file),
    // not the superseded file the user currently has, so the accent points at
    // the row they should click to update. Archived files are never targets.
    const isUpdate = !!updateAvailable && !isInstalled && !archived;
    const isActive = activeFileIds.has(file.id);
    const isDownloadingThis = downloadingFileId === file.id;
    const isQueuedThis = queuedFileIds.has(file.id);
    // Only this row's own download/queue state should lock its buttons. A
    // download in progress on a *different* file must leave this row clickable
    // so the user can queue several variants in one go.
    const isBusyThis = isDownloadingThis || isQueuedThis;
    const installedFileState = installedFileStates?.get(file.id);
    const showEnablePill =
      !!installedFileState &&
      !installedFileState.enabled &&
      !!onEnableFile &&
      !isBusyThis;
    const showDeleteButton = !!installedFileState && !!onDeleteFile;
    const pct = progress && progress.total > 0
      ? Math.round((progress.downloaded / progress.total) * 100)
      : null;

    return (
      <div
        key={file.id}
        className={`flex flex-wrap items-center gap-3 p-3 rounded-lg border transition-colors sm:flex-nowrap ${
          isUpdate
            ? 'border-accent/40 bg-accent/5'
            : isActive
              ? 'border-accent/50 bg-accent/10'
              : isInstalled
                ? 'border-green-500/30 bg-green-500/5'
                : archived
                  ? 'border-border/70 bg-bg-secondary/70'
                  : 'border-border bg-bg-tertiary'
        }`}
      >
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${
          isUpdate
            ? 'bg-accent/15 text-accent'
            : isActive
              ? 'bg-accent/20 text-accent'
              : isInstalled
                ? 'bg-green-500/15 text-green-400'
                : archived
                  ? 'bg-bg-tertiary text-text-tertiary'
                  : 'bg-bg-secondary text-text-secondary'
        }`}>
          <FileArchive className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={file.fileName}>{file.fileName}</p>
            {archived && <ArchivedTag />}
          </div>
          {file.description && (
            <p className="text-xs text-text-secondary/90 mt-0.5 truncate" title={file.description}>
              {file.description}
            </p>
          )}
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
            <span className="whitespace-nowrap">{(file.fileSize / 1024 / 1024).toFixed(2)} MB</span>
            <span className="opacity-50">-</span>
            <span className="whitespace-nowrap">{file.downloadCount.toLocaleString()} downloads</span>
            {file.dateAdded && file.dateAdded > 0 && (
              <>
                <span className="opacity-50">-</span>
                <span
                  className="flex items-center gap-1 whitespace-nowrap"
                  title={`Uploaded ${formatDate(file.dateAdded)} ${new Date(file.dateAdded * 1000).toLocaleTimeString()}`}
                >
                  <Clock className="w-3 h-3" />
                  {formatDate(file.dateAdded)}
                </span>
              </>
            )}
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
        <div className="ml-[52px] flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:ml-0 sm:flex-none">
          {isActive && (
            <span className="flex-shrink-0 self-center rounded bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
              {t('common.status.active')}
            </span>
          )}
          {showEnablePill && installedFileState && (
            <Button
              type="button"
              variant="warning"
              icon={Power}
              onClick={() => onEnableFile!(installedFileState.modId)}
              disabled={isBusyThis}
              title={t('modDetails.actions.enableThisModTitle')}
            >
              {t('modDetails.actions.enable')}
            </Button>
          )}
          {showDeleteButton && installedFileState && (
            <IconButton
              icon={Trash2}
              label={`Delete ${file.fileName}`}
              tone="danger"
              onClick={() => setDeleteCandidate({ modId: installedFileState.modId, fileName: file.fileName })}
              disabled={isBusyThis || deleteInProgress}
            />
          )}
          <Button
            type="button"
            variant={isUpdate || !isInstalled ? 'primary' : 'secondary'}
            onClick={() => onDownload(file.id, file.fileName)}
            disabled={isBusyThis}
            className="min-w-[110px] max-w-full"
          >
            {isDownloadingThis ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {extracting ? t('modDetails.status.extracting') : pct !== null ? `${pct}%` : t('modDetails.status.starting')}
              </>
            ) : isQueuedThis ? (
              <>
                <Clock className="w-4 h-4" />
                {t('modDetails.status.queued')}
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                {actionLabel(file.id, archived)}
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

  const filesSection = files.length > 0 ? (
    <section>
      <h3 className="font-semibold text-xs uppercase tracking-wide text-text-secondary mb-2">
        {t('modDetails.sections.files')} {files.length > 1 && <span className="text-text-secondary/70 normal-case tracking-normal">({files.length})</span>}
      </h3>
      <div className="space-y-2">
        {currentFiles.map((file) => renderFileRow(file))}
        {archivedFiles.length > 0 && (
          <div className={currentFiles.length > 0 ? 'pt-1' : undefined}>
            <button
              type="button"
              onClick={() => setArchivedFilesOpen((open) => !open)}
              aria-expanded={archivedFilesOpen}
              className="w-full flex items-center justify-between gap-3 px-1 py-1.5 text-left text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 min-w-0">
                {archivedFilesOpen ? (
                  <ChevronDown className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 flex-shrink-0" />
                )}
                <span className="font-medium truncate">{t('modDetails.files.archived')}</span>
                {installedFileIsArchived && (
                  <span className="flex-shrink-0 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400">
                    {t('modDetails.files.yourVersion')}
                  </span>
                )}
              </span>
              <span className="flex-shrink-0 text-[11px] leading-none text-text-tertiary">
                ({archivedFiles.length})
              </span>
            </button>
            {archivedFilesOpen && (
              <div className="mt-2 space-y-2">
                {archivedFiles.map((file) => renderFileRow(file, true))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  ) : null;

  const navigationSkeleton = (
    <div
      className="mod-details-navigation-skeleton absolute inset-0 bg-bg-secondary"
      aria-hidden
    >
      {/* Match the real body's layout per variant: the sidebar stacks into one
          column on a narrow dock and goes two-column past 56rem of panel
          width (same @4xl container breakpoint as the real body below). */}
      <div className={`flex h-full min-h-0 flex-col overflow-hidden ${isSidebar ? '@4xl:flex-row' : 'lg:flex-row'}`}>
        <div className={`space-y-3 overflow-hidden ${isSidebar ? 'p-4 @4xl:w-[460px] @4xl:flex-shrink-0 @4xl:pr-3' : 'lg:w-[460px] lg:flex-shrink-0 p-5 lg:pr-3'}`}>
          <Skeleton className="aspect-[16/9] w-full" rounded="lg" />
          {!isSidebar && <Skeleton className="aspect-[16/10] w-full" rounded="lg" />}
          <div className="rounded-lg border border-border bg-bg-tertiary p-3">
            <div className="mb-2 flex items-center gap-2">
              <Skeleton className="h-4 w-4" rounded="full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-9 w-full" rounded="lg" />
          </div>
        </div>

        <div className={`flex-1 min-w-0 space-y-5 overflow-hidden ${isSidebar ? 'p-4' : 'p-5 lg:pl-3'}`}>
          <section>
            <Skeleton className="mb-2 h-3 w-16" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-7 w-20" rounded="md" />
            </div>
          </section>

          <section>
            <Skeleton className="mb-2 h-3 w-14" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </section>

          <section>
            <Skeleton className="mb-2 h-3 w-20" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-bg-tertiary p-3">
                  <Skeleton className="h-10 w-10 flex-shrink-0" rounded="md" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                  <Skeleton className="h-9 w-24 flex-shrink-0" rounded="md" />
                </div>
              ))}
            </div>
          </section>

          <section>
            <Skeleton className="mb-3 h-3 w-24" />
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-7 w-7 flex-shrink-0" rounded="full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-2.5 w-full" />
                    <Skeleton className="h-2.5 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;

  // The sidebar shares this whole JSX tree with the modal; only the outer
  // chrome and the body layout differ. The caller's <aside> supplies the
  // sidebar's width/height/border, so here we just fill it. The sidebar body
  // is keyed to the PANEL's width via container queries (@container/@4xl),
  // not the viewport: a narrow dock stacks into one column, and a dock
  // dragged wide enough (56rem+) gets the modal's two-column layout.
  const outerClass = isSidebar
    ? 'h-full w-full @container'
    : 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 md:px-24 z-50 animate-fade-in';
  const panelClass = isSidebar
    ? 'relative bg-bg-secondary h-full w-full overflow-hidden flex flex-col'
    : 'relative bg-bg-secondary rounded-xl w-full max-w-4xl lg:max-w-6xl h-[min(90vh,920px)] max-h-[90vh] overflow-visible flex flex-col border border-border shadow-2xl';
  const bodyContentClass = isSidebar
    ? 'mod-details-body-content flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain @4xl:flex-row @4xl:overflow-hidden'
    : 'mod-details-body-content flex h-full min-h-0 flex-col lg:flex-row overflow-y-auto overscroll-contain lg:overflow-hidden';
  const imageColClass = isSidebar
    ? 'p-4 space-y-3 @4xl:w-[460px] @4xl:flex-shrink-0 @4xl:overflow-y-auto @4xl:overscroll-contain @4xl:max-h-full @4xl:pr-3'
    : 'lg:w-[460px] lg:flex-shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:max-h-full p-5 lg:pr-3 space-y-3';
  const detailsColClass = isSidebar
    ? 'flex-1 min-w-0 p-4 space-y-5 @4xl:overflow-y-auto @4xl:overscroll-contain @4xl:max-h-full @4xl:pl-3'
    : 'flex-1 min-w-0 lg:overflow-y-auto lg:overscroll-contain lg:max-h-full p-5 lg:pl-3 space-y-5';

  const modal = (
    <div
      className={outerClass}
      onClick={isSidebar ? undefined : onClose}
      // The docked sidebar is a persistent, non-blocking panel, so it's a
      // labelled region, not a modal dialog (which would wrongly imply a
      // focus trap / inert background to screen readers).
      role={isSidebar ? 'region' : 'dialog'}
      aria-modal={isSidebar ? undefined : true}
      aria-label={isNavigating ? navigationLabel ?? t('modDetails.aria.loadingDetails') : mod.name}
      aria-busy={isNavigating}
    >
      <div
        className={panelClass}
        onClick={isSidebar ? undefined : (e) => e.stopPropagation()}
      >
        {/* Big floating step arrows belong to the centered modal only; they sit
            outside the panel (-left-16/-right-16) which a clipped sidebar can't
            show. The sidebar gets compact inline arrows in its header instead. */}
        {!isSidebar && onNavigatePrevious && !lightboxOpen && (
          <button
            type="button"
            disabled={isNavigating}
            onClick={(e) => {
              e.stopPropagation();
              onNavigatePrevious();
            }}
            aria-label={previousLabel ? `Previous mod: ${previousLabel}` : 'Previous mod'}
            title={previousLabel ? `Previous: ${previousLabel}` : 'Previous mod'}
            className="absolute -left-16 top-1/2 z-20 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-lg border border-border bg-bg-secondary text-text-primary shadow-2xl transition-colors hover:border-accent/60 hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-wait disabled:opacity-70 cursor-pointer"
          >
            {isNavigating && navigationDirection === 'previous' ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ChevronLeft className="h-8 w-8" />
            )}
          </button>
        )}
        {!isSidebar && onNavigateNext && !lightboxOpen && (
          <button
            type="button"
            disabled={isNavigating}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateNext();
            }}
            aria-label={nextLabel ? `Next mod: ${nextLabel}` : 'Next mod'}
            title={nextLabel ? `Next: ${nextLabel}` : 'Next mod'}
            className="absolute -right-16 top-1/2 z-20 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-lg border border-border bg-bg-secondary text-text-primary shadow-2xl transition-colors hover:border-accent/60 hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-wait disabled:opacity-70 cursor-pointer"
          >
            {isNavigating && navigationDirection === 'next' ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ChevronRight className="h-8 w-8" />
            )}
          </button>
        )}
        {/* Header. Status badges, title, and dense metadata stay compact so
            the modal's vertical budget goes to content. Title shrinks/truncates
            first when space gets tight; metadata hides on narrow screens. */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
          {/* Sidebar-only: compact step arrows live inline since the big
              floating ones have nowhere to go in a docked panel. */}
          {isSidebar && (onNavigatePrevious || onNavigateNext) && !lightboxOpen && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                disabled={isNavigating || !onNavigatePrevious}
                onClick={() => onNavigatePrevious?.()}
                aria-label={previousLabel ? `Previous mod: ${previousLabel}` : 'Previous mod'}
                title={previousLabel ? `Previous: ${previousLabel}` : 'Previous mod'}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg-tertiary text-text-secondary transition-colors hover:border-accent/60 hover:text-text-primary disabled:cursor-default disabled:opacity-40 cursor-pointer"
              >
                {isNavigating && navigationDirection === 'previous' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                disabled={isNavigating || !onNavigateNext}
                onClick={() => onNavigateNext?.()}
                aria-label={nextLabel ? `Next mod: ${nextLabel}` : 'Next mod'}
                title={nextLabel ? `Next: ${nextLabel}` : 'Next mod'}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg-tertiary text-text-secondary transition-colors hover:border-accent/60 hover:text-text-primary disabled:cursor-default disabled:opacity-40 cursor-pointer"
              >
                {isNavigating && navigationDirection === 'next' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </div>
          )}
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
                {t('modDetails.status.installed')}
              </span>
            )}
            {/* Only surface the ignore-updates pill in the installed-mod
                context (handler provided) and when it's actually relevant:
                either there's an update available now, or the user already
                opted out and might want to re-enable detection. */}
            {onToggleIgnoreUpdates && installed && (ignoreUpdates || updateAvailable) && (
              <button
                type="button"
                onClick={onToggleIgnoreUpdates}
                className={
                  ignoreUpdates
                    ? 'inline-flex items-center gap-1 rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary border border-border hover:text-text-primary hover:border-accent/40 transition-colors'
                    : 'inline-flex items-center gap-1 rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary border border-border hover:text-accent hover:border-accent/40 transition-colors'
                }
                title={
                  ignoreUpdates
                    ? 'Currently ignoring updates for this mod. Click to resume detection.'
                    : 'Stop flagging updates for this mod (you can re-enable later).'
                }
              >
                {ignoreUpdates ? (
                  <>
                    <BellOff className="w-2.5 h-2.5" />
                    {t('modDetails.status.updatesIgnored')}
                  </>
                ) : (
                  <>
                    <Bell className="w-2.5 h-2.5" />
                    {t('modDetails.actions.ignoreUpdates')}
                  </>
                )}
              </button>
            )}
            {outdated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-400 border border-yellow-500/40">
                <AlertTriangle className="w-2.5 h-2.5" />
                {t('modDetails.status.outdated')}
              </span>
            )}
            {mod.category?.name && (
              <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary border border-border">
                {mod.category.name}
              </span>
            )}
          </div>
          {/* Sidebar moves the title down into the body to keep this header from
              cramming, so here it's just a spacer that pushes the action buttons
              to the right edge. */}
          {isSidebar ? (
            <div className="min-w-0 flex-1" />
          ) : (
            <h2 className="text-lg lg:text-xl font-bold leading-tight min-w-0 flex-1" title={isNavigating ? navigationLabel : mod.name}>
              {isNavigating ? (
                <span className="inline-flex w-full max-w-sm items-center gap-2">
                  <Skeleton className="h-5 w-full max-w-[20rem]" />
                  <span className="sr-only">{t('modDetails.aria.loadingNamed', { label: navigationLabel ?? t('modDetails.meta.modDetails') })}</span>
                </span>
              ) : (
                withGbLinkMenu(
                  <a
                    href={gbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`View ${mod.name} on GameBanana`}
                    className="group inline-flex max-w-full min-w-0 items-center gap-1.5 text-text-primary transition-colors hover:text-accent"
                  >
                    <span className="min-w-0 truncate">{mod.name}</span>
                    <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary transition-colors group-hover:text-accent" />
                  </a>
                )
              )}
            </h2>
          )}
          {(() => {
            // Hide the modified date when it formats to the same day as the
            // added date - common for fresh uploads where both timestamps
            // fall on the same calendar day, which makes the header read
            // "5/12/2026 5/12/2026".
            const addedStr = dateAdded && dateAdded > 0 ? formatDate(dateAdded) : null;
            const modifiedStr = dateModified && dateModified > 0 ? formatDate(dateModified) : null;
            const showModified = modifiedStr !== null && modifiedStr !== addedStr;
            if (!addedStr && !showModified && totalDownloads === 0) return null;
            // The sidebar surfaces this same metadata in its body title block,
            // so keep it out of the cramped sidebar header.
            if (isSidebar) return null;
            return (
              <div className="hidden md:flex items-center gap-3 text-xs text-text-secondary flex-shrink-0">
                {addedStr && (
                  <span className="flex items-center gap-1" title={`Uploaded ${addedStr}`}>
                    <Clock className="w-3 h-3" />
                    <span className="text-text-tertiary">{t('modDetails.meta.added')}</span>
                    <span className="text-text-primary">{addedStr}</span>
                  </span>
                )}
                {showModified && (
                  <span
                    className={`flex items-center gap-1 ${outdated ? 'text-yellow-400' : ''}`}
                    title={outdated
                      ? `Last updated ${modifiedStr} (may be outdated for the current game version)`
                      : `Last updated ${modifiedStr}`}
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span className={outdated ? 'text-yellow-300/80' : 'text-text-tertiary'}>{t('profiles.updated')}</span>
                    <span className={outdated ? 'text-yellow-300' : 'text-text-primary'}>{modifiedStr}</span>
                  </span>
                )}
                {totalDownloads > 0 && (
                  <span className="flex items-center gap-1" title={`${totalDownloads.toLocaleString()} downloads`}>
                    <Download className="w-3 h-3" />
                    <span className="text-text-primary">{totalDownloads.toLocaleString()}</span>
                  </span>
                )}
              </div>
            );
          })()}
          {onChangeView && (
            <IconButton
              icon={isSidebar ? Maximize2 : PanelRight}
              label={isSidebar ? 'Pop out to centered window' : 'Dock to side'}
              onClick={() => onChangeView(isSidebar ? 'modal' : 'sidebar')}
            />
          )}
          <IconButton
            icon={X}
            label={t('common.actions.close')}
            onClick={onClose}
          />
        </div>

        {deleteCandidate && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-file-title"
            onClick={(e) => {
              e.stopPropagation();
              if (!deleteInProgress) setDeleteCandidate(null);
            }}
          >
            <div
              className="w-full max-w-md rounded-lg border border-border bg-bg-secondary p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="delete-file-title" className="text-lg font-semibold text-text-primary">
                {t('modDetails.deleteFile.title')}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                <Trans
                  i18nKey="modDetails.deleteFile.body"
                  values={{ fileName: deleteCandidate.fileName }}
                  components={{ name: <span className="font-medium text-text-primary" /> }}
                />
              </p>
              <div className="mt-5 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDeleteCandidate(null)}
                  disabled={deleteInProgress}
                >
                  {t('common.actions.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  isLoading={deleteInProgress}
                  onClick={async () => {
                    if (!onDeleteFile || !deleteCandidate) return;
                    setDeleteInProgress(true);
                    try {
                      await onDeleteFile(deleteCandidate.modId);
                      setDeleteCandidate(null);
                    } finally {
                      setDeleteInProgress(false);
                    }
                  }}
                >
                  {t('common.actions.delete')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Body - single scroll on narrow (everything flows top to bottom),
            two independently-scrollable columns on lg+. Independent scroll
            on wide is critical now that previews stack vertically: scrolling
            comments shouldn't drag the image column away, and vice versa. */}
        <div className={`mod-details-body relative flex-1 min-h-0 overflow-hidden ${modalBodyTransitionClass}`}>
          <div className={bodyContentClass}>
            {/* Image / preview column */}
            <div className={imageColClass}>
              {images.length > 0 ? (
                isSidebar ? (
                  /* Sidebar carousel - one image slot the user swipes (or clicks
                     the arrows) through, instead of the modal's tall stack. The
                     narrow panel has no room to stack every preview, and a
                     single slot keeps the details (files/about) above the fold. */
                  (() => {
                    const idx = Math.min(currentImageIndex, images.length - 1);
                    const img = images[idx];
                    const previewSrc = `${img.baseUrl}/${img.file530 || img.file}`;
                    const fullSrc = `${img.baseUrl}/${img.file}`;
                    const imageHidden = mod.nsfw && hideNsfwPreviews;
                    const slot = (
                      // Fixed-aspect box (not the image's own ratio): portrait and
                      // landscape previews both letterbox into the same height, so
                      // the centered arrows never shift as you click through.
                      <div
                        className="relative w-full select-none touch-pan-y aspect-[16/9] bg-bg-tertiary rounded-lg overflow-hidden border border-border"
                        onPointerDown={(e) => { swipeStartXRef.current = e.clientX; }}
                        onPointerUp={(e) => {
                          const start = swipeStartXRef.current;
                          swipeStartXRef.current = null;
                          if (start === null || images.length < 2) return;
                          const dx = e.clientX - start;
                          if (Math.abs(dx) > 40) {
                            if (dx < 0) goToNext();
                            else goToPrevious();
                          }
                        }}
                        onPointerCancel={() => { swipeStartXRef.current = null; }}
                      >
                        <button
                          type="button"
                          onClick={() => openLightboxAt(idx)}
                          aria-label={`View image ${idx + 1} of ${images.length} full size`}
                          className="group absolute inset-0 h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                        >
                          <img
                            src={previewSrc}
                            alt={`${mod.name} - Image ${idx + 1}`}
                            draggable={false}
                            className={`absolute inset-0 h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.01] ${
                              imageHidden ? 'blur-xl scale-110' : ''
                            }`}
                          />
                          {imageHidden && (
                            <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-wide text-white/80 bg-black/40">
                              {t('modDetails.nsfw.previewHidden')}
                            </div>
                          )}
                          <span className="absolute top-2 right-2 p-1.5 rounded-md bg-black/55 backdrop-blur-sm text-white/80 border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Maximize2 className="w-3.5 h-3.5" />
                          </span>
                        </button>
                        {images.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
                              aria-label={t('modDetails.aria.previousImage')}
                              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 p-1.5 rounded-full bg-black/55 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer"
                            >
                              <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); goToNext(); }}
                              aria-label={t('modDetails.aria.nextImage')}
                              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 p-1.5 rounded-full bg-black/55 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer"
                            >
                              <ChevronRight className="w-5 h-5" />
                            </button>
                            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white/85 text-[11px] border border-white/10">
                              {idx + 1} / {images.length}
                            </div>
                          </>
                        )}
                      </div>
                    );
                    return (
                      <div className="space-y-2" aria-label={t('modDetails.aria.imagePreviews')}>
                        {imageHidden ? (
                          slot
                        ) : (
                          <ImageContextMenu src={previewSrc} copySrc={fullSrc} alt={`${mod.name} - Image ${idx + 1}`}>
                            {slot}
                          </ImageContextMenu>
                        )}
                        {images.length > 1 && images.length <= 10 && (
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            {images.map((_, dotIndex) => (
                              <button
                                key={dotIndex}
                                type="button"
                                onClick={() => setCurrentImageIndex(dotIndex)}
                                aria-label={`Go to image ${dotIndex + 1}`}
                                aria-current={dotIndex === idx}
                                className={`h-1.5 rounded-full transition-all ${
                                  dotIndex === idx ? 'w-4 bg-accent' : 'w-1.5 bg-text-tertiary/50 hover:bg-text-tertiary'
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                /* Vertical preview stack - every image renders inline so
                   users scroll naturally to see all of them. Click any one
                   to open the lightbox at that image's index. We use the
                   530px preview here (fast load + sharp on the inline slot)
                   and the original asset in the lightbox. */
                <div className="space-y-3" aria-label={t('modDetails.aria.imagePreviews')}>
                  {images.map((img, index) => {
                    const previewSrc = `${img.baseUrl}/${img.file530 || img.file}`;
                    const fullSrc = `${img.baseUrl}/${img.file}`;
                    const ratio = imageRatios[index];
                    const imageHidden = mod.nsfw && hideNsfwPreviews;
                    // Pre-load: hold a 16:9 placeholder so the column doesn't
                    // jump as images decode. Post-load: snap to the image's
                    // real aspect ratio so portraits, ultrawides, and UI
                    // screenshots all render at their natural shape - no
                    // letterboxing, no cropping, no blurred fill needed.
                    const previewButton = (
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
                            imageHidden ? 'blur-xl scale-110' : ''
                          }`}
                        />
                        {imageHidden && (
                          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-wide text-white/80 bg-black/40">
                            {t('modDetails.nsfw.previewHidden')}
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
                    if (imageHidden) return previewButton;
                    return (
                      <ImageContextMenu
                        key={`${img.baseUrl}/${img.file}`}
                        src={previewSrc}
                        copySrc={fullSrc}
                        alt={`${mod.name} - Image ${index + 1}`}
                      >
                        {previewButton}
                      </ImageContextMenu>
                    );
                  })}
                </div>
                )
              ) : section === 'Sound' && !audioPreviewUrl ? (
                <div className="flex items-center justify-center p-8 rounded-lg border border-border bg-bg-tertiary">
                  <div className="flex flex-col items-center gap-2 text-text-secondary">
                    <Volume2 className="w-12 h-12 text-accent/60" />
                    <span className="text-sm">{t('modDetails.audio.soundMod')}</span>
                    <span className="text-xs opacity-60">{t('modDetails.audio.noPreview')}</span>
                  </div>
                </div>
              ) : null}

              {audioPreviewUrl && (
                <div className="relative rounded-lg overflow-hidden border border-border bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Volume2 className="w-4 h-4 text-accent" />
                    <h3 className="font-medium text-sm text-text-primary">{t('modDetails.audio.preview')}</h3>
                  </div>
                  <div className="backdrop-blur-md bg-bg-primary/50 rounded-lg border border-white/10 p-1">
                    <AudioPreviewPlayer
                      src={audioPreviewUrl}
                      className="w-full"
                      volume={soundVolume}
                    />
                  </div>
                </div>
              )}

              {outdated && (
                <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-yellow-200 text-xs">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <span>{t('modDetails.outdatedWarning', { date: formatDate(dateModified!) })}</span>
                </div>
              )}
            </div>

            {/* Content column - description / files / comments / GB link.
                Takes the remaining horizontal space on wide layouts.
                Independently scrollable on lg+ so reading comments or
                installing a file doesn't move the image stack on the left. */}
            <div className={detailsColClass}>
              {/* Sidebar-only title block. The header drops the title to stay
                  uncluttered, so the mod name lives here with its
                  dates/downloads underneath. */}
              {isSidebar && (
                <div className="space-y-1.5">
                  {isNavigating ? (
                    <Skeleton className="h-6 w-3/4" />
                  ) : (
                    withGbLinkMenu(
                      <a
                        href={gbUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`View ${mod.name} on GameBanana`}
                        className="group inline-flex max-w-full items-start gap-1.5 text-xl font-bold leading-tight text-text-primary transition-colors hover:text-accent"
                      >
                        <span className="min-w-0">{mod.name}</span>
                        <ExternalLink className="mt-1 h-4 w-4 flex-shrink-0 text-text-tertiary transition-colors group-hover:text-accent" />
                      </a>
                    )
                  )}
                  {(() => {
                    const addedStr = dateAdded && dateAdded > 0 ? formatDate(dateAdded) : null;
                    const modifiedStr = dateModified && dateModified > 0 ? formatDate(dateModified) : null;
                    const showModified = modifiedStr !== null && modifiedStr !== addedStr;
                    if (!addedStr && !showModified && totalDownloads === 0) return null;
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                        {addedStr && (
                          <span className="flex items-center gap-1" title={`Uploaded ${addedStr}`}>
                            <Clock className="h-3 w-3" />
                            {addedStr}
                          </span>
                        )}
                        {showModified && (
                          <span
                            className={`flex items-center gap-1 ${outdated ? 'text-yellow-400' : ''}`}
                            title={`Last updated ${modifiedStr}`}
                          >
                            <RefreshCw className="h-3 w-3" />
                            {modifiedStr}
                          </span>
                        )}
                        {totalDownloads > 0 && (
                          <span className="flex items-center gap-1" title={`${totalDownloads.toLocaleString()} downloads`}>
                            <Download className="h-3 w-3" />
                            {totalDownloads.toLocaleString()}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {filesSection}

              {submitter && (
                <section>
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-tertiary/40 p-3">
                    {openArtist ? (
                      <button
                        type="button"
                        onClick={openArtist}
                        title={`View ${submitter.name}'s mods`}
                        className="flex-shrink-0 rounded-full transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 cursor-pointer"
                      >
                        {avatarVisual}
                      </button>
                    ) : (
                      avatarVisual
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{t('modDetails.meta.artist')}</div>
                      {openArtist ? (
                        <button
                          type="button"
                          onClick={openArtist}
                          title={`View ${submitter.name}'s mods`}
                          className="group/artist inline-flex min-w-0 max-w-full items-center gap-1.5 font-semibold text-text-primary transition-colors hover:text-accent cursor-pointer"
                        >
                          <span className="min-w-0 truncate">{submitter.name}</span>
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-text-tertiary transition-colors group-hover/artist:text-accent" />
                        </button>
                      ) : submitterProfileUrl ? (
                        <a
                          href={submitterProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`View ${submitter.name} on GameBanana`}
                          className="group/artist inline-flex min-w-0 max-w-full items-center gap-1.5 font-semibold text-text-primary transition-colors hover:text-accent"
                        >
                          <span className="min-w-0 truncate">{submitter.name}</span>
                          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary transition-colors group-hover/artist:text-accent" />
                        </a>
                      ) : (
                        <span className="block min-w-0 truncate font-semibold text-text-primary">{submitter.name}</span>
                      )}
                    </div>
                    {submitterKofiUrl && (
                      <a
                        href={submitterKofiUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Support ${submitter.name} on Ko-fi`}
                        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-brand-kofi px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-kofi-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-kofi/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
                      >
                        <Coffee className="h-4 w-4" />
                        {t('modDetails.meta.koFi')}
                      </a>
                    )}
                  </div>
                </section>
              )}

              {mod.description && (
                <section>
                  <h3 className="font-semibold text-xs uppercase tracking-wide text-text-secondary mb-2">
                    {t('modDetails.sections.about')}
                  </h3>
                  <div className="text-sm text-text-primary/90 leading-relaxed [&_p]:mb-2 [&_a]:text-accent [&_a]:hover:underline [&_img]:rounded-md [&_img]:my-2 [&_img]:max-w-full">
                    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mod.description) }} />
                  </div>
                </section>
              )}

              <section>
                <button
                  type="button"
                  onClick={() => setChangelogOpen((o) => !o)}
                  aria-expanded={changelogOpen}
                  className="group mb-2 flex w-full cursor-pointer items-center gap-2 text-left"
                >
                  {changelogOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary" />
                  )}
                  <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary transition-colors group-hover:text-text-primary">
                    {t('modDetails.sections.changelog')} {updatesTotalCount > 0 && <span className="normal-case tracking-normal text-text-secondary/70">({updatesTotalCount})</span>}
                  </span>
                </button>
                {changelogOpen && (
                  updatesLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="rounded-lg border border-border bg-bg-tertiary p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-2.5 w-14" />
                        </div>
                        <Skeleton className="h-2.5 w-full" />
                        <Skeleton className="mt-1.5 h-2.5 w-2/3" />
                      </div>
                    ))}
                  </div>
                ) : updatesError ? (
                  <p className="rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-secondary">
                    {t('modDetails.changelog.unavailable')}
                  </p>
                ) : updates.length === 0 ? (
                  <p className="text-sm text-text-secondary py-1">{t('modDetails.changelog.empty')}</p>
                ) : (
                  <div className="space-y-2">
                    {updates.map((update) => {
                      const isOpen = openUpdates.has(update.id);
                      const hasChanges = (update.changes?.length ?? 0) > 0;
                      const hasBody = hasChanges || !!update.text;
                      return (
                        <article key={update.id} className="rounded-lg border border-border bg-bg-tertiary overflow-hidden">
                          <button
                            type="button"
                            onClick={() => hasBody && toggleUpdate(update.id)}
                            aria-expanded={hasBody ? isOpen : undefined}
                            disabled={!hasBody}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                              hasBody ? 'cursor-pointer hover:bg-bg-secondary/60' : 'cursor-default'
                            }`}
                          >
                            {hasBody ? (
                              isOpen ? (
                                <ChevronDown className="w-4 h-4 flex-shrink-0 text-text-secondary" />
                              ) : (
                                <ChevronRight className="w-4 h-4 flex-shrink-0 text-text-secondary" />
                              )
                            ) : (
                              <span className="w-4 h-4 flex-shrink-0" />
                            )}
                            {(update.version || update.title) && (
                              <h4 className="min-w-0 truncate text-sm font-semibold text-text-primary">
                                {update.version ? formatUpdateVersion(update.version) : update.title}
                                {update.version && update.title ? ` - ${update.title}` : ''}
                              </h4>
                            )}
                            {hasChanges && (
                              <span className="flex-shrink-0 rounded-full bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                                {update.changes!.length}
                              </span>
                            )}
                            {update.dateAdded > 0 && (
                              <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-text-tertiary">
                                <Clock className="w-3 h-3" />
                                {formatDate(update.dateAdded)}
                              </span>
                            )}
                          </button>
                          {isOpen && hasBody && (
                            <div className="border-t border-border px-3 py-2.5">
                              {hasChanges ? (
                                <ul className="space-y-1.5">
                                  {update.changes!.map((change, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-text-primary/90">
                                      {change.category && (
                                        <span
                                          className={`mt-0.5 flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${changeCategoryStyle(
                                            change.category
                                          )}`}
                                        >
                                          {change.category}
                                        </span>
                                      )}
                                      <span className="min-w-0 leading-relaxed">{change.text}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                update.text && (
                                  <div
                                    className="text-sm text-text-primary/90 leading-relaxed [&_p]:mb-1 [&_a]:text-accent [&_a]:hover:underline"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(update.text) }}
                                  />
                                )
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                  )
                )}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">
                      {t('modDetails.sections.comments')} {commentsTotalCount > 0 && <span className="normal-case tracking-normal text-text-secondary/70">({commentsTotalCount})</span>}
                    </span>
                  </h3>
                  {!commentsLoading && commentsTotalCount > comments.length && comments.length > 0 && (
                    <span className="flex-shrink-0 text-[11px] text-text-tertiary">
                      {t('modDetails.comments.showing', { shown: comments.length.toLocaleString(), total: commentsTotalCount.toLocaleString() })}
                    </span>
                  )}
                </div>
                {commentsLoading ? (
                  <ul className="divide-y divide-border/60 rounded-lg border border-border/80 bg-bg-tertiary/30 px-3">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <li key={i} className="flex gap-3 py-3">
                        <Skeleton className="h-8 w-8 flex-shrink-0" rounded="full" />
                        <div className="min-w-0 flex-1 space-y-1.5">
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
                  <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-bg-tertiary/30 px-3 py-4 text-sm text-text-secondary">
                    <MessageSquare className="h-4 w-4 flex-shrink-0 text-text-tertiary" />
                    <span>{t('modDetails.comments.empty')}</span>
                  </div>
                ) : (
                  /* Flat threaded layout - no per-comment card. Files stay
                     as bordered action cards (each is something you DO);
                     comments are conversational content (something you
                     READ), so we strip the boxes and let the avatar + name
                     + divider carry the visual hierarchy instead. */
                  <ul className="divide-y divide-border/60 rounded-lg border border-border/80 bg-bg-tertiary/30">
                    {comments.map((comment) => {
                      const posterInitial = comment.poster.name.trim().charAt(0).toUpperCase() || '?';
                      return (
                        <li key={comment.id} className="flex min-w-0 gap-3 px-3 py-3">
                          {comment.poster.avatarUrl ? (
                            <img
                              src={comment.poster.avatarUrl}
                              alt={`${comment.poster.name} avatar`}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="h-8 w-8 flex-shrink-0 rounded-full border border-border bg-bg-secondary object-cover"
                            />
                          ) : (
                            <div
                              aria-hidden="true"
                              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-xs font-bold text-accent"
                            >
                              {posterInitial}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="min-w-0 max-w-full truncate text-sm font-semibold text-text-primary" title={comment.poster.name}>
                                {comment.poster.name}
                              </span>
                              <span className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] text-text-tertiary">
                                <Clock className="h-3 w-3" />
                                {formatDate(comment.dateAdded)}
                              </span>
                            </div>
                            <div
                              className="mod-comment-content mt-1"
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.text) }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {withGbLinkMenu(
                <a
                  href={gbUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-accent hover:text-accent-hover transition-colors text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  {t('modDetails.viewOnGamebanana')}
                </a>
              )}
            </div>
          </div>
          {isNavigating && navigationSkeleton}
        </div>
      </div>

      {/* Lightbox overlay - sits above the modal so ESC closes it first.
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
          aria-label={`${mod.name} - full size image`}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
            aria-label={t('modDetails.aria.closeFullSizeView')}
            className="absolute top-4 right-4 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer z-10"
          >
            <X className="w-5 h-5" />
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
                aria-label={t('modDetails.aria.previousImage')}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer z-10"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goToNext(); }}
                aria-label={t('modDetails.aria.nextImage')}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-black/80 hover:text-white border border-white/15 transition-colors cursor-pointer z-10"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              <div className="absolute top-4 left-4 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white/90 text-xs border border-white/15">
                {currentImageIndex + 1} / {images.length}
              </div>
            </>
          )}
          <ImageContextMenu
            src={currentImageFullUrl}
            alt={`${mod.name} - Image ${currentImageIndex + 1} (full size)`}
          >
            <img
              src={currentImageFullUrl}
              alt={`${mod.name} - Image ${currentImageIndex + 1} (full size)`}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </ImageContextMenu>
        </div>
      )}
    </div>
  );

  // The sidebar renders inline inside the caller's <aside>; only the centered
  // modal needs to escape to a body-level portal.
  return isSidebar ? modal : createPortal(modal, document.body);
}

// Memoized because the docked-sidebar variant lives inside Browse's render
// tree, which re-renders on every virtualized-grid range change while
// scrolling. Browse passes stable callbacks (useStableCallback) so shallow
// prop comparison holds between those renders.
export default memo(ModDetailsModal);
