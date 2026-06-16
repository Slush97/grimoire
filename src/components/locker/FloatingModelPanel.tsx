import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GripHorizontal, X } from 'lucide-react';

/**
 * A draggable, resizable floating panel for the Locker's live 3D hero model.
 *
 * The model used to live in a fixed strip whose left offset was hardcoded to
 * the rail + selection-column widths (780/880px), so it only worked on wide
 * windows and collapsed to a sliver at the lg breakpoint. A floating panel
 * decouples the viewer from panel widths entirely: it floats over the 2D
 * portrait backdrop at any window size, and the user parks/sizes it wherever
 * they like. Geometry persists to localStorage so it stays put across heroes
 * and sessions.
 *
 * Positioned `absolute` inside the LockerHero overlay root (its offset parent),
 * so left/top are relative to that container and `overflow-hidden` on the root
 * clips it to the overlay. Both drag and resize clamp the panel inside the
 * parent and re-clamp on window/overlay resize.
 */

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = 'grimoire.locker.modelPanel.geom';
const DEFAULT_SIZE = { w: 360, h: 460 };
const MIN = { w: 240, h: 260 };
const MARGIN = 12;

function readStored(): Geom | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Geom>;
    if (
      typeof v?.x === 'number' &&
      typeof v?.y === 'number' &&
      typeof v?.w === 'number' &&
      typeof v?.h === 'number'
    ) {
      return v as Geom;
    }
  } catch {
    /* ignore malformed storage */
  }
  return null;
}

function clampGeom(g: Geom, pw: number, ph: number): Geom {
  const w = Math.max(MIN.w, Math.min(g.w, pw - MARGIN * 2));
  const h = Math.max(MIN.h, Math.min(g.h, ph - MARGIN * 2));
  const x = Math.min(Math.max(g.x, MARGIN), Math.max(MARGIN, pw - w - MARGIN));
  const y = Math.min(Math.max(g.y, MARGIN), Math.max(MARGIN, ph - h - MARGIN));
  return { x, y, w, h };
}

export default function FloatingModelPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geom | null>(() => readStored());

  const parentSize = useCallback(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return null;
    return { w: parent.clientWidth, h: parent.clientHeight };
  }, []);

  // Seed default (bottom-right) on first open when nothing is stored, and
  // re-clamp whenever the overlay/window resizes so the panel never drifts off
  // screen at a smaller size.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const apply = () => {
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      if (pw === 0 || ph === 0) return;
      setGeom((g) => {
        if (g) return clampGeom(g, pw, ph);
        const w = Math.min(DEFAULT_SIZE.w, pw - MARGIN * 2);
        const h = Math.min(DEFAULT_SIZE.h, ph - MARGIN * 2);
        return clampGeom({ w, h, x: pw - w - MARGIN, y: ph - h - MARGIN }, pw, ph);
      });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // Persist geometry so the panel stays where the user parked it.
  useEffect(() => {
    if (!geom) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(geom));
    } catch {
      /* ignore quota/availability errors */
    }
  }, [geom]);

  const beginGesture = useCallback(
    (
      e: React.PointerEvent,
      compute: (base: Geom, dx: number, dy: number) => Geom
    ) => {
      e.preventDefault();
      const ps = parentSize();
      if (!ps || !geom) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const base = geom;
      const onMove = (ev: PointerEvent) => {
        setGeom(clampGeom(compute(base, ev.clientX - startX, ev.clientY - startY), ps.w, ps.h));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [geom, parentSize]
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) =>
      beginGesture(e, (base, dx, dy) => ({ ...base, x: base.x + dx, y: base.y + dy })),
    [beginGesture]
  );

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      beginGesture(e, (base, dx, dy) => ({ ...base, w: base.w + dx, h: base.h + dy }));
    },
    [beginGesture]
  );

  return (
    <div
      ref={ref}
      className="absolute z-30 flex flex-col overflow-hidden rounded-xl border border-border/70 bg-bg-secondary/95 shadow-2xl backdrop-blur-md"
      // Park off-screen until the layout effect measures the parent and seeds a
      // real position, so the panel never flashes at 0,0.
      style={
        geom
          ? { left: geom.x, top: geom.y, width: geom.w, height: geom.h }
          : { left: -9999, top: -9999, width: DEFAULT_SIZE.w, height: DEFAULT_SIZE.h }
      }
    >
      <div
        onPointerDown={startDrag}
        className="flex cursor-grab select-none items-center gap-2 border-b border-border/60 bg-bg-tertiary/60 px-3 py-2 active:cursor-grabbing"
      >
        <GripHorizontal className="h-4 w-4 flex-shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          title={t('locker.model.close3d')}
          aria-label={t('locker.model.close3d')}
          className="-mr-1 flex-shrink-0 cursor-pointer rounded p-0.5 text-text-secondary transition-colors hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body. `relative` so the viewer's absolute inset-0 states fill it. */}
      <div className="relative flex-1 bg-bg-primary/40">{children}</div>

      {/* Bottom-right resize handle. */}
      <div
        onPointerDown={startResize}
        title={t('locker.model.resize')}
        className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end p-0.5"
      >
        <svg viewBox="0 0 10 10" aria-hidden className="h-2.5 w-2.5 text-text-secondary/60">
          <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </div>
    </div>
  );
}
