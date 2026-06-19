import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, Crop, ZoomIn, RotateCcw, ImagePlus } from 'lucide-react';
import { Toggle } from '../common/ui';
import { getHeroNamePath } from '../../lib/lockerUtils';

interface LockerImageCropperProps {
  /** Source image to frame (any size), as a data URL. Null = nothing picked yet:
   *  the viewport renders empty so the framing surface is previewed up front. */
  imageDataUrl: string | null;
  /** Output/preview aspect ratio (width / height). Card = 3/4, backdrop = 16/9. */
  aspect?: number;
  /** Hero whose name label is previewed (when nameControls is on). */
  heroName?: string;
  /** Show the hero-name overlay preview (matching surfaces that bake the name
   *  over the image). The "hide name" toggle is gated separately by
   *  `allowHideName` so a surface can preview its name without offering to hide
   *  it (e.g. the backdrop, whose name logo always shows). */
  nameControls?: boolean;
  /** Show the "hide hero name label" toggle. Only meaningful with nameControls.
   *  Defaults to nameControls so existing callers keep the combined behavior. */
  allowHideName?: boolean;
  /** Where the name label sits, matching its real surface: the card overlays it
   *  bottom-right; the focus-view backdrop shows the name logo top-left. */
  namePosition?: 'card' | 'backdrop';
  /** Initial state of the "hide hero name label" toggle. */
  initialHideHeroName?: boolean;
  /** Restore the previous framing (normalized source-fraction rect) when reopening
   *  on a stored original source, instead of centering at cover. Applied on each
   *  (re)load of `imageDataUrl`; clear it when staging a freshly picked source so
   *  the new pick centers. The rect's aspect should match `aspect`. */
  initialCrop?: { sx: number; sy: number; sw: number; sh: number };
  /** Hint shown over the empty viewport before a source is chosen. */
  emptyHint?: string;
  busy?: boolean;
  /** Receives the framed image (PNG data URL at `aspect`), the name choice, and
   *  the ORIGINAL source + normalized crop rect so the edit can be persisted for
   *  a full-fidelity reopen. */
  onApply: (result: {
    dataUrl: string;
    hideHeroName: boolean;
    source: string;
    crop: { sx: number; sy: number; sw: number; sh: number };
  }) => void;
}

/** The editing viewport keeps the target aspect; the source is scaled to cover it
 *  and pans/zooms within. */
const MAX_ZOOM = 5;
/** Cap the baked output so we never upscale a small source past this long edge. */
const MAX_OUTPUT_LONG = 1280;

/** A real Locker grid card is ~230px wide; its name label and padding are fixed
 *  px tuned to that width. The crop viewport differs, so the overlay's fixed-px
 *  chrome would render off-scale. Reproduce it as a proportion of the viewport
 *  instead, so the preview is to scale with the card. */
const REFERENCE_CARD_W = 230;

/** Sizing for the side-by-side pane the editor lives in. */
const PANE_MAX_W = 300;
const PANE_MAX_H = 400;
const PANE_MIN_H = 180;
/** Vertical space the modal chrome around the preview needs (header, tabs, the
 *  zoom/toggle/button stack below, paddings + gaps). Used so the preview shrinks
 *  on short windows instead of overflowing them. */
const CHROME_BUDGET = 360;

