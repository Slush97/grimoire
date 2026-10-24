import { useEffect, useRef, type RefObject } from 'react';

const SCROLL_IDLE_MS = 140;

/** Suppress decorative hover work without rendering the card tree on scroll. */
export function useInstalledScrollActivity(ref: RefObject<HTMLElement | null>): void {
  const bound = useRef<{ element: HTMLElement; detach: () => void } | null>(null);

  // The scroller can appear after the loading or empty state has gone away.
  useEffect(() => {
    const element = ref.current;
    if (bound.current?.element === element) return;
    bound.current?.detach();
    bound.current = element ? { element, detach: attachScrollActivity(element) } : null;
  });

  useEffect(() => () => {
    bound.current?.detach();
    bound.current = null;
  }, []);
}

function attachScrollActivity(element: HTMLElement): () => void {
  let idleTimer: number | undefined;
  const onScroll = () => {
    if (idleTimer === undefined) element.classList.add('installed-is-scrolling');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = undefined;
      element.classList.remove('installed-is-scrolling');
    }, SCROLL_IDLE_MS);
  };

  element.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    element.removeEventListener('scroll', onScroll);
    window.clearTimeout(idleTimer);
    element.classList.remove('installed-is-scrolling');
  };
}
