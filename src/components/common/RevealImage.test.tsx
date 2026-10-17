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
