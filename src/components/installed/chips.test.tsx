// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import soulUrn from '../../assets/soul-urn.png';
import { FittingTagList, HeroIconStack } from './chips';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let host: HTMLDivElement;
let root: Root;
let available: number;
let gap: number;
let widths: Map<string, number>;
let observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element>; disconnected: boolean }>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  available = 100;
  gap = 6;
  widths = new Map([['Primary', 40], ['Secondary', 30], ['Tertiary', 20], ['+1', 18], ['+2', 20], ['+3', 22]]);
  observers = [];
  vi.stubGlobal('ResizeObserver', class {
    record: typeof observers[number];
    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, targets: new Set(), disconnected: false };
      observers.push(this.record);
    }
    observe(target: Element) { this.record.targets.add(target); }
    unobserve(target: Element) { this.record.targets.delete(target); }
    disconnect() { this.record.disconnected = true; this.record.targets.clear(); }
  });
  const originalBounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-fitting-tags')) return DOMRect.fromRect({ width: available, height: 22 });
    if (this.parentElement?.hasAttribute('data-tag-measure')) {
      return DOMRect.fromRect({ width: widths.get(this.textContent ?? '') ?? 30, height: 22 });
    }
    return originalBounds.call(this);
  });
  const originalStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => (
    element.hasAttribute('data-fitting-tags')
      ? { columnGap: `${gap}px` } as CSSStyleDeclaration
      : originalStyle(element, pseudo)
  ));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

function visibleTags(): HTMLElement[] {
  const row = host.querySelector('[data-fitting-tags]');
  return row ? [...row.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('title')) : [];
}

async function resize(target: Element) {
  await act(async () => {
    for (const observer of observers) {
      if (observer.targets.has(target)) observer.callback([], {} as ResizeObserver);
    }
  });
}

describe('hero icon stacks', () => {
  const heroes = ['Abrams', 'Baba', 'Bebop', 'Calico', 'Drifter', 'Dynamo', 'Haze'];

  it.each([1, 2, 5, 6, 7])('renders %i heroes within 66px with fixed 22px icons and an all-hero tooltip', async count => {
    const selected = heroes.slice(0, count);
    await render(<HeroIconStack heroes={selected} />);
    const stack = host.querySelector<HTMLElement>('[data-hero-stack]')!;
    const images = [...stack.querySelectorAll('img')];
    const heroImages = images.filter(image => image.getAttribute('src') !== soulUrn);
    const overflowImages = images.filter(image => image.getAttribute('src') === soulUrn);
    const shown = count > 5 ? 4 : count;
    expect(heroImages).toHaveLength(shown);
    expect(overflowImages).toHaveLength(count > 5 ? 1 : 0);
    expect(stack.style.width).toBe(`${Math.min(66, count * 22)}px`);
    expect(stack.title).toBe(selected.join(', '));
    expect(stack.getAttribute('aria-label')).toBe(selected.join(', '));
    expect(stack.getAttribute('role')).toBe('img');
    for (const image of images) {
      expect(image.classList.contains('h-[22px]')).toBe(true);
      expect(image.classList.contains('w-[22px]')).toBe(true);
    }
    expect(heroImages.map(image => image.parentElement?.textContent)).toEqual(selected.slice(0, shown).reverse());
    expect(stack.textContent).not.toMatch(/\+\d+/);
    if (count > 5) {
      const overflowImage = overflowImages[0];
      expect(overflowImage.classList.contains('object-contain')).toBe(true);
      expect(overflowImage.classList.contains('grayscale')).toBe(true);
      expect(overflowImage.classList.contains('brightness-50')).toBe(true);
      expect(overflowImage.classList.contains('opacity-70')).toBe(true);
      expect(overflowImage.getAttribute('src')).toBe(soulUrn);
      expect(overflowImage.alt).toBe('');
      expect(overflowImage.getAttribute('aria-hidden')).toBe('true');
      expect(overflowImage.draggable).toBe(false);
      expect(overflowImage.parentElement).toBe(stack.firstElementChild);
      expect(images[0]).toBe(overflowImage);
    }
  });

  it('renders no stack for an empty hero set', async () => {
    await render(<HeroIconStack heroes={[]} />);
    expect(host.innerHTML).toBe('');
  });
});

