import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ImgHTMLAttributes, type ReactNode, type Ref, type DragEventHandler } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from './useBackdropDismiss';
import ImageContextMenu from '../ImageContextMenu';
import { Modal } from './Modal';
import { MenuItem, MenuSeparator } from './menu';

// URLs this session has already shown. A remount (virtualized grid scrolling
// back, a route revisit) shows them at once instead of fading them in again.
const revealedSrcs = new Set<string>();

// Period of the placeholder sweep in index.css (skeletonSweepLocal).
const SWEEP_MS = 1900;

// img.decode() has no deadline of its own, and a promise that never settles
// would hold a loaded picture behind the skeleton forever.
const DECODE_TIMEOUT_MS = 800;

// Waits before re-requesting an image that failed (a GameBanana 429, a dropped
// connection). After the last one the placeholder stays until the src changes.
const RETRY_DELAYS_MS = [2000, 8000];

// pending: bytes on the way, picture parked off-box over a skeleton.
// cached: seen this session, so expected from cache; shown as it arrives over
//   a plain surface, no fade (a fade on every revisit reads as flicker).
// in: just arrived and decoded, fading in.  instant: shown, no animation.
type RevealState = 'pending' | 'cached' | 'in' | 'instant';

export interface RevealImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'ref'> {
  src: string;
  ref?: Ref<HTMLImageElement>;
  /** Paint a skeleton in the image box while it loads. Off for decorative
   *  layers (blurred backdrops) that should simply fade in. */
  skeleton?: boolean;
  /** Load first: eager, fetchpriority high. For the first visible row. */
  priority?: boolean;
  /** Shown in place of the image when it fails to load. */
  fallback?: ReactNode;
  /** Tried at once if `src` fails, before any retry. For a derived smaller
   *  variant whose original is known to exist. */
  fallbackSrc?: string;
}

/**
 * An <img> that never shows a half-painted image. It stays hidden (behind a
 * skeleton) until the bytes are in and decoded, then fades in. An image the
 * browser already has shows instantly, and a failed one is retried, then
 * becomes a quiet placeholder instead of a broken-image glyph. The reveal is a
 * data attribute flip, not React state, so a grid full of images landing
 * costs no renders.
 */
export function RevealImage({
  src,
  ref,
  skeleton = true,
  priority = false,
  fallback,
  fallbackSrc,
  className = '',
  onLoad,
  onError,
  loading,
  decoding,
  style,
  ...rest
}: RevealImageProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [failure, setFailure] = useState<{ src: string; count: number; waiting: boolean } | null>(null);
  // A new src starts clean, so coming back to one that failed earlier refetches it.
  if (failure && failure.src !== src) setFailure(null);
  // Fixed after mount so React never rewrites the attribute the DOM owns.
  const [initialState] = useState<RevealState>(() => (revealedSrcs.has(src) ? 'cached' : 'pending'));
  // A negative delay that lines this box's sweep up with the document clock,
  // so every waiting image in view sweeps in step however late it mounted.
  const [phase] = useState(() => `${-Math.round(performance.now() % SWEEP_MS)}ms`);

  const sources = fallbackSrc ? [src, fallbackSrc] : [src];
  const failures = failure?.src === src ? failure.count : 0;
  const waiting = failure?.src === src && failure.waiting;
  const gaveUp = failures >= sources.length + RETRY_DELAYS_MS.length;
  const shownSrc = sources[Math.min(failures, sources.length - 1)];
  const retryDelay = RETRY_DELAYS_MS[failures - sources.length];

  const setRef = useCallback(
    (node: HTMLImageElement | null) => {
      imgRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      revealedSrcs.add(shownSrc);
      if (img.dataset.reveal === 'pending' || img.dataset.reveal === 'cached') img.dataset.reveal = 'instant';
    }
    // A new src on a shown image keeps it shown: Chromium paints the old
    // picture until the new one has loaded, so there is nothing to hide.
  }, [shownSrc]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setFailure((f) => (f?.src === src ? { ...f, waiting: false } : f)), retryDelay);
    return () => clearTimeout(timer);
  }, [waiting, src, retryDelay]);

  if (waiting || gaveUp) {
    return (
      <span aria-hidden className={`reveal-fallback ${className}`}>
        {fallback ?? <ImageIcon className="h-1/4 max-h-6 min-h-3 w-auto" strokeWidth={1.5} />}
      </span>
    );
  }

  return (
    <img
      {...rest}
      ref={setRef}
      src={shownSrc}
      loading={priority ? 'eager' : (loading ?? 'lazy')}
      decoding={decoding ?? 'async'}
      fetchPriority={priority ? 'high' : rest.fetchPriority}
      data-reveal={initialState}
      style={skeleton ? ({ ...style, '--reveal-phase': phase } as CSSProperties) : style}
      className={`${skeleton ? 'reveal-img reveal-img--skeleton' : 'reveal-img'} ${className}`}
      onLoad={(e) => {
        const img = e.currentTarget;
        const shown = img.currentSrc || img.src;
        const reveal = () => {
          revealedSrcs.add(shownSrc);
          if ((img.currentSrc || img.src) === shown && img.dataset.reveal === 'pending') img.dataset.reveal = 'in';
        };
        if (img.dataset.reveal === 'pending') {
          Promise.race([img.decode(), new Promise((resolve) => setTimeout(resolve, DECODE_TIMEOUT_MS))]).then(reveal, reveal);
        } else {
          revealedSrcs.add(shownSrc);
          if (img.dataset.reveal === 'cached') img.dataset.reveal = 'instant';
        }
        onLoad?.(e);
      }}
      onError={(e) => {
        const count = failures + 1;
        setFailure({ src, count, waiting: count >= sources.length && count < sources.length + RETRY_DELAYS_MS.length });
        onError?.(e);
      }}
    />
  );
}

