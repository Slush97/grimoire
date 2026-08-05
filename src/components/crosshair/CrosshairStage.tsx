import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCrosshairStore } from '../../stores/crosshairStore';
import { crosshairReach } from '../../lib/crosshair';
import CrosshairPreview from './CrosshairPreview';
import { STAGE_BACKGROUNDS, STAGE_CAPTURE_HEIGHT, type StageBackground } from './stageBackgrounds';

/** How long the crosshair takes to glide back to center after the pointer leaves. */
const RECENTER_MS = 260;

interface CrosshairStageProps {
  /** Resolution factor (display height / 1080): the pixel-snap grid. Changing
   *  it re-rasterizes the crosshair on the new grid; it does NOT resize the
   *  scene, because switching resolution doesn't make a monitor bigger. */
  scale: number;
  /** Magnification of the whole stage (scene and crosshair together). */
  zoom: number;
  background: StageBackground;
}

/**
 * The crosshair preview surface: a game screenshot with the crosshair drawn on
 * top, tracking the pointer while it's over the stage the way it would track
 * your aim in-game (the OS cursor is hidden, so the crosshair *is* the cursor).
 *
 * Pointer moves are written straight to the transform through a ref inside a
 * rAF, never through state: the editor panel beside this renders ~20 controls,
 * and re-rendering that tree at pointer-move rate would drop frames for no gain.
 *
 * Layout contract: the caller must give this a positioned parent with a real
 * height. The stage fills it via `absolute inset-0` rather than `h-full`,
 * because every child in here is absolutely positioned: if a percentage height
 * failed to resolve (parent `height: auto`, which is what a stacked column on a
 * short window gives you) the stage would collapse to zero and silently hide
 * the scene, the crosshair, and the hint. `inset-0` resolves against the
 * parent's used size, so it holds regardless of how that height was arrived at.
 */
export default function CrosshairStage({ scale, zoom, background }: CrosshairStageProps) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const followRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  const settings = useCrosshairStore();
  const bg = STAGE_BACKGROUNDS.find((b) => b.id === background) ?? STAGE_BACKGROUNDS[0];

  // The simulated screen is the capture: CAPTURE_HEIGHT device-ish px tall,
  // shown at zoom CSS px each, regardless of the selected resolution. The
  // crosshair rasterizes on the selected resolution's grid (1080 * scale
  // device px per screen height), so one of its device px occupies this many
  // CSS px. At 1440p on a 1440p monitor this is exactly `zoom`; at 1080p the
  // coarser pixels draw proportionally fatter, at 4K finer, which is the only
  // visible difference switching resolution SHOULD make.
  const deviceToCss = (STAGE_CAPTURE_HEIGHT * zoom) / (1080 * scale);

  // Size the canvas to what the crosshair actually needs at this scale, so a
  // wide gap at 3x zoom isn't clipped by a fixed-size backing store (and a
  // tiny dot doesn't allocate a huge one). Kept EVEN so the canvas centre sits
  // on a whole pixel and the snapped device pixels land crisp.
  const canvasSize = Math.min(1400, Math.max(120, 2 * Math.ceil(crosshairReach(settings) * scale * deviceToCss)));

  const write = useCallback(() => {
    frameRef.current = null;
    const el = followRef.current;
    const point = pendingRef.current;
    if (!el || !point) return;
    el.style.transform = `translate3d(calc(-50% + ${point.x}px), calc(-50% + ${point.y}px), 0)`;
  }, []);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    pendingRef.current = {
      x: e.clientX - rect.left - rect.width / 2,
      y: e.clientY - rect.top - rect.height / 2,
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(write);
  };

  const handleEnter = () => {
    // Jump straight to the pointer on entry; the recenter easing is only for
    // the way back out.
    if (followRef.current) followRef.current.style.transitionDuration = '0ms';
    if (hintRef.current) hintRef.current.style.opacity = '0';
  };

  const handleLeave = () => {
    pendingRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const el = followRef.current;
    if (el) {
      el.style.transitionDuration = `${RECENTER_MS}ms`;
      el.style.transform = 'translate3d(-50%, -50%, 0)';
    }
    if (hintRef.current) hintRef.current.style.opacity = '1';
  };

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      onMouseMove={handleMove}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="absolute inset-0 cursor-none select-none overflow-hidden bg-bg-tertiary"
    >
      {/* The gradient always sits underneath, so a screenshot that fails to
          load degrades to the plain surface instead of a broken-image gap. */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-bg-tertiary to-bg-secondary" />
      {/* The scene is a 1:1 centre crop of the native 2560x1440 capture,
          scaled only by zoom: never by the selected resolution (a monitor
          doesn't grow when you switch resolution) and never cover-fitted
          (which squeezed the scene to ~half size and made every crosshair
          read about twice as thick as in game). */}
      {bg.src && (
        <img
          key={bg.id}
          src={bg.src}
          alt=""
          aria-hidden
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          className="absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
          style={{ height: STAGE_CAPTURE_HEIGHT * zoom, width: 'auto' }}
        />
      )}

      <div
        ref={followRef}
        className="pointer-events-none absolute left-1/2 top-1/2 ease-out"
        style={{
          transform: 'translate3d(-50%, -50%, 0)',
          transitionProperty: 'transform',
          transitionDuration: `${RECENTER_MS}ms`,
        }}
      >
        <CrosshairPreview size={canvasSize} scale={scale} zoom={deviceToCss} transparent />
      </div>

      {/* Fades out on hover: once the crosshair is tracking, the hint has done
          its job and would just sit in the middle of the scene. */}
      <div
        ref={hintRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center transition-opacity duration-200"
      >
        <span className="rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[11px] text-white/70 backdrop-blur-sm">
          {t('crosshair.preview.followHint')}
        </span>
      </div>
    </div>
  );
}
