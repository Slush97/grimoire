import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const ANCHOR_GAP = 8;
const VIEWPORT_PADDING = 12;
/** Below this much room underneath the anchor, flipping up beats scrolling. */
const MIN_DOWNWARD_SPACE = 200;

interface AnchoredPopoverProps {
  open: boolean;
  onClose: () => void;
  /**
   * Element the panel hangs off. Also the "inside" region for outside-click:
   * the trigger's own onClick owns toggling, so a click on it must not be
   * treated as a dismiss (that would close then immediately reopen).
   */
  anchorRef: RefObject<HTMLElement | null>;
  /** Panel width in px. A fixed-position panel cannot inherit one from flow. */
  width: number;
  /** Which edge lines up with the anchor before clamping. Default 'end' (right). */
  align?: 'start' | 'end';
  role?: 'dialog' | 'menu';
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A popover panel portaled to <body> and positioned against its trigger.
 *
 * An `absolute` panel inside the page is clipped by the first ancestor with a
 * non-visible overflow: in Browse that is the scroll container around the
 * Outlet, whose left edge is the sidebar, so a right-aligned panel on a
 * left-hand toolbar button lost everything past that edge. Portaling escapes
 * every ancestor's overflow and stacking context; the cost is that position
 * has to be measured and kept in sync with anything that can move the anchor.
 */
export function AnchoredPopover({
  open,
  onClose,
  anchorRef,
  width,
  align = 'end',
  role = 'dialog',
  ariaLabel,
  className = '',
  children,
}: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * Measure the anchor and write the panel's fixed position straight to the
   * node. Imperative on purpose: holding the rect in state would re-render the
   * whole panel on every scroll tick, and the position is display-only.
   */
  const position = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const rect = anchor.getBoundingClientRect();
    const preferredLeft = align === 'end' ? rect.right - width : rect.left;
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
    panel.style.left = `${Math.round(Math.min(Math.max(preferredLeft, VIEWPORT_PADDING), maxLeft))}px`;
    panel.style.width = `${width}px`;

    const spaceBelow = window.innerHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_PADDING;
    const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_PADDING;
    const flipUp = spaceBelow < MIN_DOWNWARD_SPACE && spaceAbove > spaceBelow;
    if (flipUp) {
      panel.style.top = 'auto';
      panel.style.bottom = `${Math.round(window.innerHeight - rect.top + ANCHOR_GAP)}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${Math.round(rect.bottom + ANCHOR_GAP)}px`;
    }
    panel.style.maxHeight = `${Math.max(0, Math.round(flipUp ? spaceAbove : spaceBelow))}px`;
  }, [align, anchorRef, width]);

  // Layout effect, not a plain effect: this runs after the portal is in the DOM
  // but before paint, so the panel is never visible at an unpositioned spot.
  useLayoutEffect(() => {
    if (!open) return;
    position();
    // Capture phase so scrolling any ancestor (not just the window) is caught.
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    // mousedown, not pointerdown: portaled children (HeroSelect's listbox) stop
    // propagation of the React mousedown to keep their own gesture inside their
    // logical boundary. Listening for pointerdown here would bypass that and
    // dismiss this panel out from under a hero being picked.
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      // z-80 is the popover rung of the ladder in index.css: portaled to
      // <body>, this has to clear page chrome and the sidebar alike.
      className={`fixed z-[80] overflow-y-auto overscroll-contain rounded-lg border border-border bg-bg-secondary shadow-popup animate-fade-in ${className}`}
      style={{ top: 0, left: 0 }}
    >
      {children}
    </div>,
    document.body
  );
}
