import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Crop, ZoomIn, RotateCcw, ImagePlus } from 'lucide-react';
import { Button, Toggle } from '../common/ui';
import { getHeroNamePath } from '../../lib/lockerUtils';

interface LockerImageCropperProps {
  /** Source image to frame (any size), as a data URL. Null = nothing picked yet:
   *  the frame renders empty so the framing surface is previewed up front. */
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
   *  on a stored original source, instead of defaulting to centered cover. Applied
   *  on each (re)load of `imageDataUrl`; clear it when staging a freshly picked
   *  source so the new pick centers. Aspect should match `aspect`. */
  initialCrop?: { sx: number; sy: number; sw: number; sh: number };
  /** Hint shown over the empty frame before a source is chosen. */
  emptyHint?: string;
  /** When set, the empty frame acts as an upload drop zone: clicking it invokes
   *  this (e.g. opens the native file picker) and dropping an image file invokes
   *  `onDropFile`. Without it the empty frame is a passive placeholder. */
  onPickClick?: () => void;
  /** Receives an image file dropped onto the empty frame (paired with onPickClick). */
  onDropFile?: (file: File) => void;
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

/** Cap the baked output so we never upscale a small source past this long edge. */
const MAX_OUTPUT_LONG = 1280;
/** Closest the image may be zoomed in (1 = "cover" the frame). */
const MAX_ZOOM = 5;

/** A real Locker grid card is ~230px wide; its name label and padding are fixed
 *  px tuned to that width. The frame differs, so the overlay's fixed-px chrome
 *  would render off-scale. Reproduce it as a proportion of the frame instead, so
 *  the preview is to scale with the card. */
const REFERENCE_CARD_W = 230;

/** Editor sizing. The frame is bounded by a fraction of the live viewport (not a
 *  hardcoded chrome budget) so it never scales past the window: width shrinks with
 *  narrow windows, height with short ones. The modal around it also scrolls, so
 *  these are caps, not exact fits. */
const FRAME_MAX_W = 320;
const FRAME_MIN_W = 160;
const FRAME_MAX_H = 420;
const FRAME_MIN_H = 160;
/** Horizontal room the surrounding modal padding/margins take. */
const FRAME_MARGIN_W = 96;
/** Share of the window height the frame may occupy. */
const FRAME_VH = 0.4;

/** The box (in CSS px) the frame is bounded within, clamped to the viewport. */
function frameBudget(): { w: number; h: number } {
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  return {
    w: Math.max(FRAME_MIN_W, Math.min(FRAME_MAX_W, winW - FRAME_MARGIN_W)),
    h: Math.max(FRAME_MIN_H, Math.min(FRAME_MAX_H, Math.round(winH * FRAME_VH))),
  };
}

/** Largest box at the given aspect that fits the budget: this is the crop frame. */
function fitAspect(aspect: number): { w: number; h: number } {
  const { w: maxW, h: maxH } = frameBudget();
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

type Offset = { x: number; y: number };

/**
 * Inline frame-and-preview editor for a per-skin Locker / sidebar image.
 *
 * Fixed-frame model (the same one `CardCropper` uses): the crop frame is locked to
 * the target aspect and stays put; the source image is drawn behind it scaled to
 * "cover" (zoom 1) and the user drags to reposition and zooms (wheel / slider) to
 * frame the exact portion they want. Everything outside the frame is hidden by the
 * frame's `overflow-hidden`, so what you see in the frame is exactly what bakes.
 * In card mode the frame also overlays the real hero-name label exactly as the card
 * renders it, with a live toggle to hide it. On apply we export the framed region at
 * the target aspect so the downstream `object-cover` is a clean, undistorted scale.
 * With no source picked yet the frame renders empty at the target shape so the
 * surface is previewed.
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
  onPickClick,
  onDropFile,
  busy = false,
  onApply,
}: LockerImageCropperProps) {
  const { t } = useTranslation();

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  // The crop frame (target aspect), responsive to the live viewport.
  const [frame, setFrame] = useState(() => fitAspect(aspect));
  const [zoom, setZoom] = useState(1);
  // Top-left of the drawn image relative to the frame, in CSS px (<= 0).
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [hideHeroName, setHideHeroName] = useState(initialHideHeroName);
  const [nameFailed, setNameFailed] = useState(false);
  // Highlight the empty frame while an image file is dragged over it.
  const [dropActive, setDropActive] = useState(false);

  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // The empty frame doubles as an upload drop zone when the caller wires it up.
  const dropZone = !img && !!(onPickClick || onDropFile);

  const FRAME_W = frame.w;
  const FRAME_H = frame.h;

  // Scale at which the source just covers the frame (zoom 1 == cover), and the
  // drawn image size at the current zoom.
  const coverScale = img ? Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight) : 1;
  const drawnW = img ? img.naturalWidth * coverScale * zoom : FRAME_W;
  const drawnH = img ? img.naturalHeight * coverScale * zoom : FRAME_H;

  // Keep the image fully covering the frame (offset within [frame - drawn, 0]).
  const clamp = useCallback(
    (x: number, y: number): Offset => ({
      x: Math.min(0, Math.max(FRAME_W - drawnW, x)),
      y: Math.min(0, Math.max(FRAME_H - drawnH, y)),
    }),
    [FRAME_W, FRAME_H, drawnW, drawnH]
  );

  // Load the source to learn its natural size, then place it: restored framing
  // (normalized crop rect) if provided, otherwise centered at cover. A null source
  // clears back to the empty placeholder frame.
  useEffect(() => {
    if (!imageDataUrl) {
      setImg(null);
      setFrame(fitAspect(aspect));
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError(null);
      return;
    }
    let active = true;
    const el = new Image();
    el.onload = () => {
      if (!active) return;
      const fr = fitAspect(aspect);
      const cover = Math.max(fr.w / el.naturalWidth, fr.h / el.naturalHeight);
      setImg(el);
      setFrame(fr);
      if (initialCrop && initialCrop.sw > 0 && initialCrop.sh > 0) {
        // Restore: the frame spans `sw` of the source width, anchored at (sx, sy).
        const scale = fr.w / (initialCrop.sw * el.naturalWidth);
        const z = Math.min(MAX_ZOOM, Math.max(1, scale / cover));
        const s = cover * z;
        const dW = el.naturalWidth * s;
        const dH = el.naturalHeight * s;
        setZoom(z);
        setOffset({
          x: Math.min(0, Math.max(fr.w - dW, -initialCrop.sx * el.naturalWidth * s)),
          y: Math.min(0, Math.max(fr.h - dH, -initialCrop.sy * el.naturalHeight * s)),
        });
      } else {
        setZoom(1);
        setOffset({
          x: (fr.w - el.naturalWidth * cover) / 2,
          y: (fr.h - el.naturalHeight * cover) / 2,
        });
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
  }, [imageDataUrl, initialCrop, aspect, t]);

  // Keep the frame within the window when it resizes. Aspect is fixed, so the
  // frame scales uniformly; scale the offset by the same factor to hold framing.
  useEffect(() => {
    const onResize = () => {
      const next = fitAspect(aspect);
      setFrame((prev) => {
        if (img && prev.w > 0) {
          const factor = next.w / prev.w;
          setOffset((o) => ({ x: o.x * factor, y: o.y * factor }));
        }
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [img, aspect]);

  // Zoom around the frame center so the framed subject stays put.
  const applyZoom = useCallback(
    (nextZoom: number) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      if (!img) {
        setZoom(z);
        return;
      }
      // Source point currently under the frame center, then re-place it there.
      const cx = (FRAME_W / 2 - offset.x) / (coverScale * zoom);
      const cy = (FRAME_H / 2 - offset.y) / (coverScale * zoom);
      const nx = FRAME_W / 2 - cx * coverScale * z;
      const ny = FRAME_H / 2 - cy * coverScale * z;
      const newDrawnW = img.naturalWidth * coverScale * z;
      const newDrawnH = img.naturalHeight * coverScale * z;
      setZoom(z);
      setOffset({
        x: Math.min(0, Math.max(FRAME_W - newDrawnW, nx)),
        y: Math.min(0, Math.max(FRAME_H - newDrawnH, ny)),
      });
    },
    [img, offset, zoom, coverScale, FRAME_W, FRAME_H]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset(clamp(drag.current.ox + (e.clientX - drag.current.startX), drag.current.oy + (e.clientY - drag.current.startY)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!img) return;
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  };

  // Empty-frame upload drop zone (only while no source is staged).
  const onDropZoneOver = (e: React.DragEvent) => {
    if (!dropZone || busy) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };
  const onDropZoneLeave = () => {
    if (dropActive) setDropActive(false);
  };
  const onDropZoneDrop = (e: React.DragEvent) => {
    if (!dropZone || busy) return;
    e.preventDefault();
    setDropActive(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) onDropFile?.(file);
  };

  const reset = () => {
    if (!img) return;
    setZoom(1);
    setOffset({
      x: (FRAME_W - img.naturalWidth * coverScale) / 2,
      y: (FRAME_H - img.naturalHeight * coverScale) / 2,
    });
  };

  const handleApply = () => {
    if (!img || !imageDataUrl) return;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const scale = coverScale * zoom;
    // The frame maps to this rect in source-image natural coordinates.
    const srcX = -offset.x / scale;
    const srcY = -offset.y / scale;
    const srcW = FRAME_W / scale;
    const srcH = FRAME_H / scale;
    // Normalized (source-fraction) crop rect, persisted for a full-fidelity reopen.
    const crop = { sx: srcX / natW, sy: srcY / natH, sw: srcW / natW, sh: srcH / natH };
    // Bake at the framed region's own resolution (capped on the long edge).
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

  // Name chrome scales with the frame (its baked surface), not a reference card.
  const previewScale = FRAME_W / REFERENCE_CARD_W;
  const NAME_HEIGHT = Math.round(28 * previewScale);
  const NAME_PADDING = Math.round(12 * previewScale);
  const NAME_FALLBACK_FONT = Math.round(14 * previewScale);
  const BD_NAME_HEIGHT = Math.round(FRAME_W * 0.08);
  const BD_NAME_PADDING = Math.round(FRAME_W * 0.05);

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-state-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex justify-center">
        {/* Crop frame (target aspect): the source is drawn behind it and pans /
            zooms; the frame clips to what bakes, and overlays the hero-name chrome
            so the preview is to scale. Empty (target shape) until a source picked. */}
        <div
          className={`relative touch-none select-none overflow-hidden rounded-xl border bg-bg-primary/60 transition-colors ${
            dropActive ? 'border-accent bg-accent/10' : dropZone ? 'border-dashed border-border hover:border-accent/60' : 'border-border'
          }`}
          style={{ width: FRAME_W, height: FRAME_H, cursor: img ? 'grab' : dropZone ? 'pointer' : 'default' }}
          role={dropZone ? 'button' : undefined}
          tabIndex={dropZone ? 0 : undefined}
          aria-label={dropZone ? (emptyHint ?? t('locker.modImage.useImage')) : undefined}
          onClick={dropZone && !busy ? onPickClick : undefined}
          onKeyDown={
            dropZone && !busy
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPickClick?.();
                  }
                }
              : undefined
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onDragOver={onDropZoneOver}
          onDragLeave={onDropZoneLeave}
          onDrop={onDropZoneDrop}
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
            <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-text-secondary">
              <ImagePlus className={`h-6 w-6 ${dropActive ? 'text-accent opacity-100' : 'opacity-70'}`} />
              {emptyHint && <span className="text-[11px] leading-snug">{emptyHint}</span>}
            </div>
          )}

          {img && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {/* Rule-of-thirds guides. */}
              <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/25" />
              <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/25" />
              <div className="absolute top-1/3 left-0 right-0 h-px bg-white/25" />
              <div className="absolute top-2/3 left-0 right-0 h-px bg-white/25" />

              {/* Name + gradient chrome preview (to scale with the frame). */}
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
          )}
        </div>
      </div>

      {img && (
        <p className="text-center text-[11px] leading-snug text-text-secondary">
          {t('locker.crop.instructions')}
        </p>
      )}

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
        <span className="w-10 text-right text-[11px] tabular-nums text-text-secondary">{zoom.toFixed(1)}x</span>
        <button
          type="button"
          disabled={!img}
          onClick={reset}
          title={t('locker.crop.resetZoom')}
          aria-label={t('locker.crop.resetZoom')}
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

      <Button
        variant="primary"
        size="sm"
        icon={Crop}
        isLoading={busy}
        disabled={!img || !!error || busy}
        onClick={handleApply}
        className="w-full"
      >
        {t('locker.modImage.useImage')}
      </Button>
    </div>
  );
}
