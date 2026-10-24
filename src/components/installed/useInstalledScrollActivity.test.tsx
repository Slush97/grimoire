// @vitest-environment jsdom

import { act, StrictMode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstalledScrollActivity } from './useInstalledScrollActivity';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('Installed scroll activity', () => {
  let host: HTMLDivElement;
  let root: Root;
  let renders: number;

  function Page({ show = true, identity = 'library' }: { show?: boolean; identity?: string }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useInstalledScrollActivity(ref);
    renders++;
    return show ? <div key={identity} ref={ref} /> : null;
  }

  function render(props: { show?: boolean; identity?: string } = {}) {
    act(() => root.render(<StrictMode><Page {...props} /></StrictMode>));
    return host.firstElementChild as HTMLDivElement;
  }

  function scroll(element: HTMLElement) {
    act(() => element.dispatchEvent(new Event('scroll')));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    renders = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('suppresses hover throughout a scroll burst without rendering cards', () => {
    const scroller = render();
    const initialRenders = renders;
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(false);

    scroll(scroller);
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    scroll(scroller);
    act(() => vi.advanceTimersByTime(139));
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(false);
    expect(renders).toBe(initialRenders);

    scroll(scroller);
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(true);
  });

  it('starts tracking when content appears after a loading or empty state', () => {
    render({ show: false });
    const scroller = render();
    scroll(scroller);
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(true);
  });

  it('detaches the old node and its pending idle reset when the scroller changes', () => {
    const oldScroller = render();
    scroll(oldScroller);
    const newScroller = render({ identity: 'replacement' });
    expect(oldScroller.classList.contains('installed-is-scrolling')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    scroll(oldScroller);
    expect(oldScroller.classList.contains('installed-is-scrolling')).toBe(false);
    scroll(newScroller);
    expect(newScroller.classList.contains('installed-is-scrolling')).toBe(true);
  });

  it('cleans up when content disappears and can track the next library', () => {
    const oldScroller = render();
    scroll(oldScroller);
    render({ show: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(oldScroller.classList.contains('installed-is-scrolling')).toBe(false);
    scroll(oldScroller);
    expect(oldScroller.classList.contains('installed-is-scrolling')).toBe(false);

    const newScroller = render();
    scroll(newScroller);
    expect(newScroller.classList.contains('installed-is-scrolling')).toBe(true);
  });

  it('removes listeners and pending timers on navigation away', () => {
    const scroller = render();
    scroll(scroller);
    act(() => root.unmount());
    root = createRoot(host);
    expect(vi.getTimerCount()).toBe(0);
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(false);
    scroll(scroller);
    expect(scroller.classList.contains('installed-is-scrolling')).toBe(false);
  });
});
