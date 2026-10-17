// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RevealImage } from './RevealImage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const img = () => host.querySelector('img')!;

beforeEach(() => {
  // jsdom has no image decoder.
  HTMLImageElement.prototype.decode = vi.fn(() => Promise.resolve());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('holds the image hidden until it has loaded and decoded, then fades it in', async () => {
  act(() => root.render(<RevealImage src="https://images.gamebanana.com/a.jpg" alt="" className="h-full w-full" />));
  expect(img().dataset.reveal).toBe('pending');
  expect(img().className).toContain('reveal-img--skeleton');
  expect(img().getAttribute('loading')).toBe('lazy');
  await act(async () => {
    img().dispatchEvent(new Event('load'));
  });
  expect(img().dataset.reveal).toBe('in');
});

it('shows a source this session already revealed as it arrives, with no fade', async () => {
  act(() => root.render(<RevealImage src="https://images.gamebanana.com/b.jpg" alt="" />));
  await act(async () => {
    img().dispatchEvent(new Event('load'));
  });
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(<RevealImage src="https://images.gamebanana.com/b.jpg" alt="" />));
  expect(img().dataset.reveal).toBe('cached');
  act(() => {
    img().dispatchEvent(new Event('load'));
  });
  expect(img().dataset.reveal).toBe('instant');
});

it('swaps a failed image for a quiet placeholder', () => {
  act(() => root.render(<RevealImage src="https://images.gamebanana.com/missing.jpg" alt="" className="h-10 w-14" />));
  act(() => {
    img().dispatchEvent(new Event('error'));
  });
  expect(host.querySelector('img')).toBeNull();
  const fallback = host.querySelector('.reveal-fallback')!;
  expect(fallback.className).toContain('h-10 w-14');
});

it('loads the first row eagerly at high priority', () => {
  act(() => root.render(<RevealImage src="https://images.gamebanana.com/c.jpg" alt="" priority />));
  expect(img().getAttribute('loading')).toBe('eager');
  expect(img().getAttribute('fetchpriority')).toBe('high');
});

it('reveals a loaded image even when decode never settles', async () => {
  vi.useFakeTimers();
  try {
    HTMLImageElement.prototype.decode = vi.fn(() => new Promise<void>(() => {}));
    act(() => root.render(<RevealImage src="https://images.gamebanana.com/d.jpg" alt="" />));
    act(() => {
      img().dispatchEvent(new Event('load'));
    });
    expect(img().dataset.reveal).toBe('pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(img().dataset.reveal).toBe('in');
  } finally {
    vi.useRealTimers();
  }
});

it('tries fallbackSrc at once when src fails', () => {
  act(() => root.render(<RevealImage src="https://images.gamebanana.com/220-90_e.jpg" fallbackSrc="https://images.gamebanana.com/530-90_e.jpg" alt="" />));
  act(() => {
    img().dispatchEvent(new Event('error'));
  });
  expect(img().getAttribute('src')).toBe('https://images.gamebanana.com/530-90_e.jpg');
  expect(img().dataset.reveal).toBe('pending');
});

it('retries a failed image after a wait, then gives up', () => {
  vi.useFakeTimers();
  try {
    act(() => root.render(<RevealImage src="https://images.gamebanana.com/f.jpg" alt="" />));
    for (const wait of [2000, 8000]) {
      act(() => {
        img().dispatchEvent(new Event('error'));
      });
      expect(host.querySelector('img')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(wait);
      });
      expect(img().getAttribute('src')).toBe('https://images.gamebanana.com/f.jpg');
    }
    act(() => {
      img().dispatchEvent(new Event('error'));
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.reveal-fallback')).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('refetches a src that failed earlier when it comes back', () => {
  const a = 'https://images.gamebanana.com/g.jpg';
  act(() => root.render(<RevealImage src={a} alt="" />));
  act(() => {
    img().dispatchEvent(new Event('error'));
  });
  expect(host.querySelector('img')).toBeNull();
  act(() => root.render(<RevealImage src="https://images.gamebanana.com/h.jpg" alt="" />));
  act(() => root.render(<RevealImage src={a} alt="" />));
  expect(img().getAttribute('src')).toBe(a);
});
