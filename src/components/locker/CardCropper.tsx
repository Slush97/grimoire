import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, Crop, ZoomIn, RotateCcw } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Button, ModalHeader } from '../common/ui';
import { detectCursorHotspot } from '../../lib/cursorHotspot';
import type { CursorHotspot } from '../../types/electron';

interface CardCropperProps {
  /** Source image to crop (any size), as a data URL. */
  imageDataUrl: string;
  /** Target output dimensions (the variant's exact size in the base game). */
  targetWidth: number;
  targetHeight: number;
  /** Human label for the variant being cropped (e.g. "Card", "Minimap"). */
  variantLabel: string;
  /** Cursor art: zooming out may leave part of the frame transparent, and a
   *  crosshair marks the click point, detected from the image and moved by a
   *  click. Starts with the whole image flush top-left like the stock cursors. */
  cursor?: boolean;
  onCancel: () => void;
  /** Receives the cropped image as a PNG data URL at exactly target size, and
   *  (cursor mode) the click point in its pixels. */
  onCrop: (dataUrl: string, hotspot: CursorHotspot) => void;
}

/** Longest edge of the editing viewport, in CSS px. The viewport keeps the
 *  target aspect; the source image is scaled to cover it and pans/zooms within. */
const BOX = 360;
const MAX_ZOOM = 5;
// Detection runs on a copy this size at most; the hotspot only needs to land
// within a pixel of a ~60 px cursor.
const DETECT_EDGE = 256;

