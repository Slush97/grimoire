import { EyeOff } from 'lucide-react';
import type { MergedModSource } from '../types/mod';
import { getHeroRenderPath } from '../lib/lockerUtils';
import ImageContextMenu from './ImageContextMenu';

interface ModThumbnailProps {
  src?: string;
  alt: string;
  nsfw?: boolean;
  hideNsfw?: boolean;
  className?: string;
  imageClassName?: string;
  imageFit?: 'cover' | 'contain' | 'fill';
  imagePosition?: string;
  fallback?: React.ReactNode;
  /** Canonical Deadlock hero name (e.g. "Lady Geist"). When set, the hero's
   *  render image is used instead of `src`. Sound mods use this so the locker
   *  reads as "Geist sounds" at a glance rather than showing the uploader's
   *  generic speaker icon. */
  heroPortrait?: string;
  /** When present, render an N-up collage of the source thumbnails instead
   *  of the single `src` image. Used by merged mods. The single-image path
   *  is still used when the user uploaded an override thumbnail (we treat
   *  any non-empty `src` as the explicit choice). */
  mergedSources?: MergedModSource[];
}

export default function ModThumbnail({
  src,
  alt,
  nsfw,
  hideNsfw,
  className = '',
  imageClassName = '',
  imageFit = 'cover',
  imagePosition,
  fallback,
  heroPortrait,
  mergedSources,
}: ModThumbnailProps) {
  const shouldBlur = nsfw && hideNsfw;
  // Hero portrait wins over the uploader's thumbnail. NSFW blur is suppressed
  // here because hero renders are official Valve art, not user uploads.
  const resolvedSrc = heroPortrait ? getHeroRenderPath(heroPortrait) : src;
  const resolvedBlur = heroPortrait ? false : shouldBlur;

  // Collage path: only when there's no explicit src and we have sources to
  // tile. The user-uploaded thumbnail (when set) always wins so they have a
  // way to override the collage if they don't like it.
  if (!resolvedSrc && mergedSources && mergedSources.length > 0) {
    return (
      <MergedCollage
        sources={mergedSources}
        alt={alt}
        className={className}
        shouldBlur={shouldBlur}
      />
    );
  }

  if (!resolvedSrc) {
    return (
      fallback ?? (
        <div className={`flex items-center justify-center text-text-secondary text-xs ${className}`}>
          No preview
        </div>
      )
    );
  }

  const thumbnail = (
    <div className={`relative overflow-hidden ${className}`}>
      <div className={`w-full h-full ${imageClassName}`}>
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={`block h-full w-full ${imageFit === 'contain' ? 'object-contain' : imageFit === 'fill' ? 'object-fill' : 'object-cover'} transition-[filter] duration-200 ${
            resolvedBlur ? 'blur-xl scale-110' : ''
          }`}
          style={imagePosition ? { objectPosition: imagePosition } : undefined}
        />
      </div>
      {resolvedBlur && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/40">
          <EyeOff className="w-4 h-4 text-white/70" />
          <span className="text-[9px] text-white/70 mt-0.5">NSFW</span>
        </div>
      )}
    </div>
  );

  if (resolvedBlur) return thumbnail;

  return (
    <ImageContextMenu src={resolvedSrc} alt={alt}>
      {thumbnail}
    </ImageContextMenu>
  );
}

interface MergedCollageProps {
  sources: MergedModSource[];
  alt: string;
  className: string;
  shouldBlur?: boolean;
}

/**
 * NxM collage of source thumbnails for merged mods. Only sources with an
 * actual thumbnail are rendered — we never show "missing asset" placeholder
 * cells. Grid shape is picked to keep cells roughly square on a wide card;
 * with more than 16 thumbnails the last cell becomes a "+N more" tile.
 */
function MergedCollage({ sources, alt, className, shouldBlur }: MergedCollageProps) {
  const { cells, cols } = buildCollage(sources);
  return (
    <div className={`relative overflow-hidden bg-bg-tertiary ${className}`}>
      <div
        className="grid w-full h-full gap-px bg-bg-tertiary"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        aria-label={alt}
      >
        {cells.map((cell, idx) => (
          <div key={idx} className="relative bg-bg-tertiary overflow-hidden">
            {cell.kind === 'image' ? (
              shouldBlur ? (
                <img
                  src={cell.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="block w-full h-full object-cover blur-xl scale-110"
                />
              ) : (
                <ImageContextMenu src={cell.url} alt={alt}>
                  <img
                    src={cell.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="block w-full h-full object-cover"
                  />
                </ImageContextMenu>
              )
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-semibold text-text-secondary">
                +{cell.count}
              </div>
            )}
          </div>
        ))}
      </div>
      {shouldBlur && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/40 pointer-events-none">
          <EyeOff className="w-4 h-4 text-white/70" />
          <span className="text-[9px] text-white/70 mt-0.5">NSFW</span>
        </div>
      )}
    </div>
  );
}

type CollageCell =
  | { kind: 'image'; url: string }
  | { kind: 'overflow'; count: number };

/**
 * Build the collage from sources that actually have a thumbnail. Sources
 * without one are skipped (the badge on the card still reports the full
 * source count). Grid shape biases toward wide layouts since cards are
 * aspect-video; trailing partial-row cells, if any, blend into the card
 * surface because the grid parent uses the same bg as the cells.
 */
function buildCollage(sources: MergedModSource[]): { cells: CollageCell[]; cols: number } {
  const withThumbs = sources.filter((s) => !!s.thumbnailUrl);
  const total = withThumbs.length;
  if (total === 0) return { cells: [], cols: 1 };

  const MAX_VISIBLE = 16;
  let visible = total;
  let overflow = 0;
  if (total > MAX_VISIBLE) {
    visible = MAX_VISIBLE - 1;
    overflow = total - visible;
  }
  const cellCount = visible + (overflow > 0 ? 1 : 0);
  const cols = pickCols(cellCount);

  const cells: CollageCell[] = [];
  for (let i = 0; i < visible; i++) {
    cells.push({ kind: 'image', url: withThumbs[i].thumbnailUrl! });
  }
  if (overflow > 0) cells.push({ kind: 'overflow', count: overflow });
  return { cells, cols };
}

/**
 * Pick a column count that keeps cells roughly square on an aspect-video
 * card surface (~16:9). Mirrors the prior 2x2 → 3x3 → 4x4 step pattern but
 * scales by total cell count rather than source count so the overflow tile
 * is included in the layout.
 */
function pickCols(n: number): number {
  if (n <= 1) return 1;
  if (n <= 2) return 2;
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  if (n <= 9) return 3;
  return 4;
}
