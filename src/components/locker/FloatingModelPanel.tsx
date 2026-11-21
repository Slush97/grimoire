import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { GripHorizontal, X } from 'lucide-react';
import { useFloatingPanel } from '../common/useFloatingPanel';
import { useFloatingPanelArea } from '../common/floatingPanelContext';

/**
 * A draggable, resizable floating panel for the Locker's live 3D hero model.
 *
 * Shares containment, snapping and resizing with the Installed popups. Stored
 * positions remain relative to the hero overlay for compatibility with existing
 * geometry and to keep a saved position independent of the sidebar/banner size.
 */

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = 'grimoire.locker.modelPanel.geom';
const DEFAULT_SIZE = { width: 360, height: 460 };
const MIN_SIZE = { width: 240, height: 260 };

function readStored(): Geom | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Geom>;
    if (
      typeof v?.x === 'number' && Number.isFinite(v.x) &&
      typeof v?.y === 'number' && Number.isFinite(v.y) &&
      typeof v?.w === 'number' && Number.isFinite(v.w) &&
      typeof v?.h === 'number' && Number.isFinite(v.h)
    ) {
      return v as Geom;
    }
  } catch {
    /* ignore malformed storage */
  }
  return null;
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
  const { bounds } = useFloatingPanelArea();
  const { ref: attachPanel, style, onDragStart, onResizeStart, resizeFromLeft } = useFloatingPanel({
    initial: () => {
      if (!bounds) return null;
      const stored = readStored();
      return {
        x: bounds.x + (stored?.x ?? bounds.width - DEFAULT_SIZE.width),
        y: bounds.y + (stored?.y ?? bounds.height - DEFAULT_SIZE.height),
        width: stored?.w,
        height: stored?.h,
      };
    },
    placement: 'top-right',
    size: DEFAULT_SIZE,
    minSize: MIN_SIZE,
    resizeMode: 'corner',
    onCommit: (box) => {
      if (!bounds) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          x: box.x - bounds.x, y: box.y - bounds.y, w: box.width, h: box.height,
        } satisfies Geom));
      } catch { /* ignore quota/availability errors */ }
    },
  });

  return createPortal(
    <div
      ref={attachPanel}
      data-locker-model-panel
      className="always-dark floating-panel fixed z-40 flex flex-col overflow-hidden rounded-xl border border-border/70 bg-bg-secondary/95 shadow-2xl backdrop-blur-md"
      style={style}
    >
      <div
        onPointerDown={onDragStart}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-border/60 bg-bg-tertiary/60 px-3 py-2 active:cursor-grabbing"
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
      <div className="relative min-h-0 flex-1 bg-bg-primary/40">{children}</div>

      <div
        onPointerDown={onResizeStart}
        title={t('locker.model.resize')}
        className={`absolute bottom-0 flex h-4 w-4 touch-none items-end justify-end p-0.5 ${resizeFromLeft ? 'left-0 cursor-nesw-resize' : 'right-0 cursor-nwse-resize'}`}
      >
        <svg viewBox="0 0 10 10" aria-hidden className={`h-2.5 w-2.5 text-text-secondary/60 ${resizeFromLeft ? '-scale-x-100' : ''}`}>
          <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </div>
    </div>, document.body
  );
}