/** The detected click point of a cursor image, in its natural pixels. */
function detectSourceHotspot(img: HTMLImageElement): CursorHotspot {
  const s = Math.min(1, DETECT_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const p = detectCursorHotspot(w, h, ctx.getImageData(0, 0, w, h).data);
  return { x: (p.x + 0.5) / s, y: (p.y + 0.5) / s };
}

/**
 * Crop-to-aspect editor for a custom hero-card upload.
 *
 * vpkmerge resizes the uploaded PNG to the variant's exact dimensions by a plain
 * stretch, so any aspect mismatch distorts the art. This editor sidesteps that:
 * the user frames the image inside a fixed viewport locked to the target aspect,
 * and we export exactly `targetWidth x targetHeight` so the downstream resize is
 * a clean, undistorted scale. "Cover" (zoom 1) is the default so the frame is
 * always filled; zooming in crops tighter.
 */
export default function CardCropper({
  imageDataUrl,
  targetWidth,
  targetHeight,
  variantLabel,
  cursor = false,
  onCancel,
  onCrop,
}: CardCropperProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const aspect = targetWidth / targetHeight;
  const viewW = aspect >= 1 ? BOX : Math.round(BOX * aspect);
  const viewH = aspect >= 1 ? Math.round(BOX / aspect) : BOX;

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Top-left of the drawn image relative to the viewport, in CSS px (<= 0).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Cursor click point in source natural pixels, so it moves with the image.
  const [hotspot, setHotspot] = useState<CursorHotspot>({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Scale at which the source just covers the viewport (zoom 1 == cover).
  const coverScale = img ? Math.max(viewW / img.naturalWidth, viewH / img.naturalHeight) : 1;
  const minZoom = cursor && img ? Math.min(viewW / img.naturalWidth, viewH / img.naturalHeight) / coverScale : 1;
  const drawnW = img ? img.naturalWidth * coverScale * zoom : viewW;
  const drawnH = img ? img.naturalHeight * coverScale * zoom : viewH;

  // Cover keeps the frame filled. Fit only keeps the image from leaving it.
  const clamp = useCallback(
    (x: number, y: number, w: number, h: number) =>
      cursor
        ? { x: Math.min(viewW, Math.max(-w, x)), y: Math.min(viewH, Math.max(-h, y)) }
        : { x: Math.min(0, Math.max(viewW - w, x)), y: Math.min(0, Math.max(viewH - h, y)) },
    [cursor, viewW, viewH]
  );

  // Load the source image to learn its natural size, then center it at cover
  // (or, for a cursor, place it whole in the top-left corner).
  useEffect(() => {
    let active = true;
    const el = new Image();
    el.onload = () => {
      if (!active) return;
      setImg(el);
      const cs = Math.max(viewW / el.naturalWidth, viewH / el.naturalHeight);
      if (cursor) {
        setOffset({ x: 0, y: 0 });
        setZoom(Math.min(viewW / el.naturalWidth, viewH / el.naturalHeight) / cs);
        setHotspot(detectSourceHotspot(el));
      } else {
        setOffset({ x: (viewW - el.naturalWidth * cs) / 2, y: (viewH - el.naturalHeight * cs) / 2 });
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
  }, [imageDataUrl, cursor, viewW, viewH, t]);

  // Zoom around the viewport center so the framed subject stays put.
  const applyZoom = useCallback(
    (nextZoom: number) => {
      const z = Math.min(MAX_ZOOM, Math.max(minZoom, nextZoom));
      if (!img) {
        setZoom(z);
        return;
      }
      const cx = (viewW / 2 - offset.x) / (coverScale * zoom);
      const cy = (viewH / 2 - offset.y) / (coverScale * zoom);
      const nx = viewW / 2 - cx * coverScale * z;
      const ny = viewH / 2 - cy * coverScale * z;
      setZoom(z);
      setOffset(clamp(nx, ny, img.naturalWidth * coverScale * z, img.naturalHeight * coverScale * z));
    },
    [img, offset, zoom, minZoom, coverScale, viewW, viewH, clamp]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = clamp(
      drag.current.ox + (e.clientX - drag.current.startX),
      drag.current.oy + (e.clientY - drag.current.startY),
      drawnW,
      drawnH
    );
    setOffset(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = drag.current;
    drag.current = null;
    // A click that did not pan places the cursor's click point.
    if (!cursor || !start || Math.hypot(e.clientX - start.startX, e.clientY - start.startY) > 3) return;
    const scale = coverScale * zoom;
    setHotspot({ x: (e.nativeEvent.offsetX - offset.x) / scale, y: (e.nativeEvent.offsetY - offset.y) / scale });
  };
  const onPointerCancel = () => {
    drag.current = null;
  };

  // The click point in output pixels: the pixel it falls in, kept inside the
  // image since SDL rejects a hotspot outside the cursor.
  const scale = coverScale * zoom;
  const outHotspot = {
    x: Math.min(targetWidth - 1, Math.max(0, Math.floor(((offset.x + hotspot.x * scale) * targetWidth) / viewW))),
    y: Math.min(targetHeight - 1, Math.max(0, Math.floor(((offset.y + hotspot.y * scale) * targetHeight) / viewH))),
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  };

  const handleApply = () => {
    if (!img) return;
    // The viewport maps to this rect in source-image natural coordinates.
    const srcX = -offset.x / scale;
    const srcY = -offset.y / scale;
    const srcW = viewW / scale;
    const srcH = viewH / scale;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError(t('locker.crop.noCanvasContext'));
      return;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, targetWidth, targetHeight);
    onCrop(canvas.toDataURL('image/png'), outHotspot);
  };

  return (
    <Modal onClose={onCancel} size="none" panelClassName="max-w-xl" labelledBy={titleId}>
      <ModalHeader
        title={
          cursor
            ? t('locker.crop.fitTitle', { variant: variantLabel })
            : t('locker.crop.title', { variant: variantLabel })
        }
        titleId={titleId}
        subtitle={<span className="tabular-nums">{t('locker.crop.outputSize', { width: targetWidth, height: targetHeight })}</span>}
        onClose={onCancel}
        closeLabel={t('common.actions.close')}
      />
      <ModalBody className="flex flex-col gap-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-state-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : (
          <>
            <div className="flex justify-center">
              <div
                className="relative touch-none overflow-hidden rounded-md border border-border bg-bg-primary/60 select-none"
                style={{ width: viewW, height: viewH, cursor: !img ? 'default' : cursor ? 'crosshair' : 'grab' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onWheel={onWheel}
              >
                {img ? (
                  <img
                    src={imageDataUrl}
                    alt={`${variantLabel} crop source`}
                    draggable={false}
                    className="pointer-events-none absolute max-w-none"
                    style={{ left: offset.x, top: offset.y, width: drawnW, height: drawnH }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-text-secondary">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
                {cursor && img && (
                  <svg
                    aria-hidden
                    viewBox="-10 -10 20 20"
                    className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 fill-none"
                    style={{
                      left: ((outHotspot.x + 0.5) * viewW) / targetWidth,
                      top: ((outHotspot.y + 0.5) * viewH) / targetHeight,
                    }}
                  >
                    <g className="stroke-bg-primary" strokeWidth={3.5}>
                      <circle r={5} />
                      <path d="M0 -9V-3M0 3V9M-9 0H-3M3 0H9" />
                    </g>
                    <g className="stroke-accent" strokeWidth={1.5}>
                      <circle r={5} />
                      <path d="M0 -9V-3M0 3V9M-9 0H-3M3 0H9" />
                    </g>
                  </svg>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <ZoomIn className="h-4 w-4 flex-shrink-0 text-text-secondary" />
              <input
                type="range"
                min={minZoom}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                disabled={!img}
                onChange={(e) => applyZoom(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-accent disabled:cursor-not-allowed"
              />
              <span className="w-10 text-right text-2xs tabular-nums text-text-secondary">
                {zoom.toFixed(1)}x
              </span>
              <button
                type="button"
                disabled={!img}
                onClick={() => applyZoom(minZoom)}
                title={t('locker.crop.resetZoom')}
                className="cursor-pointer rounded-md border border-border/60 p-1 text-text-secondary transition-colors hover:border-hl/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            {img && (img.naturalWidth < targetWidth || img.naturalHeight < targetHeight) && (
              <p className="text-2xs leading-snug text-amber-400/90">
                {t('locker.crop.upscaleWarning', {
                  sourceWidth: img.naturalWidth,
                  sourceHeight: img.naturalHeight,
                  targetWidth,
                  targetHeight,
                })}
              </p>
            )}
            <p className="text-2xs leading-snug text-text-secondary">
              {cursor ? t('locker.crop.fitInstructions') : t('locker.crop.instructions')}
            </p>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.actions.cancel')}
        </Button>
        <Button icon={Crop} disabled={!img || !!error} onClick={handleApply}>
          {t('locker.crop.useCrop')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
