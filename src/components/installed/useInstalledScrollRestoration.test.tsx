// @vitest-environment jsdom

import { act, StrictMode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstalledScrollRestoration } from './useInstalledScrollRestoration';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('Installed scroll restoration', () => {
  let host: HTMLDivElement;
  let root: Root;
  let maxOffset: number;
  let renders: number;
  const onScroll = vi.fn();
  const onDetach = vi.fn();

  function Page({ show = true, initial = 0, identity = 'library' }: {
    show?: boolean;
    initial?: number;
    identity?: string;
  }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useInstalledScrollRestoration(ref, initial, onScroll, onDetach);
    renders++;
    return show ? <div key={identity} ref={(element) => {
      ref.current = element;
      if (!element || Object.hasOwn(element, 'scrollTop')) return;
      let offset = 0;
      Object.defineProperty(element, 'scrollTop', {
        get: () => offset,
        set: (next: number) => { offset = Math.max(0, Math.min(next, maxOffset)); },
      });
    }} /> : null;
  }

  function render(props: { show?: boolean; initial?: number; identity?: string } = {}, strict = false) {
    act(() => root.render(strict ? <StrictMode><Page {...props} /></StrictMode> : <Page {...props} />));
    return host.firstElementChild as HTMLDivElement;
  }

  function scroll(element: HTMLElement, offset: number) {
    act(() => {
      element.scrollTop = offset;
      element.dispatchEvent(new Event('scroll'));
    });
  }

  function geometryChanged(element: HTMLElement, nextMaxOffset: number) {
    maxOffset = nextMaxOffset;
    act(() => element.dispatchEvent(new Event('installed-virtual-grid-resize', { bubbles: true })));
    act(() => vi.advanceTimersByTime(20));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    onScroll.mockClear();
    onDetach.mockClear();
    maxOffset = 2000;
    renders = 0;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('captures the saved offset once and waits for a scroller after loading', () => {
    render({ initial: 700, show: false });
    const scroller = render({ initial: 1200 });
    expect(scroller.scrollTop).toBe(700);
    expect(onScroll).not.toHaveBeenCalled();
  });

  it('does not replace a saved offset with an initial geometry clamp', () => {
    maxOffset = 150;
    const scroller = render({ initial: 1100 });
    expect(scroller.scrollTop).toBe(150);
    scroll(scroller, 150);
    expect(onScroll).not.toHaveBeenCalled();

    geometryChanged(scroller, 1800);
    expect(scroller.scrollTop).toBe(1100);
    act(() => vi.advanceTimersByTime(500));
    expect(onScroll).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(host);
    expect(onDetach).toHaveBeenLastCalledWith(1100);
  });

  it('keeps restoring when virtual row measurements clamp a previously reached offset', () => {
    const scroller = render({ initial: 1100 });
    expect(scroller.scrollTop).toBe(1100);
    maxOffset = 200;
    scroll(scroller, 200);
    expect(onScroll).not.toHaveBeenCalled();
    geometryChanged(scroller, 1800);
    expect(scroller.scrollTop).toBe(1100);
    act(() => vi.advanceTimersByTime(500));
    expect(scroller.scrollTop).toBe(1100);
  });

  it('accepts the library bottom after a bounded attempt at an unreachable offset', () => {
    maxOffset = 200;
    const scroller = render({ initial: 1100 });
    act(() => vi.advanceTimersByTime(500));
    expect(onScroll).toHaveBeenLastCalledWith(200);
    expect(vi.getTimerCount()).toBe(0);
    geometryChanged(scroller, 1800);
    expect(scroller.scrollTop).toBe(200);
  });

  it.each([
    ['wheel', () => new WheelEvent('wheel', { deltaY: 100 })],
    ['pointer', () => new Event('pointerdown', { bubbles: true })],
    ['keyboard', () => new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })],
  ])('lets %s input cancel a pending restoration', (_, makeEvent) => {
    maxOffset = 200;
    const scroller = render({ initial: 1100 });
    act(() => scroller.dispatchEvent(makeEvent()));
    scroll(scroller, 100);
    expect(onScroll).toHaveBeenLastCalledWith(100);
    geometryChanged(scroller, 1800);
    act(() => vi.advanceTimersByTime(600));
    expect(scroller.scrollTop).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows an explicit reveal after restoration without resetting its scroll', () => {
    const scroller = render({ initial: 1100 });
    act(() => scroller.dispatchEvent(new Event('installed-entry-reveal', { bubbles: true })));
    scroll(scroller, 350);
    expect(onScroll).toHaveBeenLastCalledWith(350);
    geometryChanged(scroller, 1800);
    act(() => vi.advanceTimersByTime(600));
    expect(scroller.scrollTop).toBe(350);
  });

  it('lets a card reveal replace an unreachable saved offset before geometry settles', () => {
    maxOffset = 200;
    const scroller = render({ initial: 1100 });
    act(() => scroller.dispatchEvent(new Event('installed-entry-reveal', { bubbles: true })));
    scroll(scroller, 80);
    geometryChanged(scroller, 1800);
    act(() => vi.advanceTimersByTime(600));
    expect(scroller.scrollTop).toBe(80);
    expect(onScroll).toHaveBeenLastCalledWith(80);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records scrolling without rendering and persists the latest offset on detach', () => {
    const scroller = render();
    const renderCount = renders;
    scroll(scroller, 300);
    scroll(scroller, 450);
    expect(renders).toBe(renderCount);
    expect(onScroll.mock.calls.map(([offset]) => offset)).toEqual([300, 450]);
    render({ show: false });
    expect(onDetach).toHaveBeenLastCalledWith(450);
    scroll(scroller, 100);
    expect(onScroll).toHaveBeenCalledTimes(2);
  });

  it('restores the tracked offset into a replacement scroller', () => {
    const previous = render();
    scroll(previous, 450);
    const replacement = render({ identity: 'replacement', initial: 50 });
    expect(onDetach).toHaveBeenLastCalledWith(450);
    expect(replacement.scrollTop).toBe(450);
    scroll(previous, 100);
    expect(onScroll).toHaveBeenLastCalledWith(450);
  });

  it('cleans up pending restoration in StrictMode and on navigation away', () => {
    maxOffset = 100;
    const scroller = render({ initial: 1100 }, true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root.unmount());
    root = createRoot(host);
    expect(vi.getTimerCount()).toBe(0);
    expect(onDetach).toHaveBeenLastCalledWith(1100);
    geometryChanged(scroller, 1800);
    scroll(scroller, 50);
    expect(onScroll).not.toHaveBeenCalled();
  });
});
