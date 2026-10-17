import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes, type ReactNode, type Ref } from 'react';
import { ImageIcon } from 'lucide-react';

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
