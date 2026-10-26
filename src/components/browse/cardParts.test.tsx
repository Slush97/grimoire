// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseArtParallaxCard } from './cardParts';

vi.mock('../../lib/dates', () => ({
  formatAbsoluteDate: vi.fn(),
  formatRelativeDate: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('BrowseArtParallaxCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let motionListener: ((event: MediaQueryListEvent) => void) | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    frames = new Map();
    nextFrame = 0;
    motionListener = undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        motionListener = listener;
      },
      removeEventListener: vi.fn(),
    })));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderCard(props: { disabled?: boolean; suppressHoverIntentRef?: { current: boolean } } = {}) {
    act(() => root.render(<BrowseArtParallaxCard {...props}><span /></BrowseArtParallaxCard>));
    return host.firstElementChild as HTMLDivElement;
  }

  function geometry(card: HTMLDivElement) {
    return vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100,
      width: 100, height: 100, toJSON: () => ({}),
    });
  }

  function pointer(card: HTMLDivElement, type: string, x = 0, y = 0, pointerType = 'mouse') {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    act(() => card.dispatchEvent(event));
  }

  function paint() {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  }

  it('uses the latest pointer position and reads geometry at most once per paint', () => {
    const card = renderCard();
    const readGeometry = geometry(card);
    const write = vi.spyOn(card.style, 'setProperty');
    for (let i = 0; i < 100; i++) pointer(card, 'pointermove', i, i / 2);
    pointer(card, 'pointermove', 100, 75);

    expect(frames.size).toBe(1);
    expect(readGeometry).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    paint();

    expect(readGeometry).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(3);
    expect(card.style.getPropertyValue('--browse-art-x')).toBe('-2.00px');
    expect(card.style.getPropertyValue('--browse-art-y')).toBe('-1.00px');
    expect(card.style.getPropertyValue('--browse-art-rotate')).toBe('0.10deg');
    pointer(card, 'pointermove', 0, 0);
    paint();
    expect(readGeometry).toHaveBeenCalledTimes(2);
    expect(card.style.getPropertyValue('--browse-art-x')).toBe('2.00px');
  });

  it('skips scroll-time pointer work, including a frame queued before scrolling starts', () => {
    const scrolling = { current: false };
    const card = renderCard({ suppressHoverIntentRef: scrolling });
    const readGeometry = geometry(card);
    const write = vi.spyOn(card.style, 'setProperty');
    pointer(card, 'pointermove', 100, 75);
    scrolling.current = true;
    paint();
    pointer(card, 'pointermove', 25, 25);

    expect(frames.size).toBe(0);
    expect(readGeometry).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    scrolling.current = false;
    pointer(card, 'pointermove', 25, 25);
    paint();
    expect(readGeometry).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerout', 'pointercancel'])('cancels pending movement and resets on %s', (type) => {
    const card = renderCard();
    const readGeometry = geometry(card);
    pointer(card, 'pointermove', 100, 75);
    paint();
    pointer(card, 'pointermove', 25, 25);
    pointer(card, type);
    paint();

    expect(frames.size).toBe(0);
    expect(readGeometry).toHaveBeenCalledTimes(1);
    expect(card.style.getPropertyValue('--browse-art-x')).toBe('0px');
    expect(card.style.getPropertyValue('--browse-art-y')).toBe('0px');
    expect(card.style.getPropertyValue('--browse-art-rotate')).toBe('0deg');
  });

  it('cancels queued work when the scroll ref changes', () => {
    const card = renderCard({ suppressHoverIntentRef: { current: false } });
    const readGeometry = geometry(card);
    pointer(card, 'pointermove', 100, 75);
    renderCard({ suppressHoverIntentRef: { current: true } });
    paint();
    expect(readGeometry).not.toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('cancels queued work and resets when explicitly disabled', () => {
    const card = renderCard();
    const readGeometry = geometry(card);
    pointer(card, 'pointermove', 100, 75);
    renderCard({ disabled: true });
    paint();
    pointer(card, 'pointermove', 25, 25);

    expect(frames.size).toBe(0);
    expect(readGeometry).not.toHaveBeenCalled();
    expect(card.dataset.parallaxDisabled).toBe('true');
    expect(card.style.getPropertyValue('--browse-art-x')).toBe('0px');
  });

  it('cancels movement when reduced motion is enabled and resumes when disabled', () => {
    const card = renderCard();
    const readGeometry = geometry(card);
    pointer(card, 'pointermove', 100, 75);
    act(() => motionListener?.({ matches: true } as MediaQueryListEvent));
    paint();
    pointer(card, 'pointermove', 25, 25);

    expect(frames.size).toBe(0);
    expect(readGeometry).not.toHaveBeenCalled();
    expect(card.dataset.parallaxDisabled).toBe('true');
    expect(card.style.getPropertyValue('--browse-art-x')).toBe('0px');
    act(() => motionListener?.({ matches: false } as MediaQueryListEvent));
    pointer(card, 'pointermove', 25, 25);
    paint();
    expect(readGeometry).toHaveBeenCalledTimes(1);
    expect(card.dataset.parallaxDisabled).toBeUndefined();
  });

  it('ignores touch and pen movement', () => {
    const card = renderCard();
    pointer(card, 'pointermove', 100, 75, 'touch');
    pointer(card, 'pointermove', 100, 75, 'pen');
    expect(frames.size).toBe(0);
  });

  it('cancels pending work on unmount', () => {
    const card = renderCard();
    const readGeometry = geometry(card);
    pointer(card, 'pointermove', 100, 75);
    act(() => root.render(null));
    paint();
    expect(readGeometry).not.toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
