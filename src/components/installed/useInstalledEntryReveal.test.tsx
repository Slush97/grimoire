// @vitest-environment jsdom

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstalledEntryReveal } from './useInstalledEntryReveal';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Installed entry reveal', () => {
  let host: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const onReveal = vi.fn();
  const scrollIntoView = vi.fn();

  function Page({ target = 'far-away', mounted = false, ready = true, callback = onReveal }: {
    target?: string | null; mounted?: boolean; ready?: boolean; callback?: typeof onReveal;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    useInstalledEntryReveal(ref, target, callback);
    return <div ref={ref}><div data-installed-window-grid data-installed-window-ready={String(ready)}>
      {mounted && <div data-installed-entry-key="far-away" />}
    </div></div>;
  }

  function paint() {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    frames = new Map();
    nextFrame = 0;
    vi.clearAllMocks();
    vi.stubGlobal('CSS', { escape: (key: string) => key });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => { frames.delete(frame); });
    vi.stubGlobal('requestAnimationFrame', window.requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', window.cancelAnimationFrame);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('waits for an offscreen card to mount and measure before aligning and revealing it', () => {
    act(() => root.render(<Page />));
    paint();
    expect(onReveal).not.toHaveBeenCalled();
    act(() => root.render(<Page mounted ready={false} />));
    paint();
    expect(scrollIntoView).not.toHaveBeenCalled();
    act(() => root.render(<Page mounted />));
    paint();
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center' });
    paint();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(onReveal).toHaveBeenCalledExactlyOnceWith(host.querySelector('[data-installed-entry-key]'));
    expect(frames.size).toBe(0);
  });

  it('uses the latest callback after a pending reveal', () => {
    act(() => root.render(<Page mounted />));
    paint();
    const latest = vi.fn();
    act(() => root.render(<Page mounted callback={latest} />));
    paint();
    expect(onReveal).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it('cancels alignment when the target is cleared or navigation unmounts the page', () => {
    act(() => root.render(<Page mounted />));
    paint();
    act(() => root.render(<Page mounted target={null} />));
    paint();
    expect(onReveal).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('stops retrying a target that never becomes available', () => {
    act(() => root.render(<Page />));
    for (let frame = 0; frame < 65; frame++) paint();
    expect(frames.size).toBe(0);
    expect(onReveal).not.toHaveBeenCalled();
  });
});
