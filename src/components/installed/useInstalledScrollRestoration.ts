import { useLayoutEffect, useRef, type RefObject } from 'react';

const RESTORE_SETTLE_MS = 500;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab']);

interface ScrollCallbacks {
  onScroll: (offset: number) => void;
  onDetach: (offset: number) => void;
}

/** Keep scroll bookkeeping outside React and follow a scroller that appears after loading. */
export function useInstalledScrollRestoration(
  ref: RefObject<HTMLDivElement | null>,
  initialScrollTop: number,
  onScroll: (offset: number) => void,
  onDetach: (offset: number) => void,
): void {
  const latest = useRef(Math.max(0, initialScrollTop));
  const callbacks = useRef<ScrollCallbacks>({ onScroll, onDetach });
  const bound = useRef<{ element: HTMLDivElement; detach: () => void } | null>(null);

  useLayoutEffect(() => {
    callbacks.current = { onScroll, onDetach };
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (bound.current?.element === element) return;
    bound.current?.detach();
    bound.current = element ? {
      element,
      detach: attachScrollRestoration(element, latest, callbacks),
    } : null;
  });

  useLayoutEffect(() => () => {
    bound.current?.detach();
    bound.current = null;
  }, []);
}

function attachScrollRestoration(
  element: HTMLDivElement,
  latest: { current: number },
  callbacks: { current: ScrollCallbacks },
): () => void {
  const target = latest.current;
  let restoring = target > 0;
  let frame = 0;
  let settleTimer: number | undefined;

  const publish = () => {
    const offset = element.scrollTop;
    if (latest.current === offset) return;
    latest.current = offset;
    callbacks.current.onScroll(offset);
  };
  const stopRestoring = () => {
    restoring = false;
    window.cancelAnimationFrame(frame);
    frame = 0;
    window.clearTimeout(settleTimer);
    element.removeEventListener('installed-virtual-grid-resize', scheduleRestore);
    element.removeEventListener('installed-entry-reveal', onIntent);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('pointerdown', onIntent, true);
    element.removeEventListener('keydown', onKeyDown, true);
  };
  const restore = () => {
    frame = 0;
    if (!restoring) return;
    element.scrollTop = target;
  };
  function scheduleRestore() {
    if (restoring && !frame) frame = window.requestAnimationFrame(restore);
  }
  function onIntent() {
    stopRestoring();
    publish();
  }
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && (event.deltaX !== 0 || event.deltaY !== 0)) onIntent();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (SCROLL_KEYS.has(event.key)) onIntent();
  }
  const onNativeScroll = () => {
    // Measuring or browser anchoring can move the viewport even after the first
    // successful restore. User intent and explicit reveals cancel this bounded
    // settling phase; geometry changes must not replace the saved position.
    if (restoring) return;
    publish();
  };

  element.addEventListener('scroll', onNativeScroll, { passive: true });
  if (restoring) {
    element.addEventListener('installed-virtual-grid-resize', scheduleRestore);
    element.addEventListener('installed-entry-reveal', onIntent);
    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('pointerdown', onIntent, { passive: true, capture: true });
    element.addEventListener('keydown', onKeyDown, true);
    restore();
    scheduleRestore();
    // Geometry events can refine the estimate during this bounded window.
    // Afterwards an unreachable offset is accepted at the new library bottom.
    settleTimer = window.setTimeout(() => {
      restore();
      stopRestoring();
      publish();
    }, RESTORE_SETTLE_MS);
  }

  return () => {
    stopRestoring();
    element.removeEventListener('scroll', onNativeScroll);
    callbacks.current.onDetach(latest.current);
  };
}
