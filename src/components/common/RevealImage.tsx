import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes, type ReactNode, type Ref } from 'react';
import { ImageIcon } from 'lucide-react';

// URLs this session has already shown. A remount (virtualized grid scrolling
// back, a route revisit) shows them at once instead of fading them in again.
const revealedSrcs = new Set<string>();

// Period of the placeholder sweep in index.css (skeletonSweepLocal).
const SWEEP_MS = 1900;

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
}

/**
 * An <img> that never shows a half-painted image. It stays hidden (behind a
 * skeleton) until the bytes are in and decoded, then fades in. An image the
 * browser already has shows instantly, and a failed one becomes a quiet
 * placeholder instead of a broken-image glyph. The reveal is a data attribute
 * flip, not React state, so a grid full of images landing costs no renders.
 */
export function RevealImage({
  src,
  ref,
  skeleton = true,
  priority = false,
  fallback,
  className = '',
  onLoad,
  onError,
  loading,
  decoding,
  style,
  ...rest
}: RevealImageProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Fixed after mount so React never rewrites the attribute the DOM owns.
  const [initialState] = useState<RevealState>(() => (revealedSrcs.has(src) ? 'cached' : 'pending'));
  // A negative delay that lines this box's sweep up with the document clock,
  // so every waiting image in view sweeps in step however late it mounted.
  const [phase] = useState(() => `${-Math.round(performance.now() % SWEEP_MS)}ms`);

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
      revealedSrcs.add(src);
      if (img.dataset.reveal === 'pending' || img.dataset.reveal === 'cached') img.dataset.reveal = 'instant';
    }
    // A new src on a shown image keeps it shown: Chromium paints the old
    // picture until the new one has loaded, so there is nothing to hide.
  }, [src]);

  if (failedSrc === src) {
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
      src={src}
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
          revealedSrcs.add(src);
          if ((img.currentSrc || img.src) === shown && img.dataset.reveal === 'pending') img.dataset.reveal = 'in';
        };
        if (img.dataset.reveal === 'pending') img.decode().then(reveal, reveal);
        else {
          revealedSrcs.add(src);
          if (img.dataset.reveal === 'cached') img.dataset.reveal = 'instant';
        }
        onLoad?.(e);
      }}
      onError={(e) => {
        setFailedSrc(src);
        onError?.(e);
      }}
    />
  );
}
