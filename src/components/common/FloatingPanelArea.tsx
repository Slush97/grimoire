import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PanelBox, PanelGuides } from '../../lib/floatingPanelGeometry';
import { FloatingPanelContext } from './floatingPanelContext';

interface FloatingPanelAreaProps {
  viewport: HTMLElement | null;
  topBoundary?: HTMLElement | null;
  inset?: number;
  children: ReactNode;
}

/** Visible client area, including clipping ancestors but excluding their scrollbars. */
function clientBounds(element: HTMLElement): PanelBox {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + element.clientLeft, y: rect.top + element.clientTop,
    width: element.clientWidth, height: element.clientHeight };
}

export function FloatingPanelArea({ viewport, topBoundary, inset = 0, children }: FloatingPanelAreaProps) {
  const [bounds, setBounds] = useState<PanelBox | null>(null);
  const [active, setActive] = useState<{ owner: symbol; guides: PanelGuides } | null>(null);
  const showGuides = useCallback((owner: symbol, guides: PanelGuides) => {
    setActive(current => current?.owner === owner && current.guides.x === guides.x && current.guides.y === guides.y
      ? current : { owner, guides });
  }, []);
  const clearGuides = useCallback((owner: symbol) => setActive(current => current?.owner === owner ? null : current), []);

  useLayoutEffect(() => {
    if (!viewport) return;
    const ancestors: HTMLElement[] = [];
    for (let element: HTMLElement | null = viewport; element; element = element.parentElement) ancestors.push(element);
    const measure = () => {
      const rect = clientBounds(viewport);
      let left = Math.max(0, rect.x), top = Math.max(0, rect.y);
      let right = Math.min(window.innerWidth, rect.x + rect.width);
      let bottom = Math.min(window.innerHeight, rect.y + rect.height);
      for (const ancestor of ancestors.slice(1)) {
        const style = getComputedStyle(ancestor);
        const clip = clientBounds(ancestor);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.x); right = Math.min(right, clip.x + clip.width); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.y); bottom = Math.min(bottom, clip.y + clip.height); }
      }
      if (topBoundary) top = Math.max(top, topBoundary.getBoundingClientRect().bottom);
      const paddingX = Math.min(inset, Math.max(0, right - left) / 2);
      const paddingY = Math.min(inset, Math.max(0, bottom - top) / 2);
      const next = { x: left + paddingX, y: top + paddingY,
        width: Math.max(0, right - left - 2 * paddingX), height: Math.max(0, bottom - top - 2 * paddingY) };
      setBounds(current => current?.x === next.x && current.y === next.y
        && current.width === next.width && current.height === next.height ? current : next);
    };
    const observer = new ResizeObserver(measure);
    ancestors.forEach(element => observer.observe(element));
    if (topBoundary) observer.observe(topBoundary);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [viewport, topBoundary, inset]);

  const liveBounds = viewport ? bounds : null;
  const value = useMemo(() => ({ bounds: liveBounds, showGuides, clearGuides }), [liveBounds, showGuides, clearGuides]);
  return <FloatingPanelContext.Provider value={value}>
    {children}
    {liveBounds && active && createPortal(<div aria-hidden className="pointer-events-none fixed z-40"
      style={{ left: liveBounds.x, top: liveBounds.y, width: liveBounds.width, height: liveBounds.height }}>
      {active.guides.x === liveBounds.x + liveBounds.width / 2 && <div data-floating-panel-guide="x" className="absolute inset-y-0 border-l border-dashed border-accent/60"
        style={{ left: active.guides.x - liveBounds.x }} />}
      {active.guides.y === liveBounds.y + liveBounds.height / 2 && <div data-floating-panel-guide="y" className="absolute inset-x-0 border-t border-dashed border-accent/60"
        style={{ top: active.guides.y - liveBounds.y }} />}
    </div>, document.body)}
  </FloatingPanelContext.Provider>;
}
