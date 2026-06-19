import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, Crop, Maximize2, RotateCcw, ImagePlus } from 'lucide-react';
import { Toggle } from '../common/ui';
import { getHeroNamePath } from '../../lib/lockerUtils';

interface LockerImageCropperProps {
  /** Source image to frame (any size), as a data URL. Null = nothing picked yet:
   *  the stage renders empty so the framing surface is previewed up front. */
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
   *  on a stored original source, instead of defaulting to the largest centered
   *  selection. Applied on each (re)load of `imageDataUrl`; clear it when staging
   *  a freshly picked source so the new pick centers. Aspect should match `aspect`. */
  initialCrop?: { sx: number; sy: number; sw: number; sh: number };
  /** Hint shown over the empty stage before a source is chosen. */
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

/** Cap the baked output so we never upscale a small source past this long edge. */
const MAX_OUTPUT_LONG = 1280;
/** Smallest selectable crop box edge, in display px. */
const MIN_BOX = 36;

/** A real Locker grid card is ~230px wide; its name label and padding are fixed
 *  px tuned to that width. The crop box differs, so the overlay's fixed-px chrome
 *  would render off-scale. Reproduce it as a proportion of the crop box instead,
 *  so the preview is to scale with the card. */
const REFERENCE_CARD_W = 230;

/** Editor sizing. The stage is bounded by a fraction of the live viewport (not a
 *  hardcoded chrome budget) so it never scales past the window: width shrinks with
 *  narrow windows, height with short ones. The modal around it also scrolls, so
 *  these are caps, not exact fits. */
const STAGE_MAX_W = 320;
const STAGE_MIN_W = 160;
const STAGE_MAX_H = 420;
const STAGE_MIN_H = 160;
/** Horizontal room the surrounding modal padding/margins take. */
const STAGE_MARGIN_W = 96;
/** Share of the window height the stage may occupy. */
const STAGE_VH = 0.4;

/** The box (in CSS px) the image is contained within, clamped to the viewport. */
function stageBudget(): { w: number; h: number } {
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  return {
    w: Math.max(STAGE_MIN_W, Math.min(STAGE_MAX_W, winW - STAGE_MARGIN_W)),
    h: Math.max(STAGE_MIN_H, Math.min(STAGE_MAX_H, Math.round(winH * STAGE_VH))),
  };
}

/** Largest box at the given aspect that fits the budget (centered framing area). */
function fitAspect(aspect: number): { w: number; h: number } {
  const { w: maxW, h: maxH } = stageBudget();
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** Placeholder stage (at the target aspect) shown before a source is picked. */
function emptyStage(aspect: number): { w: number; h: number } {
  return fitAspect(aspect);
}

/** Contain a natural-size image within the viewport budget. */
function containStage(natW: number, natH: number): { w: number; h: number } {
  const { w: maxW, h: maxH } = stageBudget();
  const s = Math.min(maxW / natW, maxH / natH);
  return { w: Math.max(1, Math.round(natW * s)), h: Math.max(1, Math.round(natH * s)) };
}

/** Largest aspect-locked box that fits the stage, centered. */
function maxBox(stageW: number, stageH: number, aspect: number) {
  let w = stageW;
  let h = w / aspect;
  if (h > stageH) {
    h = stageH;
    w = h * aspect;
  }
  return { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h };
}

type Box = { x: number; y: number; w: number; h: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Inline frame-and-preview editor for a per-skin Locker / sidebar image.
 *
 * Crop-box model (cropperjs-style): the whole source image is shown fit-to-contain
 * inside the stage, and an aspect-locked selection box is overlaid on top. The box
 * can be dragged to move and resized from any corner; everything outside it is
 * dimmed. This lets the user see the entire image and box the exact portion they
 * want, instead of panning a cover-cropped frame blind. In card mode the box also
 * overlays the real hero-name label exactly as the card renders it, with a live
 * toggle to hide it. On apply we export the selection at the target aspect so the
 * downstream `object-cover` is a clean, undistorted scale. With no source picked
 * yet the stage renders empty at the target shape so the surface is previewed.
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

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  // The stage is the displayed image rect (image contained, so stage === image,
  // no letterbox). Defaults to a target-aspect placeholder while empty.
  const [stage, setStage] = useState(() => emptyStage(aspect));
  const [box, setBox] = useState<Box>(() => maxBox(stage.w, stage.h, aspect));
  const [error, setError] = useState<string | null>(null);
  const [hideHeroName, setHideHeroName] = useState(initialHideHeroName);
  const [nameFailed, setNameFailed] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  // Active pointer gesture: a move (drag the whole box) or a corner resize.
  const drag = useRef<
    | { mode: 'move'; startX: number; startY: number; bx: number; by: number }
    | { mode: 'resize'; corner: Corner; ax: number; ay: number }
    | null
  >(null);

  const STAGE_W = stage.w;
  const STAGE_H = stage.h;
  // Mirror the stage size for the resize handler (avoids a stale-closure read).
  const stageSizeRef = useRef(stage);
  useEffect(() => {
    stageSizeRef.current = stage;
  }, [stage]);

  // Clamp a move so the box stays fully inside the stage.
  const clampMove = useCallback(
    (b: Box): Box => ({
      ...b,
      x: Math.min(Math.max(0, b.x), STAGE_W - b.w),
      y: Math.min(Math.max(0, b.y), STAGE_H - b.h),
    }),
    [STAGE_W, STAGE_H]
  );

  // Load the source to learn its natural size, contain it in the stage budget,
  // then place the selection (restored framing, or the largest centered box).
  // A null source clears back to the empty placeholder stage.
  useEffect(() => {
    if (!imageDataUrl) {
      setImg(null);
      const s = emptyStage(aspect);
      setStage(s);
      setBox(maxBox(s.w, s.h, aspect));
      setError(null);
      return;
    }
    let active = true;
    const el = new Image();
    el.onload = () => {
      if (!active) return;
      const { w: sw, h: sh } = containStage(el.naturalWidth, el.naturalHeight);
      setImg(el);
      setStage({ w: sw, h: sh });
      if (initialCrop && initialCrop.sw > 0) {
        // Restore previous framing. Width drives the box (aspect-locked); clamp
        // both size and position into the stage.
        let w = Math.min(Math.max(MIN_BOX, initialCrop.sw * sw), sw);
        let h = w / aspect;
        if (h > sh) {
          h = sh;
          w = h * aspect;
        }
        const x = Math.min(Math.max(0, initialCrop.sx * sw), sw - w);
        const y = Math.min(Math.max(0, initialCrop.sy * sh), sh - h);
        setBox({ x, y, w, h });
      } else {
        setBox(maxBox(sw, sh, aspect));
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

  // Keep the stage within the window when it resizes, re-deriving the box from
  // its current normalized framing so the selection follows.
  useEffect(() => {
    const onResize = () => {
      if (!img) {
        setStage(emptyStage(aspect));
        return;
      }
      const prev = stageSizeRef.current;
      const next = containStage(img.naturalWidth, img.naturalHeight);
      setBox((b) => {
        const fx = b.x / prev.w;
        const fy = b.y / prev.h;
        const fw = b.w / prev.w;
        let w = Math.min(Math.max(MIN_BOX, fw * next.w), next.w);
        let h = w / aspect;
        if (h > next.h) {
          h = next.h;
          w = h * aspect;
        }
        return {
          x: Math.min(Math.max(0, fx * next.w), next.w - w),
          y: Math.min(Math.max(0, fy * next.h), next.h - h),
          w,
          h,
        };
      });
      setStage(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [img, aspect]);

  // Stage-local pointer coords, clamped to the stage.
  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max(0, clientX - rect.left), rect.width),
      y: Math.min(Math.max(0, clientY - rect.top), rect.height),
    };
  }, []);

  // Resize from a corner: the opposite corner (ax, ay) is the anchor; build the
  // largest aspect-locked box from anchor toward the pointer, clamped to bounds.
  const resizeFrom = useCallback(
    (ax: number, ay: number, px: number, py: number): Box => {
      const dirX = px >= ax ? 1 : -1;
      const dirY = py >= ay ? 1 : -1;
      const maxW = dirX > 0 ? STAGE_W - ax : ax;
      const maxH = dirY > 0 ? STAGE_H - ay : ay;
      let w = Math.abs(px - ax);
      let h = Math.abs(py - ay);
      // Lock aspect to the governing dimension, then clamp to bounds + min size.
      if (w / h > aspect) h = w / aspect;
      else w = h * aspect;
      if (w > maxW) {
        w = maxW;
        h = w / aspect;
      }
      if (h > maxH) {
        h = maxH;
        w = h * aspect;
      }
      if (w < MIN_BOX) {
        w = MIN_BOX;
        h = w / aspect;
      }
      const x = dirX > 0 ? ax : ax - w;
      const y = dirY > 0 ? ay : ay - h;
      return { x, y, w, h };
    },
    [STAGE_W, STAGE_H, aspect]
  );

  const onPointerDownBox = (e: React.PointerEvent) => {
    if (!img) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode: 'move', startX: e.clientX, startY: e.clientY, bx: box.x, by: box.y };
  };

  const onPointerDownHandle = (corner: Corner) => (e: React.PointerEvent) => {
    if (!img) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Anchor = the corner opposite the one grabbed.
    const ax = corner === 'nw' || corner === 'sw' ? box.x + box.w : box.x;
    const ay = corner === 'nw' || corner === 'ne' ? box.y + box.h : box.y;
    drag.current = { mode: 'resize', corner, ax, ay };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'move') {
      setBox((b) => clampMove({ ...b, x: d.bx + (e.clientX - d.startX), y: d.by + (e.clientY - d.startY) }));
    } else {
      const p = localPoint(e.clientX, e.clientY);
      setBox(resizeFrom(d.ax, d.ay, p.x, p.y));
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  // Scale the selection around its center (slider + wheel), clamped to the stage.
  const setBoxWidth = useCallback(
    (targetW: number) => {
      setBox((b) => {
        const maxW = Math.min(STAGE_W, STAGE_H * aspect);
        let w = Math.min(Math.max(MIN_BOX, targetW), maxW);
        let h = w / aspect;
        if (h > STAGE_H) {
          h = STAGE_H;
          w = h * aspect;
        }
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        return clampMove({ x: cx - w / 2, y: cy - h / 2, w, h });
      });
    },
    [STAGE_W, STAGE_H, aspect, clampMove]
  );

  const onWheel = (e: React.WheelEvent) => {
    if (!img) return;
    e.preventDefault();
    setBoxWidth(box.w * (e.deltaY < 0 ? 1 / 1.08 : 1.08));
  };

  const maxBoxW = Math.min(STAGE_W, STAGE_H * aspect);
  // Slider position (0..1) from the current box width.
  const sizeValue = maxBoxW > MIN_BOX ? (box.w - MIN_BOX) / (maxBoxW - MIN_BOX) : 1;

  const handleApply = () => {
    if (!img || !imageDataUrl) return;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    // Normalized (source-fraction) crop rect: the stage maps 1:1 to the source.
    const crop = { sx: box.x / STAGE_W, sy: box.y / STAGE_H, sw: box.w / STAGE_W, sh: box.h / STAGE_H };
    const srcX = crop.sx * natW;
    const srcY = crop.sy * natH;
    const srcW = crop.sw * natW;
    const srcH = crop.sh * natH;
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

  // Name chrome scales with the crop box (its baked surface), not the stage.
  const previewScale = box.w / REFERENCE_CARD_W;
  const NAME_HEIGHT = Math.round(28 * previewScale);
  const NAME_PADDING = Math.round(12 * previewScale);
  const NAME_FALLBACK_FONT = Math.round(14 * previewScale);
  const BD_NAME_HEIGHT = Math.round(box.w * 0.08);
  const BD_NAME_PADDING = Math.round(box.w * 0.05);

  const cornerCursor: Record<Corner, string> = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex justify-center">
        {/* Stage: the whole image contained, with the aspect-locked selection box
            overlaid. Outside the box is dimmed; the box overlays the hero-name
            chrome so the preview is to scale. Empty (target shape) until picked. */}
        <div
          ref={stageRef}
          className="relative touch-none select-none overflow-hidden rounded-xl border border-border bg-bg-primary/60"
          style={{ width: STAGE_W, height: STAGE_H }}
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
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-text-secondary">
              <ImagePlus className="h-6 w-6 opacity-70" />
              {emptyHint && <span className="text-[11px] leading-snug">{emptyHint}</span>}
            </div>
          )}

          {img && (
            <div
              className="absolute cursor-move"
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                // Dim everything outside the selection.
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                outline: '1px solid rgba(255,255,255,0.9)',
              }}
              onPointerDown={onPointerDownBox}
            >
              {/* Rule-of-thirds guides. */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/25" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/25" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/25" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/25" />
              </div>

              {/* Name + gradient chrome preview (to scale with the box). */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
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

              {/* Corner resize handles. */}
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <div
                  key={corner}
                  onPointerDown={onPointerDownHandle(corner)}
                  className="absolute h-3 w-3 rounded-sm border border-black/40 bg-white"
                  style={{
                    cursor: cornerCursor[corner],
                    left: corner === 'nw' || corner === 'sw' ? -6 : undefined,
                    right: corner === 'ne' || corner === 'se' ? -6 : undefined,
                    top: corner === 'nw' || corner === 'ne' ? -6 : undefined,
                    bottom: corner === 'sw' || corner === 'se' ? -6 : undefined,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {img && (
        <p className="text-center text-[11px] leading-snug text-text-secondary">
          {t('locker.crop.boxHint')}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Maximize2 className="h-4 w-4 flex-shrink-0 text-text-secondary" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={Math.min(1, Math.max(0, sizeValue))}
          disabled={!img}
          onChange={(e) => setBoxWidth(MIN_BOX + Number(e.target.value) * (maxBoxW - MIN_BOX))}
          aria-label={t('locker.crop.selectionSize')}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!img}
          onClick={() => setBox(maxBox(STAGE_W, STAGE_H, aspect))}
          title={t('locker.crop.resetCrop')}
          aria-label={t('locker.crop.resetCrop')}
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
