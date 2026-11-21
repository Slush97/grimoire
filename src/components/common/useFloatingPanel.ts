import { useCallback, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { centerPanelSize, containPanel, resizePanel, snapPanel, type PanelBox, type PanelSize, type PanelResizeMode } from '../../lib/floatingPanelGeometry';
import { useStableCallback } from '../../lib/useStableCallback';
import { useFloatingPanelArea } from './floatingPanelContext';

interface FloatingPanelOptions {
  initial: () => Partial<PanelBox> | null;
  placement: 'top-center' | 'top-right';
  /** Omit for a content-sized panel; supply for a manually resizable panel. */
  size?: PanelSize;
  minSize?: PanelSize;
  /** Manual resize anchor. Corner resizing fixes the opposite top corner. */
  resizeMode?: PanelResizeMode;
  onCommit: (box: PanelBox) => void;
}

interface Gesture {
  id: number;
  mode: 'move' | 'resize';
  handle: HTMLElement;
  start: PanelBox;
  free: PanelBox;
  x: number;
  y: number;
  originX: number;
  originY: number;
  fromLeft: boolean;
}

const initialStyle: CSSProperties = {
  position: 'fixed', left: 0, top: 0, transform: 'translate(-50%, -50%)', visibility: 'hidden', boxSizing: 'border-box',
};

/** Owns geometry and pointer listeners without rendering the consumer on every drag tick. */
export function useFloatingPanel({ initial, placement, size, minSize, resizeMode = 'corner', onCommit }: FloatingPanelOptions) {
  const { bounds, showGuides, clearGuides } = useFloatingPanelArea();
  const nodeRef = useRef<HTMLElement | null>(null);
  const [nodeVersion, connect] = useReducer((version: number) => version + 1, 0);
  const attach = useCallback((element: HTMLElement | null) => {
    if (nodeRef.current && nodeRef.current !== element) {
      // These constraints are owned by the hook, rather than React's style prop.
      nodeRef.current.style.removeProperty('max-width');
      nodeRef.current.style.removeProperty('max-height');
    }
    nodeRef.current = element;
    connect();
  }, []);
  const [resizeFromLeft, setResizeFromLeft] = useState(false);
  const owner = useRef(Symbol('floating-panel'));
  const box = useRef<PanelBox | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const controls = useRef<{ start: (event: ReactPointerEvent<HTMLElement>, mode: Gesture['mode'], fromLeft?: boolean) => void } | null>(null);
  const readInitial = useStableCallback(initial);
  const commit = useStableCallback(onCommit);
  const defaultWidth = size?.width;
  const defaultHeight = size?.height;
  const minWidth = minSize?.width ?? 0;
  const minHeight = minSize?.height ?? 0;

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      if (node) node.style.visibility = 'hidden';
      return;
    }
    const resizable = defaultWidth !== undefined && defaultHeight !== undefined;
    node.style.maxWidth = `${bounds.width}px`;
    node.style.maxHeight = `${bounds.height}px`;
    const apply = (next: PanelBox, immediate = false) => {
      box.current = next;
      if (immediate) node.style.transition = 'none';
      node.style.left = `${next.x + next.width / 2}px`;
      node.style.top = `${next.y + next.height / 2}px`;
      if (resizable) { node.style.width = `${next.width}px`; node.style.height = `${next.height}px`; }
      node.style.visibility = 'visible';
      if (immediate) {
        // Flush the displayed rectangle before enabling transitions or taking over a moving panel.
        node.getBoundingClientRect();
        node.style.removeProperty('transition');
      }
    };
    const updateGrip = () => {
      if (box.current) setResizeFromLeft(box.current.x + box.current.width / 2 > bounds.x + bounds.width / 2);
    };
    const stored = box.current ?? readInitial();
    const width = resizable ? Math.max(minWidth, stored?.width ?? defaultWidth) : node.offsetWidth;
    const height = resizable ? Math.max(minHeight, stored?.height ?? defaultHeight) : node.offsetHeight;
    const next = box.current
      ? centerPanelSize(box.current, { width, height })
      : { x: stored?.x ?? (placement === 'top-right' ? bounds.x + bounds.width - width : bounds.x + (bounds.width - width) / 2),
        y: stored?.y ?? bounds.y, width, height };
    apply(containPanel(next, bounds), node.style.visibility !== 'visible');
    updateGrip();

    const clear = () => clearGuides(owner.current);
    const followShift = (enabled: boolean) => {
      const current = gesture.current;
      if (!current || current.mode !== 'move') return;
      const snapped = snapPanel(current.free, bounds, enabled);
      apply(snapped.box);
      updateGrip();
      showGuides(owner.current, snapped.guides);
    };
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.id) return;
      if (current.mode === 'move') {
        // Keep the unconstrained position so walls never change the original grab offset.
        // Only the displayed box is clamped by followShift.
        current.free = { ...current.free, x: current.free.x + event.clientX - current.x,
          y: current.free.y + event.clientY - current.y };
        followShift(event.shiftKey);
      } else {
        apply(resizePanel(current.start, event.clientX - current.originX, event.clientY - current.originY,
          current.fromLeft, { width: minWidth, height: minHeight }, bounds, resizeMode));
      }
      current.x = event.clientX;
      current.y = event.clientY;
    };
    const modifier = (event: KeyboardEvent) => { if (event.key === 'Shift') followShift(event.shiftKey); };
    const detach = (current: Gesture) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', modifier);
      window.removeEventListener('keyup', modifier);
      window.removeEventListener('blur', stop);
      current.handle.removeEventListener('lostpointercapture', end);
      if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
    };
    const stop = () => {
      const current = gesture.current;
      if (!current) return;
      gesture.current = null;
      detach(current);
      clear();
      if (box.current) {
        const settled = containPanel(box.current, bounds);
        // Commit the last direct manipulation before easing any automatic correction.
        node.getBoundingClientRect();
        node.style.removeProperty('transition');
        apply(settled);
        commit(settled);
        updateGrip();
      }
    };
    function end(event: PointerEvent) { if (event.pointerId === gesture.current?.id) stop(); }
    const start = (event: ReactPointerEvent<HTMLElement>, mode: Gesture['mode'], fromLeft?: boolean) => {
      if (event.button !== 0 || gesture.current || !box.current || (mode === 'resize' && !resizable)) return;
      if (mode === 'move' && event.target instanceof Element
        && event.target.closest('button, input, select, textarea, a, [role="button"]')) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const displayed = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      const from = containPanel(displayed, bounds);
      apply(from, true);
      // Pointer-driven movement, snapping and resizing must follow input immediately.
      node.style.transition = 'none';
      const handle = event.currentTarget;
      gesture.current = { id: event.pointerId, mode, handle, start: from, free: from,
        x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY,
        fromLeft: fromLeft ?? (from.x + from.width / 2 > bounds.x + bounds.width / 2) };
      handle.setPointerCapture(event.pointerId);
      handle.addEventListener('lostpointercapture', end);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('keydown', modifier);
      window.addEventListener('keyup', modifier);
      window.addEventListener('blur', stop);
      if (mode === 'move') followShift(event.shiftKey);
    };
    controls.current = { start };
    const observer = new ResizeObserver(() => {
      if (resizable || !box.current) return;
      const size = { width: node.offsetWidth, height: node.offsetHeight };
      if (size.width === box.current.width && size.height === box.current.height) return;
      const resized = centerPanelSize(box.current, size);
      apply(containPanel(resized, bounds));
      if (gesture.current) {
        gesture.current.free = centerPanelSize(gesture.current.free, size);
        clear();
      }
    });
    if (!resizable) observer.observe(node);
    return () => {
      stop();
      clear();
      observer.disconnect();
      controls.current = null;
    };
  }, [nodeVersion, bounds, placement, defaultWidth, defaultHeight, minWidth, minHeight, resizeMode, readInitial, commit, showGuides, clearGuides]);

  const onDragStart = useCallback((event: ReactPointerEvent<HTMLElement>) => controls.current?.start(event, 'move'), []);
  const onResizeStart = useCallback((event: ReactPointerEvent<HTMLElement>) => controls.current?.start(event, 'resize', resizeFromLeft), [resizeFromLeft]);
  return { ref: attach, style: initialStyle, onDragStart, onResizeStart, resizeFromLeft };
}
