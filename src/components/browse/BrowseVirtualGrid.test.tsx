// @vitest-environment jsdom
import { act, createRef, StrictMode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseLoadMore } from './BrowseVirtualGrid';

vi.mock('./BrowseModCard', () => ({ MemoizedModCard: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Loading...' }) }));

describe('Browse page preloading', () => {
  let root: Root;
  let host: HTMLDivElement;
  let input: ComponentProps<typeof BrowseLoadMore>;
  let observers: { callback: IntersectionObserverCallback; options: IntersectionObserverInit; disconnected: boolean }[];
  const load = vi.fn();
  const notify = async (observer = observers.at(-1)!) => act(async () => {
    observer.callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver);
  });
  const render = async (patch: Partial<typeof input> = {}) => {
    input = { ...input, ...patch };
    await act(async () => root.render(<StrictMode><div ref={input.scrollRef}><BrowseLoadMore {...input} /></div></StrictMode>));
  };
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    load.mockReset();
    observers = [];
    vi.stubGlobal('IntersectionObserver', class {
      record: typeof observers[number];
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
        this.record = { callback, options, disconnected: false };
        observers.push(this.record);
      }
      observe() {}
      disconnect() { this.record.disconnected = true; }
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    input = { scrollRef: createRef<HTMLDivElement>(), hasMore: true, loading: false, paused: false,
      needsMore: false, queryKey: 'feed', onLoadMore: load };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('requests once within the prefetch margin and ignores duplicate callbacks until the page settles', async () => {
    await render();
    const observer = observers.at(-1)!;
    expect(observer.options).toMatchObject({ root: input.scrollRef.current, rootMargin: '0px 0px 900px 0px' });
    await notify(observer);
    await notify(observer);
    expect(load).toHaveBeenCalledOnce();
    await render({ loading: true });
    expect(observer.disconnected).toBe(true);
    await notify(observer);
    expect(load).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading...');
    expect(host.querySelector('[role="status"]')?.className).toContain('text-xs');
    await render({ loading: false });
    expect(host.querySelector('[role="status"]')).toBeNull();
    await notify();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('fills a filtered or buffered empty grid exactly once even in StrictMode', async () => {
    await render({ needsMore: true });
    expect(load).toHaveBeenCalledOnce();
    await notify();
    expect(load).toHaveBeenCalledOnce();
  });

  it.each([{ paused: true }, { hasMore: false }, { loading: true }])('does not request while unavailable: %j', async patch => {
    await render({ ...patch, needsMore: true });
    expect(observers).toHaveLength(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects stale callbacks after a query change or unmount', async () => {
    await render();
    const old = observers.at(-1)!;
    await render({ queryKey: 'other' });
    await notify(old);
    expect(load).not.toHaveBeenCalled();
    await notify();
    expect(load).toHaveBeenCalledOnce();
    const current = observers.at(-1)!;
    await act(async () => root.render(null));
    await notify(current);
    expect(load).toHaveBeenCalledOnce();
  });
});
