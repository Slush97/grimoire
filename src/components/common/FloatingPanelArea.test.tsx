// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FloatingPanelArea } from './FloatingPanelArea';
import { useFloatingPanelArea } from './floatingPanelContext';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('measures below a wrapping toolbar, clips to ancestors, and excludes scrollbars', () => {
  const callbacks: ResizeObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
    observe() {}
    disconnect = disconnect;
  });
  const host = document.createElement('div');
  const ancestor = document.createElement('div');
  const viewport = document.createElement('div');
  const toolbar = document.createElement('div');
  ancestor.append(viewport); viewport.append(toolbar); document.body.append(host, ancestor);
  const measured = (element: HTMLElement, x: number, y: number, width: number, height: number) => {
    element.getBoundingClientRect = () => DOMRect.fromRect({ x, y, width, height });
    Object.defineProperties(element, { clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height } });
  };
  measured(ancestor, 180, 40, 700, 600); ancestor.style.overflowX = 'hidden'; ancestor.style.overflowY = 'auto';
  measured(viewport, 200, 50, 800, 650);
  Object.defineProperty(viewport, 'clientWidth', { value: 785 });
  let toolbarBottom = 130;
  toolbar.getBoundingClientRect = () => DOMRect.fromRect({ x: 200, y: 50, width: 785, height: toolbarBottom - 50 });
  const root = createRoot(host);
  function Probe() {
    const { bounds, showGuides, clearGuides } = useFloatingPanelArea();
    return <>
      <output>{JSON.stringify(bounds)}</output>
      <button onClick={() => showGuides(Symbol.for('panel'), { x: bounds!.x + bounds!.width / 2 })}>Snap</button>
      <button onClick={() => clearGuides(Symbol.for('other'))}>Other</button>
      <button onClick={() => clearGuides(Symbol.for('panel'))}>Clear</button>
      <button onClick={() => showGuides(Symbol.for('panel'), { x: bounds!.x, y: bounds!.y })}>Edge</button>
    </>;
  }
  try {
    act(() => root.render(<FloatingPanelArea viewport={viewport} topBoundary={toolbar}><Probe /></FloatingPanelArea>));
    const bounds = () => JSON.parse(host.querySelector('output')!.textContent!);
    expect(bounds()).toEqual({ x: 200, y: 130, width: 680, height: 510 });
    toolbarBottom = 200;
    act(() => callbacks.forEach(callback => callback([], {} as ResizeObserver)));
    expect(bounds()).toEqual({ x: 200, y: 200, width: 680, height: 440 });
    measured(ancestor, 180, 40, 900, 600);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(bounds().width).toBe(785); // Client width, not the 800px border rectangle.
    act(() => host.querySelectorAll('button')[0].click());
    expect(document.querySelector('[data-floating-panel-guide="x"]')).not.toBeNull();
    expect(document.querySelector('[data-floating-panel-guide="x"]')?.classList.contains('border-dashed')).toBe(true);
    act(() => host.querySelectorAll('button')[3].click());
    expect(document.querySelector('[data-floating-panel-guide]')).toBeNull();
    act(() => host.querySelectorAll('button')[0].click());
    act(() => host.querySelectorAll('button')[1].click());
    expect(document.querySelector('[data-floating-panel-guide="x"]')).not.toBeNull();
    act(() => host.querySelectorAll('button')[2].click());
    expect(document.querySelector('[data-floating-panel-guide]')).toBeNull();
    act(() => host.querySelectorAll('button')[0].click());
    expect(document.querySelector('[data-floating-panel-guide]')).not.toBeNull();
    act(() => root.render(<FloatingPanelArea viewport={null} topBoundary={toolbar}><Probe /></FloatingPanelArea>));
    expect(bounds()).toBeNull();
    expect(document.querySelector('[data-floating-panel-guide]')).toBeNull();
  } finally {
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalled();
    host.remove(); ancestor.remove(); vi.unstubAllGlobals();
  }
});