/** Largest viewport at `aspect` that fits the pane width and the window height. */
function fitView(aspect: number): { w: number; h: number } {
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const maxH = Math.max(PANE_MIN_H, Math.min(PANE_MAX_H, winH - CHROME_BUDGET));
  let w = PANE_MAX_W;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/**
 * Inline frame-and-preview editor for a per-skin Locker image (issue #208).
 *
 * Lives in the left pane of the unified image picker. The chosen image would
 * otherwise be `object-cover`-stretched onto its surface (the 3:4 card, or the
 * wide hero-detail backdrop) with no say in framing, and a card image can clash
 * with art that bakes the hero name in. This editor fixes both: the user frames
 * the image inside a viewport locked to the target aspect (pan + zoom). In card
 * mode it also overlays the real hero-name label exactly as the card renders it,
 * with a live toggle to hide it. On apply we export at the target aspect so the
 * downstream `object-cover` is a clean, undistorted scale. With no source picked
 * yet the viewport renders empty so the framing surface is previewed up front.
 */
export default function LockerImageCropper({
  imageDataUrl,
  aspect = 3 / 4,
  heroName = '',
  nameControls = true,
  allowHideName,
  namePosition = 'card',
  initialHideHeroName = false,
  initialCrop,
  emptyHint,
  busy = false,
  onApply,
}: LockerImageCropperProps) {
  const { t } = useTranslation();

  // Fit the viewport once per aspect (the editor is remounted on tab switch).
  const [view] = useState(() => fitView(aspect));
  const VIEW_W = view.w;
  const VIEW_H = view.h;
  const previewScale = VIEW_W / REFERENCE_CARD_W;
  // Card name label: w-[70%] h-7 (28px) with p-3 (12px) padding on the real card.
  const NAME_HEIGHT = Math.round(28 * previewScale);
  const NAME_PADDING = Math.round(12 * previewScale);
  const NAME_FALLBACK_FONT = Math.round(14 * previewScale);
  // Backdrop name logo sits top-left; size it as a small fraction of the wide
  // viewport, roughly matching the focus view's h-8 logo over the full backdrop.
  const BD_NAME_HEIGHT = Math.round(VIEW_W * 0.08);
  const BD_NAME_PADDING = Math.round(VIEW_W * 0.05);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Top-left of the drawn image relative to the viewport, in CSS px (<= 0).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hideHeroName, setHideHeroName] = useState(initialHideHeroName);
  const [nameFailed, setNameFailed] = useState(false);
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Scale at which the source just covers the viewport (zoom 1 == cover).
  const coverScale = img ? Math.max(VIEW_W / img.naturalWidth, VIEW_H / img.naturalHeight) : 1;
  const drawnW = img ? img.naturalWidth * coverScale * zoom : VIEW_W;
  const drawnH = img ? img.naturalHeight * coverScale * zoom : VIEW_H;

  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(VIEW_W - drawnW, x)),
      y: Math.min(0, Math.max(VIEW_H - drawnH, y)),
    }),
    [VIEW_W, VIEW_H, drawnW, drawnH]
  );

  // Load the source image to learn its natural size, then center it at cover.
  // A null source clears any prior framing back to the empty viewport.
  useEffect(() => {
    if (!imageDataUrl) {
      setImg(null);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError(null);
      return;
    }
    let active = true;
    const el = new Image();
    el.onload = () => {
      if (!active) return;
      setImg(el);
      const natW = el.naturalWidth;
      const natH = el.naturalHeight;
      const cs = Math.max(VIEW_W / natW, VIEW_H / natH);
      if (initialCrop && natW > 0 && natH > 0 && initialCrop.sw > 0) {
        // Restore the previous framing. The viewport spans `initialCrop.sw * natW`
        // source px, so the needed render scale is VIEW_W / that. Express it as a
        // zoom multiple of cover, clamped, then derive the clamped offset.
        const rawScale = VIEW_W / (initialCrop.sw * natW);
        const z = Math.min(MAX_ZOOM, Math.max(1, rawScale / cs));
        const scale = cs * z;
        const drawnWNow = natW * scale;
        const drawnHNow = natH * scale;
        setZoom(z);
        setOffset({
          x: Math.min(0, Math.max(VIEW_W - drawnWNow, -initialCrop.sx * natW * scale)),
          y: Math.min(0, Math.max(VIEW_H - drawnHNow, -initialCrop.sy * natH * scale)),
        });
      } else {
        setOffset({ x: (VIEW_W - natW * cs) / 2, y: (VIEW_H - natH * cs) / 2 });
        setZoom(1);
      }
      setError(null);
    };
    el.onerror = () => {
      if (active) setError(t('locker.crop.imageLoadFailed'));
    };
    el.src = imageDataUrl;
    return () => {
      active = false;
    };
  }, [imageDataUrl, initialCrop, t, VIEW_W, VIEW_H]);

  // Zoom around the viewport center so the framed subject stays put.
  const applyZoom = useCallback(
    (nextZoom: number) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      if (!img) {
        setZoom(z);
        return;
      }
      const cx = (VIEW_W / 2 - offset.x) / (coverScale * zoom);
      const cy = (VIEW_H / 2 - offset.y) / (coverScale * zoom);
      const nx = VIEW_W / 2 - cx * coverScale * z;
      const ny = VIEW_H / 2 - cy * coverScale * z;
      const newDrawnW = img.naturalWidth * coverScale * z;
      const newDrawnH = img.naturalHeight * coverScale * z;
      setZoom(z);
      setOffset({
        x: Math.min(0, Math.max(VIEW_W - newDrawnW, nx)),
        y: Math.min(0, Math.max(VIEW_H - newDrawnH, ny)),
      });
    },
    [img, offset, zoom, coverScale, VIEW_W, VIEW_H]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset(
      clamp(
        drag.current.ox + (e.clientX - drag.current.startX),
        drag.current.oy + (e.clientY - drag.current.startY)
      )
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!img) return;
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  };

  const handleApply = () => {
    if (!img || !imageDataUrl) return;
    const scale = coverScale * zoom;
    // The viewport maps to this rect in source-image natural coordinates.
    const srcX = -offset.x / scale;
    const srcY = -offset.y / scale;
    const srcW = VIEW_W / scale;
    const srcH = VIEW_H / scale;
    // Normalized (source-fraction) crop rect, persisted alongside the original
    // source so reopening restores this exact framing (and can reveal more).
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const crop = { sx: srcX / natW, sy: srcY / natH, sw: srcW / natW, sh: srcH / natH };
    // Bake at the crop's own resolution (capped on the long edge), preserving aspect.
    const longSrc = Math.max(srcW, srcH);
    const k = longSrc > MAX_OUTPUT_LONG ? MAX_OUTPUT_LONG / longSrc : 1;
    const outW = Math.max(1, Math.round(srcW * k));
    const outH = Math.max(1, Math.round(srcH * k));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError(t('locker.crop.noCanvasContext'));
      return;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
    onApply({ dataUrl: canvas.toDataURL('image/png'), hideHeroName, source: imageDataUrl, crop });
  };

  const namePath = getHeroNamePath(heroName);

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex justify-center">
        {/* Viewport doubles as a live preview: same gradient, and (card mode)
            the hero-name overlay the real card renders. Empty until a source is
            chosen, but still at the target shape so the framing is previewed. */}
        <div
          className="relative touch-none select-none overflow-hidden rounded-xl border border-border bg-bg-primary/60"
          style={{ width: VIEW_W, height: VIEW_H, cursor: img ? 'grab' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {img ? (
            <img
              src={imageDataUrl ?? undefined}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ left: offset.x, top: offset.y, width: drawnW, height: drawnH }}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-text-secondary">
              <ImagePlus className="h-6 w-6 opacity-70" />
              {emptyHint && <span className="text-[11px] leading-snug">{emptyHint}</span>}
            </div>
          )}

          {/* Chrome preview (pointer-events-none so it never blocks drag). */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80" />
            {nameControls && !hideHeroName && namePosition === 'card' && (
              <div
                className="absolute bottom-0 left-0 right-0 flex flex-col items-end text-right"
                style={{ padding: NAME_PADDING }}
              >
                {nameFailed ? (
                  <div
                    className="font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
                    style={{ fontSize: NAME_FALLBACK_FONT }}
                  >
                    {heroName}
                  </div>
                ) : (
                  <div className="relative ml-auto w-[70%]" style={{ height: NAME_HEIGHT }}>
                    <img
                      src={namePath}
                      alt={heroName}
                      className="absolute inset-0 h-full w-full object-contain object-right drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
                      onError={() => setNameFailed(true)}
                    />
                  </div>
                )}
              </div>
            )}
            {nameControls && !hideHeroName && namePosition === 'backdrop' && (
              <div className="absolute left-0 top-0" style={{ padding: BD_NAME_PADDING }}>
                {nameFailed ? (
                  <div
                    className="font-bold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
                    style={{ fontSize: Math.round(BD_NAME_HEIGHT * 0.9) }}
                  >
                    {heroName}
                  </div>
                ) : (
                  <img
                    src={namePath}
                    alt={heroName}
                    className="w-auto object-contain object-left drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
                    style={{ height: BD_NAME_HEIGHT }}
                    onError={() => setNameFailed(true)}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ZoomIn className="h-4 w-4 flex-shrink-0 text-text-secondary" />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          disabled={!img}
          onChange={(e) => applyZoom(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="w-10 text-right text-[11px] tabular-nums text-text-secondary">
          {zoom.toFixed(1)}x
        </span>
        <button
          type="button"
          disabled={!img}
          onClick={() => applyZoom(1)}
          title={t('locker.crop.resetZoom')}
          className="cursor-pointer rounded-md border border-border/60 p-1 text-text-secondary transition-colors hover:border-white/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {(allowHideName ?? nameControls) && (
        <Toggle
          checked={hideHeroName}
          onChange={setHideHeroName}
          label={t('locker.modImage.hideHeroName')}
          description={t('locker.modImage.hideHeroNameHint')}
        />
      )}

      <button
        type="button"
        disabled={!img || !!error || busy}
        onClick={handleApply}
        className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crop className="h-3.5 w-3.5" />}
        {t('locker.modImage.useImage')}
      </button>
    </div>
  );
}
