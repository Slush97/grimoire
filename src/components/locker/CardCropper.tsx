import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Crop, ZoomIn, RotateCcw } from 'lucide-react';
import { Modal } from '../common/Modal';

interface CardCropperProps {
  /** Source image to crop (any size), as a data URL. */
  imageDataUrl: string;
  /** Target output dimensions (the variant's exact size in the base game). */
  targetWidth: number;
  targetHeight: number;
  /** Human label for the variant being cropped (e.g. "Card", "Minimap"). */
  variantLabel: string;
  onCancel: () => void;
  /** Receives the cropped image as a PNG data URL at exactly target size. */
  onCrop: (dataUrl: string) => void;
}

/** Longest edge of the editing viewport, in CSS px. The viewport keeps the
 *  target aspect; the source image is scaled to cover it and pans/zooms within. */
const BOX = 360;
const MAX_ZOOM = 5;

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
  onCancel,
  onCrop,
}: CardCropperProps) {
  const aspect = targetWidth / targetHeight;
  const viewW = aspect >= 1 ? BOX : Math.round(BOX * aspect);
  const viewH = aspect >= 1 ? Math.round(BOX / aspect) : BOX;

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Top-left of the drawn image relative to the viewport, in CSS px (<= 0).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Scale at which the source just covers the viewport (zoom 1 == cover).
  const coverScale = img ? Math.max(viewW / img.naturalWidth, viewH / img.naturalHeight) : 1;
  const drawnW = img ? img.naturalWidth * coverScale * zoom : viewW;
  const drawnH = img ? img.naturalHeight * coverScale * zoom : viewH;

  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(viewW - drawnW, x)),
      y: Math.min(0, Math.max(viewH - drawnH, y)),
    }),
    [viewW, viewH, drawnW, drawnH]
  );

  // Load the source image to learn its natural size, then center it at cover.
  useEffect(() => {
    let active = true;
    const el = new Image();
    el.onload = () => {
      if (!active) return;
      setImg(el);
      const cs = Math.max(viewW / el.naturalWidth, viewH / el.naturalHeight);
      setOffset({ x: (viewW - el.naturalWidth * cs) / 2, y: (viewH - el.naturalHeight * cs) / 2 });
      setZoom(1);
      setError(null);
    };
    el.onerror = () => {
      if (active) setError('That image could not be loaded. Try a different PNG or JPG.');
    };
    el.src = imageDataUrl;
    return () => {
      active = false;
    };
  }, [imageDataUrl, viewW, viewH]);

  // Zoom around the viewport center so the framed subject stays put.
  const applyZoom = useCallback(
    (nextZoom: number) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      if (!img) {
        setZoom(z);
        return;
      }
      const cx = (viewW / 2 - offset.x) / (coverScale * zoom);
      const cy = (viewH / 2 - offset.y) / (coverScale * zoom);
      const nx = viewW / 2 - cx * coverScale * z;
      const ny = viewH / 2 - cy * coverScale * z;
      const newDrawnW = img.naturalWidth * coverScale * z;
      const newDrawnH = img.naturalHeight * coverScale * z;
      setZoom(z);
      setOffset({
        x: Math.min(0, Math.max(viewW - newDrawnW, nx)),
        y: Math.min(0, Math.max(viewH - newDrawnH, ny)),
      });
    },
    [img, offset, zoom, coverScale, viewW, viewH]
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
      drag.current.oy + (e.clientY - drag.current.startY)
    );
    setOffset(next);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  };

  const handleApply = () => {
    if (!img) return;
    const scale = coverScale * zoom;
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
      setError('Could not render the crop (no 2D canvas context).');
      return;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, targetWidth, targetHeight);
    onCrop(canvas.toDataURL('image/png'));
  };

  return (
    <Modal onClose={onCancel} size="none" panelClassName="max-w-xl" labelledBy="card-cropper-title">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <Crop className="h-4 w-4 text-accent" />
          <h2 id="card-cropper-title" className="text-sm font-semibold text-text-primary">
            Crop {variantLabel} card
          </h2>
          <span className="ml-auto text-[11px] tabular-nums text-text-secondary">
            output {targetWidth} x {targetHeight}
          </span>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : (
          <>
            <div className="flex justify-center">
              <div
                className="relative touch-none overflow-hidden rounded-md border border-border bg-bg-primary/60 select-none"
                style={{ width: viewW, height: viewH, cursor: img ? 'grab' : 'default' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
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
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-accent disabled:cursor-not-allowed"
              />
              <span className="w-10 text-right text-[11px] tabular-nums text-text-secondary">
                {zoom.toFixed(1)}x
              </span>
              <button
                type="button"
                disabled={!img}
                onClick={() => applyZoom(1)}
                title="Reset zoom"
                className="cursor-pointer rounded-md border border-border/60 p-1 text-text-secondary transition-colors hover:border-white/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            {img && (img.naturalWidth < targetWidth || img.naturalHeight < targetHeight) && (
              <p className="text-[11px] leading-snug text-amber-400/90">
                Source is {img.naturalWidth} x {img.naturalHeight}, smaller than the {targetWidth} x{' '}
                {targetHeight} target, so it will be upscaled and may look soft.
              </p>
            )}
            <p className="text-[11px] leading-snug text-text-secondary">
              Drag to reposition, scroll or use the slider to zoom. The frame is locked to the card's
              aspect so the result is not stretched.
            </p>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-white/20 hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!img || !!error}
            onClick={handleApply}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Crop className="h-3.5 w-3.5" /> Use crop
          </button>
        </div>
      </div>
    </Modal>
  );
}
