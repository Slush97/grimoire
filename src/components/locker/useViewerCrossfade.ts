import { useCallback, useEffect, useMemo, useRef } from 'react';

const FADE_MS = 200;
/** A cover never outlives this, so a change that never finishes cannot freeze the viewer. */
const COVER_LIMIT_MS = 4000;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Hides a change in the viewer behind its last frame. `cover` copies the WebGL canvas (drawn with
 * preserveDrawingBuffer) into an overlay canvas above it; `reveal` fades that copy out once the
 * change has drawn, or drops it at once under reduced motion. The live canvas is never touched, so
 * the frames after the fade are exactly what the viewer renders.
 */
export function useViewerCrossfade() {
  const source = useRef<HTMLCanvasElement | null>(null);
  /** Names the WebGL canvas to copy. */
  const track = useCallback((canvas: HTMLCanvasElement | null) => { source.current = canvas; }, []);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  /** The overlay canvas's ref callback. */
  const attach = useCallback((element: HTMLCanvasElement | null) => { overlay.current = element; }, []);
  const state = useRef<{ holding: boolean; fade: Animation | null; limit: ReturnType<typeof setTimeout> | null }>({ holding: false, fade: null, limit: null });

  const hide = useCallback(() => {
    const element = overlay.current;
    if (element) element.hidden = true;
  }, []);

  const reveal = useCallback(() => {
    const current = state.current;
    const element = overlay.current;
    if (!current.holding || !element) return;
    current.holding = false;
    if (current.limit) clearTimeout(current.limit);
    current.limit = null;
    if (reducedMotion() || typeof element.animate !== 'function') { hide(); return; }
    current.fade = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' });
    current.fade.onfinish = hide;
  }, [hide]);

  const cover = useCallback(() => {
    const current = state.current;
    const from = source.current, element = overlay.current;
    // A cover already up keeps its first frame; the latest change reveals it.
    if (current.holding || !from || !element || !from.width || !from.height) return;
    current.fade?.cancel();
    current.fade = null;
    element.width = from.width;
    element.height = from.height;
    const context = element.getContext('2d');
    if (!context) return;
    try { context.drawImage(from, 0, 0); } catch { return; }
    element.style.opacity = '1';
    element.hidden = false;
    current.holding = true;
    current.limit = setTimeout(reveal, COVER_LIMIT_MS);
  }, [reveal]);

  /** Reveals after two frames: the change has been committed and drawn at least once. */
  const revealSoon = useCallback(() => {
    if (!state.current.holding) return;
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }, [reveal]);

  useEffect(() => () => {
    const current = state.current;
    if (current.limit) clearTimeout(current.limit);
    current.fade?.cancel();
  }, []);

  return useMemo(() => ({ track, attach, cover, reveal, revealSoon }), [track, attach, cover, reveal, revealSoon]);
}