describe('fitting installed tags', () => {
  const labels = ['Primary', 'Secondary', 'Tertiary'];

  it('fits the ordered prefix using the measured overflow-chip width and gaps', async () => {
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    expect(visibleTags().map(node => node.textContent)).toEqual(['Primary', 'Secondary', '+1']);
    expect(visibleTags().at(-1)?.title).toBe('Tertiary');
    available = 70;
    await resize(host.querySelector('[data-fitting-tags]')!);
    expect(visibleTags().map(node => node.textContent)).toEqual(['Primary', '+2']);
    expect(visibleTags().at(-1)?.title).toBe('Secondary\nTertiary');
  });

  it('shows every label when they all fit, even if a reserved overflow chip would not fit', async () => {
    available = 102;
    widths.set('+1', 70);
    widths.set('+2', 70);
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    expect(visibleTags().map(node => node.textContent)).toEqual(labels);
  });

  it('preserves ordering when the first tag is too large, putting all tags in the overflow tooltip', async () => {
    widths.set('Primary', 180);
    widths.set('Secondary', 8);
    widths.set('Tertiary', 8);
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    expect(visibleTags().map(node => node.textContent)).toEqual(['+3']);
    expect(visibleTags()[0].title).toBe(labels.join('\n'));
  });

  it('collapses a zero-width row with measurable tags and reserves room for the overflow chip', async () => {
    available = 0;
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    const row = host.querySelector<HTMLElement>('[data-fitting-tags]')!;
    expect(visibleTags().map(node => node.textContent)).toEqual(['+3']);
    expect(visibleTags()[0].title).toBe(labels.join('\n'));
    expect(row.style.minWidth).toBe('22px');
    available = 70;
    await resize(row);
    expect(visibleTags().map(node => node.textContent)).toEqual(['Primary', '+2']);
  });

  it('waits for measurable dimensions instead of treating a hidden layout as a real zero-width row', async () => {
    available = 0;
    for (const key of widths.keys()) widths.set(key, 0);
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    expect(visibleTags().map(node => node.textContent)).toEqual(labels);
    widths.set('Primary', 40);
    widths.set('Secondary', 30);
    widths.set('Tertiary', 20);
    widths.set('+3', 22);
    await resize(host.querySelector('[data-tag-measure]')!);
    expect(visibleTags().map(node => node.textContent)).toEqual(['+3']);
  });

  it('remeasures when the row width changes and disconnects on unmount', async () => {
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    const row = host.querySelector('[data-fitting-tags]')!;
    const probe = host.querySelector('[data-tag-measure]')!;
    expect(probe.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(observers[0].targets).toEqual(new Set([row, probe]));
    available = 60;
    await resize(row);
    expect(visibleTags().map(node => node.textContent)).toEqual(['+3']);
    available = 120;
    await resize(row);
    expect(visibleTags().map(node => node.textContent)).toEqual(labels);
    await render(null);
    expect(observers.every(observer => observer.disconnected)).toBe(true);
  });

  it('remeasures font or theme width changes reported by the probe without a row resize', async () => {
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    widths.set('Secondary', 60);
    await resize(host.querySelector('[data-tag-measure]')!);
    expect(visibleTags().map(node => node.textContent)).toEqual(['Primary', '+2']);
  });

  it('remeasures class and label prop changes while cleaning up obsolete observers', async () => {
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    widths.set('Secondary', 60);
    await render(<FittingTagList labels={labels} chipClassName="tag large-font" />);
    expect(observers[0].disconnected).toBe(true);
    expect(visibleTags().map(node => node.textContent)).toEqual(['Primary', '+2']);
    await render(<FittingTagList labels={['Tertiary']} chipClassName="tag large-font" />);
    expect(visibleTags().map(node => node.textContent)).toEqual(['Tertiary']);
  });

  it('renders no row or observer for empty labels and can later receive labels', async () => {
    await render(<FittingTagList labels={[]} chipClassName="tag" />);
    expect(host.innerHTML).toBe('');
    expect(observers).toHaveLength(0);
    await render(<FittingTagList labels={labels} chipClassName="tag" />);
    expect(visibleTags().map(node => node.textContent)).toEqual(['Primary', 'Secondary', '+1']);
    await render(<FittingTagList labels={[]} chipClassName="tag" />);
    expect(host.innerHTML).toBe('');
    expect(observers.every(observer => observer.disconnected)).toBe(true);
  });
});