type LightboxView = { scale: number; x: number; y: number };

/** Shared artwork controls, with inline import actions or picker context menus. */
export function ModImageGallery({ images, modName, mainImageIndex, disabled = false, loading = false,
  blurred = false, revealOnHover = false, actionsInContextMenu = false, onImageClick, onMakeThumbnail, onRemove, onAdd, onDrop }: {
  images: string[];
  modName?: string;
  mainImageIndex?: number;
  disabled?: boolean;
  loading?: boolean;
  blurred?: boolean;
  revealOnHover?: boolean;
  actionsInContextMenu?: boolean;
  onImageClick: (index: number) => void;
  onMakeThumbnail?: (index: number) => void;
  onRemove?: (index: number) => void;
  onAdd?: () => void;
  onDrop?: DragEventHandler<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  return <div className="flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label={t('installed.batchImport.gallery')}>
    {images.map((image, index) => {
      const label = mainImageIndex === undefined
        ? t('modDetails.images.viewFullSize', { index: index + 1, total: images.length })
        : t('installed.batchImport.selectMainThumbnail', { index: index + 1 });
      const thumbnail = <button type="button" disabled={disabled} aria-label={label}
          aria-pressed={mainImageIndex === undefined ? undefined : mainImageIndex === index}
          title={mainImageIndex === index ? t('installed.batchImport.mainThumbnail') : label}
          onClick={event => {
            if (!blurred || revealOnHover && event.currentTarget.matches(':hover')) onImageClick(index);
          }} className="block h-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50">
          <RevealImage src={image} alt={modName ? t('modDetails.images.alt', { name: modName, index: index + 1 }) : t('installed.imageField.thumbnailPreview')}
            className={`h-full w-auto max-w-none object-contain ${blurred ? `blur-lg ${revealOnHover ? 'group-hover:blur-none' : ''}` : ''}`} />
        </button>;
      return <div key={image} className={`group relative h-28 shrink-0 overflow-hidden rounded-sm border bg-bg-tertiary ${mainImageIndex === index ? 'border-accent outline-2 -outline-offset-2 outline-accent' : 'border-border'}`}>
        {actionsInContextMenu ? <ImageContextMenu src={image} alt={modName ?? t('installed.imageField.thumbnailPreview')}
          actions={<>
            {onMakeThumbnail && <MenuItem icon={ImageIcon} disabled={disabled || index === 0}
              onSelect={() => onMakeThumbnail(index)}>{t('variantPicker.makeCardThumbnail')}</MenuItem>}
            {onMakeThumbnail && onRemove && <MenuSeparator />}
            {onRemove && <MenuItem icon={Trash2} tone="danger" disabled={disabled}
              onSelect={() => onRemove(index)}>{t('common.actions.remove')}</MenuItem>}
          </>}>
          {thumbnail}
        </ImageContextMenu> : thumbnail}
        {onRemove && !actionsInContextMenu && <button type="button" disabled={disabled} aria-label={t('installed.batchImport.removeImage')}
          onClick={() => onRemove(index)}
          className="absolute top-1 right-1 cursor-pointer rounded-sm bg-bg-secondary p-1 text-text-secondary opacity-0 transition-opacity hover:text-state-danger focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-50">
          <X className="h-4 w-4" aria-hidden />
        </button>}
      </div>;
    })}
    {onAdd && <button type="button" disabled={disabled} onClick={onAdd}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={onDrop}
      aria-label={t('installed.batchImport.thumbnailHint')}
      className="flex aspect-video h-28 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-dashed border-border bg-bg-tertiary text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
      {loading ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : <ImagePlus className="h-7 w-7" aria-hidden />}
    </button>}
  </div>;
}

interface ModImageLightboxProps {
  src: string;
  modName: string;
  caption?: string;
  index: number;
  count: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** Keep the overlay mounted when navigating; reset only the image's view state. */
export function ModImageLightbox(props: ModImageLightboxProps) {
  const { t } = useTranslation();
  return <Modal fullScreen onClose={props.onClose} ariaLabel={t('modDetails.images.fullSizeAria', { name: props.modName })}
    onKeyDown={event => {
      if (props.count > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') props.onPrevious(); else props.onNext();
      }
    }}>
    <LightboxImage key={`${props.modName}:${props.index}:${props.src}`} {...props} />
  </Modal>;
}

/** Each image opening owns its zoom, bounded pan, and control visibility. */
function LightboxImage({ src, modName, caption, index, count, onClose, onPrevious, onNext }: ModImageLightboxProps) {
  const { t } = useTranslation();
  const backdropRef = useBackdropDismiss<HTMLDivElement>(onClose);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<LightboxView>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null);

  const applyView = useCallback((next: LightboxView) => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return;
    // Keep smaller axes centered; larger ones can pan only as far as their edges.
    const maxX = Math.max(0, (image.offsetWidth * next.scale - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * next.scale - viewport.clientHeight) / 2);
    const clamped = { scale: next.scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    const current = viewRef.current;
    if (current.scale === clamped.scale && current.x === clamped.x && current.y === clamped.y) return;
    viewRef.current = clamped;
    setView(clamped);
  }, []);

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element;
      if (target.closest('figcaption, [data-lightbox-controls]')) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = viewportRef.current;
      const image = imageRef.current;
      if (!viewport || !image?.naturalWidth || !event.deltaY || drag.current) return;
      const current = viewRef.current;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      const scale = Math.max(1, Math.min(8, current.scale * Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.002)));
      if (scale === current.scale) return;
      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      const ratio = scale / current.scale;
      applyView({ scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio });
      setControlsVisible(scale === 1);
    };
    // React wheel handlers are passive in Chromium; prevent page/browser zoom here.
    backdrop.addEventListener('wheel', onWheel, { passive: false });
    return () => backdrop.removeEventListener('wheel', onWheel);
  }, [applyView, backdropRef]);

  useLayoutEffect(() => {
    const clamp = () => applyView(viewRef.current);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(clamp);
    if (viewportRef.current) observer?.observe(viewportRef.current);
    if (imageRef.current) observer?.observe(imageRef.current);
    window.addEventListener('resize', clamp);
    return () => { observer?.disconnect(); window.removeEventListener('resize', clamp); };
  }, [applyView]);

  const endDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const alt = t('modDetails.images.altFullSize', { name: modName, index: index + 1 });

  return (
    <div ref={backdropRef} className="always-dark absolute inset-0 flex items-center justify-center overflow-hidden bg-black/95 p-4">
      <div data-lightbox-controls inert={!controlsVisible} aria-hidden={!controlsVisible}
        className={`pointer-events-none absolute inset-0 z-10 transition-opacity duration-150 motion-reduce:transition-none ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
        <button type="button" onClick={event => { event.stopPropagation(); onClose(); }} aria-label={t('modDetails.aria.closeFullSizeView')}
          className="pointer-events-auto absolute top-4 right-4 rounded-full border border-hl/15 bg-black/60 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white cursor-pointer">
          <X className="h-5 w-5" />
        </button>
        {count > 1 && <>
          <button type="button" onClick={event => { event.stopPropagation(); onPrevious(); }} aria-label={t('modDetails.aria.previousImage')}
            className="pointer-events-auto absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-hl/15 bg-black/60 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white cursor-pointer">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button type="button" onClick={event => { event.stopPropagation(); onNext(); }} aria-label={t('modDetails.aria.nextImage')}
            className="pointer-events-auto absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-hl/15 bg-black/60 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white cursor-pointer">
            <ChevronRight className="h-6 w-6" />
          </button>
          <div className="absolute top-4 left-4 rounded-md border border-hl/15 bg-black/60 px-2.5 py-1 text-xs text-white/90 backdrop-blur-sm">{index + 1} / {count}</div>
        </>}
      </div>
      <figure className="pointer-events-none flex h-full w-full min-h-0 flex-col items-center gap-3" onClick={event => event.stopPropagation()}>
        <div ref={viewportRef} data-lightbox-viewport className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
          <ImageContextMenu src={src} alt={alt}>
            <img ref={imageRef} src={src} alt={alt} draggable={false}
              className={`pointer-events-auto max-h-full max-w-full touch-none select-none object-contain ${view.scale > 1 ? dragging ? 'cursor-grabbing' : 'cursor-grab' : 'cursor-default'}`}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
              onLoad={() => applyView(viewRef.current)}
              onClick={event => {
                event.stopPropagation();
                if (viewRef.current.scale === 1) setControlsVisible(visible => !visible);
              }}
              onPointerDown={event => {
                if (event.button !== 0 || viewRef.current.scale === 1) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: viewRef.current.x, y: viewRef.current.y };
                setDragging(true);
              }}
              onPointerMove={event => {
                const active = drag.current;
                if (!active || active.pointerId !== event.pointerId) return;
                const dx = event.clientX - active.startX;
                const dy = event.clientY - active.startY;
                applyView({ scale: viewRef.current.scale, x: active.x + dx, y: active.y + dy });
              }}
              onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
            />
          </ImageContextMenu>
        </div>
        {caption && <figcaption className="pointer-events-auto max-h-32 w-full max-w-3xl shrink-0 overflow-y-auto whitespace-pre-wrap break-words text-center text-sm text-text-secondary select-text">{caption}</figcaption>}
      </figure>
    </div>
  );
}
