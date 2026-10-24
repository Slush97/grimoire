// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModEntry } from '../../lib/modEntries';
import { InstalledVirtualGrid } from './InstalledVirtualGrid';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Installed card windowing', () => {
  let host: HTMLDivElement;
  let scroller: HTMLDivElement;
  let root: Root;
  let frames: FrameRequestCallback[];
  let observers: { callback: ResizeObserverCallback; elements: Set<Element> }[];
  const entries: ModEntry[] = Array.from({ length: 500 }, (_, index) => ({
    kind: 'single', key: `entry:${index}`, mod: {
      id: String(index), name: `Mod ${index}`, fileName: `${index}.vpk`, path: '', metaKey: `${index}.vpk`,
      enabled: true, priority: index, size: 1, installedAt: '',
    },
  }));

  beforeEach(() => {
    frames = [];
    observers = [];
    vi.stubGlobal('ResizeObserver', class {
      record: typeof observers[number];
      constructor(callback: ResizeObserverCallback) { this.record = { callback, elements: new Set() }; observers.push(this.record); }
      observe(element: Element) { this.record.elements.add(element); }
      unobserve(element: Element) { this.record.elements.delete(element); }
      disconnect() { this.record.elements.clear(); }
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.scroller !== undefined ? 600 : this.dataset.installedWindowRow !== undefined ? 300 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return Math.max(600, [...this.querySelectorAll<HTMLElement>('[data-installed-window-grid] > div')]
        .reduce((sum, spacer) => sum + parseFloat(spacer.style.height), 0));
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      gridTemplateColumns: (element as HTMLElement).dataset.installedWindowGrid !== undefined ? '238px 238px 238px 238px' : 'none',
      columnGap: '16px', rowGap: '16px',
    }) as CSSStyleDeclaration);
    scroller = document.createElement('div');
    scroller.dataset.scroller = '';
    host = document.createElement('div');
    scroller.append(host);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'scrollTo', { value: ({ top }: { top: number }) => { scroller.scrollTop = top; } });
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); scroller.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function render(extra: Partial<Parameters<typeof InstalledVirtualGrid>[0]> = {}) {
    const scrollRef = createRef<HTMLDivElement>();
    scrollRef.current = scroller;
    act(() => root.render(<InstalledVirtualGrid entries={entries} scrollRef={scrollRef} gridClassName="grid gap-4"
      viewMode="grid" renderEntry={(entry, content) => <div data-shell={entry.key}>
        {content && <div data-heavy={entry.key}><button>{entry.key}</button><audio /></div>}
      </div>} {...extra} />));
  }
  function scroll(top: number) {
    act(() => { scroller.scrollTop = top; scroller.dispatchEvent(new Event('scroll')); });
  }
  function cell(key: string) { return [...host.querySelectorAll<HTMLElement>('[data-installed-window-key]')].find((node) => node.dataset.installedWindowKey === key); }

  it('reserves the full library height while mounting a bounded card range', () => {
    render();
    expect(host.querySelector('[data-installed-window-ready="true"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-heavy]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('[data-heavy]').length).toBeLessThan(50);
    const spacer = host.querySelector<HTMLElement>('[data-installed-window-grid] > div')!;
    expect(parseFloat(spacer.style.height)).toBeGreaterThan(20000);
    scroll(18000);
    expect(cell('entry:0')).toBeUndefined();
    expect(host.querySelectorAll('[data-heavy]').length).toBeLessThan(60);
  });

  it('measures after an enclosing scroller ref attaches later in the same commit', () => {
    const scrollRef = createRef<HTMLDivElement>();
    act(() => root.render(<div ref={scrollRef} data-scroller="">
      <InstalledVirtualGrid entries={entries} scrollRef={scrollRef} gridClassName="grid gap-4" viewMode="grid"
        renderEntry={(entry, content) => content ? <button data-heavy>{entry.key}</button> : null} />
    </div>));
    expect(host.querySelector('[data-installed-window-ready="false"]')).not.toBeNull();
    act(() => { for (const frame of frames.splice(0)) frame(0); });
    expect(host.querySelector('[data-installed-window-ready="true"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-heavy]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('[data-heavy]').length).toBeLessThan(50);
  });

  it.each(['compact', 'list'] as const)('keeps %s cards bounded and uses the matching column geometry', (viewMode) => {
    render({ viewMode, gridClassName: viewMode === 'list' ? 'space-y-1.5' : 'grid gap-3' });
    const firstRow = host.querySelector<HTMLElement>('[data-installed-window-row]')!;
    expect(firstRow.children).toHaveLength(viewMode === 'list' ? 1 : 4);
    scroll(18000);
    expect(host.querySelectorAll('[data-heavy]').length).toBeLessThan(viewMode === 'list' ? 20 : 60);
  });

  it('recalculates auto-fill columns after the grid width changes', () => {
    render();
    const grid = host.querySelector<HTMLElement>('[data-installed-window-grid]')!;
    vi.mocked(window.getComputedStyle).mockReturnValue({ gridTemplateColumns: '492px 492px', columnGap: '16px', rowGap: '16px' } as CSSStyleDeclaration);
    act(() => {
      for (const observer of observers) if (observer.elements.has(grid)) observer.callback([], {} as ResizeObserver);
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(host.querySelector('[data-installed-window-row]')!.children).toHaveLength(2);
    expect(host.querySelectorAll('[data-heavy]').length).toBeLessThan(30);
  });

  it('preserves a playing preview through column resize, then regroups after pause', () => {
    render();
    const audio = cell('entry:3')!.querySelector('audio')!;
    let paused = false;
    Object.defineProperty(audio, 'paused', { get: () => paused });
    act(() => audio.dispatchEvent(new Event('play')));
    const grid = host.querySelector<HTMLElement>('[data-installed-window-grid]')!;
    vi.mocked(window.getComputedStyle).mockReturnValue({ gridTemplateColumns: '492px 492px', columnGap: '16px', rowGap: '16px' } as CSSStyleDeclaration);
    act(() => {
      for (const observer of observers) if (observer.elements.has(grid)) observer.callback([], {} as ResizeObserver);
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(cell('entry:3')!.querySelector('audio')).toBe(audio);
    expect(host.querySelector('[data-installed-window-row]')!.children).toHaveLength(4);
    paused = true;
    act(() => audio.dispatchEvent(new Event('pause')));
    expect(host.querySelector('[data-installed-window-row]')!.children).toHaveLength(2);
  });

  it('releases interaction pins belonging to filtered or deleted cards', () => {
    render();
    const audio = cell('entry:0')!.querySelector('audio')!;
    Object.defineProperty(audio, 'paused', { value: false });
    act(() => audio.dispatchEvent(new Event('play')));
    vi.mocked(window.getComputedStyle).mockReturnValue({ gridTemplateColumns: '492px 492px', columnGap: '16px', rowGap: '16px' } as CSSStyleDeclaration);
    render({ entries: entries.slice(1) });
    expect(cell('entry:0')).toBeUndefined();
    expect(host.querySelector('[data-installed-window-row]')!.children).toHaveLength(2);
  });

  it('anchors the first visible entry while column count changes', () => {
    render();
    scroll(18000);
    const currentRow = [...host.querySelectorAll<HTMLElement>('[data-installed-window-row]')]
      .find((row) => parseFloat(row.style.top) + 300 > scroller.scrollTop)!;
    const anchor = currentRow.firstElementChild!.getAttribute('data-installed-window-key')!;
    const grid = host.querySelector<HTMLElement>('[data-installed-window-grid]')!;
    vi.mocked(window.getComputedStyle).mockReturnValue({ gridTemplateColumns: '492px 492px', columnGap: '16px', rowGap: '16px' } as CSSStyleDeclaration);
    act(() => {
      for (const observer of observers) if (observer.elements.has(grid)) observer.callback([], {} as ResizeObserver);
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(scroller.scrollTop).toBeGreaterThan(25000);
    act(() => scroller.dispatchEvent(new Event('scroll')));
    expect(cell(anchor)).toBeDefined();
  });

  it('keeps all sortable shells during a drag without mounting all heavy cards', () => {
    render({ dragging: true, draggingKey: 'entry:400' });
    expect(host.querySelectorAll('[data-shell]')).toHaveLength(500);
    expect(host.querySelector('[data-heavy="entry:400"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-heavy]').length).toBeLessThan(60);
    expect(cell('entry:300')!.parentElement!.style.height).not.toBe('');
  });

  it('mounts a reveal target, matching base keys even when list occurrences have different keys', () => {
    render({ revealEntryKey: 'entry:400', getEntryKey: (entry) => `list-a:${entry.key}` });
    expect(cell('list-a:entry:400')?.querySelector('[data-heavy]')).not.toBeNull();
    const rows = [...host.querySelectorAll<HTMLElement>('[data-installed-window-row]')].map((node) => Number(node.dataset.installedWindowRow));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('retains a focused card when the user scrolls elsewhere', () => {
    render();
    act(() => cell('entry:0')!.querySelector('button')!.focus());
    scroll(18000);
    expect(cell('entry:0')).toBeDefined();
    expect(document.activeElement?.textContent).toBe('entry:0');
  });

  it('retains playing audio until it stops', () => {
    render();
    const audio = cell('entry:0')!.querySelector('audio')!;
    let paused = false;
    Object.defineProperty(audio, 'paused', { get: () => paused });
    act(() => audio.dispatchEvent(new Event('play')));
    scroll(18000);
    expect(cell('entry:0')?.querySelector('audio')).toBe(audio);
    paused = true;
    act(() => audio.dispatchEvent(new Event('pause')));
    expect(cell('entry:0')).toBeUndefined();
  });

  it('retains menu owners even when their content is portaled outside the window', async () => {
    render();
    await act(async () => cell('entry:0')!.querySelector('button')!.setAttribute('data-state', 'open'));
    scroll(18000);
    expect(cell('entry:0')).toBeDefined();
    await act(async () => cell('entry:0')!.querySelector('button')!.setAttribute('data-state', 'closed'));
    expect(cell('entry:0')).toBeUndefined();
  });

  it('Tab mounts the next missing entry instead of skipping to a distant window', () => {
    render();
    act(() => cell('entry:0')!.querySelector('button')!.focus());
    scroll(18000);
    const lastPinnedButton = cell('entry:3')!.querySelector('button')!;
    act(() => lastPinnedButton.focus());
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => lastPinnedButton.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe('entry:4');
  });

  it('updates shared-scroller offsets when an earlier sibling changes height', () => {
    const earlier = document.createElement('section');
    scroller.prepend(earlier);
    let top = 200;
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.installedWindowGrid !== undefined ? top : 0;
    });
    render();
    expect(observers.some((observer) => observer.elements.has(earlier))).toBe(true);
    top = 800;
    act(() => {
      for (const observer of observers) if (observer.elements.has(earlier)) observer.callback([], {} as ResizeObserver);
      const pending = frames.splice(0);
      for (const frame of pending) frame(0);
    });
    scroll(1000);
    expect(cell('entry:0')).toBeDefined();
  });
});
