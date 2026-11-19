// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FloatingPanelContext } from './floatingPanelContext';
import { useFloatingPanel } from './useFloatingPanel';
import type { PanelBox, PanelResizeMode } from '../../lib/floatingPanelGeometry';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const area = { x: 200, y: 100, width: 800, height: 600 };
let host: HTMLDivElement, root: Root;
let naturalWidth: number, naturalHeight: number;
let observers: Map<Element, ResizeObserverCallback>;
const commit = vi.fn();
const showGuides = vi.fn();
const clearGuides = vi.fn();

function Panel({ resizable = true, resizeMode = 'center' as PanelResizeMode, nodeKey = 'first', initial = { x: 400, y: 200, width: 200, height: 160 } as Partial<PanelBox> | null }) {
  const { ref: attachPanel, style, onDragStart, onResizeStart, resizeFromLeft } = useFloatingPanel({ initial: () => initial, placement: 'top-center',
    size: resizable ? { width: 200, height: 160 } : undefined,
    minSize: { width: 100, height: 80 }, resizeMode, onCommit: commit });
  return <aside key={nodeKey} data-panel ref={attachPanel} style={style}>
    <div data-handle onPointerDown={onDragStart}><button>Action</button></div>
    <div data-resize data-from-left={resizeFromLeft} onPointerDown={onResizeStart} />
  </aside>;
}

function render(options: Parameters<typeof Panel>[0] = {}, bounds = area) {
  act(() => root.render(<FloatingPanelContext.Provider value={{ bounds, showGuides, clearGuides }}>
    <Panel {...options} />
  </FloatingPanelContext.Provider>));
}
const node = () => host.querySelector<HTMLElement>('[data-panel]')!;
const handle = () => host.querySelector<HTMLElement>('[data-handle]')!;
const rect = () => node().getBoundingClientRect();
function pointer(target: EventTarget, type: string, x: number, y: number, shiftKey = false, pointerId = 1, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, shiftKey, button });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  act(() => { target.dispatchEvent(event); });
}
const start = () => pointer(handle(), 'pointerdown', rect().left + 10, rect().top + 10);
function resizeObserved() { act(() => observers.get(node())?.([], {} as ResizeObserver)); }

beforeEach(() => {
  naturalWidth = 200; naturalHeight = 160;
  observers = new Map();
  vi.stubGlobal('ResizeObserver', class {
    targets: Element[] = [];
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) { observers.set(target, this.callback); this.targets.push(target); }
    disconnect() { this.targets.forEach(target => observers.delete(target)); }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.min(parseFloat(this.style.width) || naturalWidth, parseFloat(this.style.maxWidth) || Infinity);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.min(parseFloat(this.style.height) || naturalHeight, parseFloat(this.style.maxHeight) || Infinity);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return DOMRect.fromRect({ x: (parseFloat(this.style.left) || 0) - this.offsetWidth / 2,
      y: (parseFloat(this.style.top) || 0) - this.offsetHeight / 2, width: this.offsetWidth, height: this.offsetHeight });
  });
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  commit.mockClear(); showGuides.mockClear(); clearGuides.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('keeps the original grab offset when the pointer overshoots any wall and returns', () => {
  render({ resizable: false }); start();
  expect(node().style.transition).toBe('none');
  pointer(window, 'pointermove', -1000, -1000);
  expect(node().style.transition).toBe('none');
  expect(rect().left).toBe(200); expect(rect().top).toBe(100);
  pointer(window, 'pointermove', -990, -990);
  expect(rect().left).toBe(200); expect(rect().top).toBe(100);
  resizeObserved(); // An unchanged observation must not reset the drag anchor.
  pointer(window, 'pointermove', 210, 110);
  expect(rect().left).toBe(200); expect(rect().top).toBe(100);
  pointer(window, 'pointermove', 220, 120);
  expect(rect().left).toBe(210); expect(rect().top).toBe(110);
  pointer(window, 'pointermove', -1000, 400);
  expect(rect().left).toBe(200); expect(rect().top).toBe(390);
  pointer(window, 'pointermove', 3000, 3000);
  expect(rect().right).toBe(1000); expect(rect().bottom).toBe(700);
  pointer(window, 'pointermove', 2990, 2990);
  expect(rect().right).toBe(1000); expect(rect().bottom).toBe(700);
  pointer(window, 'pointermove', 810, 550);
  expect(rect().right).toBe(1000); expect(rect().bottom).toBe(700);
  pointer(window, 'pointermove', 800, 540);
  expect(rect().left).toBe(790); expect(rect().top).toBe(530);
  pointer(window, 'pointermove', 3000, 3000);
  pointer(window, 'pointerup', 3000, 3000);
  expect(node().style.transition).toBe('');
  expect(commit).toHaveBeenLastCalledWith({ x: 800, y: 540, width: 200, height: 160 });
});

it('toggles Shift snapping without pointer movement and hides guides on release', () => {
  render(); start(); pointer(window, 'pointermove', 518, 329);
  expect(rect().left).toBe(508); expect(rect().top).toBe(319);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })));
  expect(node().style.transition).toBe('none');
  expect(rect().left).toBe(500); expect(rect().top).toBe(320);
  expect(showGuides).toHaveBeenLastCalledWith(expect.any(Symbol), { x: 600, y: 400 });
  act(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: true })));
  expect(rect().left).toBe(500); expect(rect().top).toBe(320);
  expect(showGuides).toHaveBeenLastCalledWith(expect.any(Symbol), { x: 600, y: 400 });
  act(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })));
  expect(rect().left).toBe(508); expect(rect().top).toBe(319);
  expect(showGuides).toHaveBeenLastCalledWith(expect.any(Symbol), {});
  pointer(window, 'pointerup', 518, 329);
  expect(clearGuides).toHaveBeenCalled();
});

it('keeps manual resizing centered across walls, caps size, then fits on release', () => {
  render({ initial: { x: 200, y: 100, width: 200, height: 160 } });
  pointer(host.querySelector('[data-resize]')!, 'pointerdown', 400, 260);
  pointer(window, 'pointermove', 450, 290);
  expect(node().style.transition).toBe('none');
  expect(rect().toJSON()).toMatchObject({ x: 150, y: 70, width: 300, height: 220 });
  pointer(window, 'pointermove', 2000, 2000);
  expect(rect().width).toBe(800); expect(rect().height).toBe(600);
  pointer(window, 'pointerup', 2000, 2000);
  expect(node().style.transition).toBe('');
  expect(rect().toJSON()).toMatchObject(area);
  expect(commit).toHaveBeenLastCalledWith(area);
});

it('recenters content-driven growth and shrinkage, moving inward only near a wall', () => {
  render({ resizable: false });
  naturalWidth = 300; naturalHeight = 200; resizeObserved();
  expect(rect().toJSON()).toMatchObject({ x: 350, y: 180, width: 300, height: 200 });
  naturalWidth = 100; naturalHeight = 80; resizeObserved();
  expect(rect().toJSON()).toMatchObject({ x: 450, y: 240, width: 100, height: 80 });
  start(); pointer(window, 'pointermove', -1000, -1000); pointer(window, 'pointerup', -1000, -1000);
  naturalWidth = 300; naturalHeight = 200; resizeObserved();
  expect(rect().left).toBe(200); expect(rect().top).toBe(100);
});

it('switches corner grips during dragging and fixes the chosen corner throughout resizing', () => {
  render({ resizeMode: 'corner' });
  const grip = () => host.querySelector<HTMLElement>('[data-resize]')!;
  expect(grip().dataset.fromLeft).toBe('false');
  start(); pointer(window, 'pointermove', 630, 210);
  expect(grip().dataset.fromLeft).toBe('true');
  pointer(window, 'pointerup', 630, 210);
  pointer(grip(), 'pointerdown', 620, 360);
  pointer(window, 'pointermove', 600, 390);
  expect(rect().toJSON()).toMatchObject({ x: 600, y: 200, width: 220, height: 190 });
  expect(node().style.transition).toBe('none');
  pointer(window, 'pointermove', -200, 1200);
  expect(rect().toJSON()).toMatchObject({ x: 20, y: 200, width: 800, height: 600 });
  expect(grip().dataset.fromLeft).toBe('true');
  pointer(window, 'pointerup', -200, 1200);
  expect(rect().toJSON()).toMatchObject(area);
  expect(grip().dataset.fromLeft).toBe('false');
  expect(node().style.transition).toBe('');
});

it('resizes a left-side panel from the bottom right without moving its top left', () => {
  render({ resizeMode: 'corner' });
  pointer(host.querySelector('[data-resize]')!, 'pointerdown', 600, 360);
  pointer(window, 'pointermove', 640, 390);
  expect(rect().toJSON()).toMatchObject({ x: 400, y: 200, width: 240, height: 190 });
});

it('fits restored geometry and responds to smaller area bounds', () => {
  render({ initial: { x: -300, y: 900, width: 2000, height: 1800 } });
  expect(rect().toJSON()).toMatchObject(area);
  render({}, { x: 300, y: 180, width: 300, height: 200 });
  expect(rect().toJSON()).toMatchObject({ x: 300, y: 180, width: 300, height: 200 });
});

it('starts an interrupted animation from its displayed rectangle', () => {
  render();
  vi.spyOn(node(), 'getBoundingClientRect').mockReturnValueOnce(DOMRect.fromRect({ x: 450, y: 250, width: 200, height: 160 }));
  pointer(handle(), 'pointerdown', 460, 260);
  pointer(window, 'pointermove', 470, 270);
  expect(rect().left).toBe(460); expect(rect().top).toBe(260);
});

it('ignores interactive controls, secondary buttons and unrelated pointers', () => {
  render();
  pointer(host.querySelector('button')!, 'pointerdown', 410, 210);
  pointer(window, 'pointermove', 500, 300);
  expect(rect().left).toBe(400);
  pointer(handle(), 'pointerdown', 410, 210, false, 1, 2);
  pointer(window, 'pointermove', 500, 300);
  expect(rect().left).toBe(400);
  start(); pointer(window, 'pointermove', 500, 300, false, 2);
  pointer(window, 'pointerup', 500, 300, false, 2);
  expect(commit).not.toHaveBeenCalled();
  pointer(window, 'pointermove', 500, 300);
  expect(rect().left).toBe(490);
});

it.each(['pointercancel', 'lostpointercapture', 'blur'])('settles and removes listeners on %s', event => {
  render(); start(); pointer(window, 'pointermove', 518, 329, true);
  if (event === 'blur') act(() => window.dispatchEvent(new Event('blur')));
  else pointer(event === 'lostpointercapture' ? handle() : window, event, 518, 329);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(node().style.transition).toBe('');
  const before = rect().toJSON();
  pointer(window, 'pointermove', 900, 600);
  expect(rect().toJSON()).toEqual(before);
});

it('disconnects observers and commits an interrupted gesture on unmount', () => {
  render({ resizable: false }); start();
  expect(observers.size).toBe(1);
  act(() => root.render(null));
  expect(observers.size).toBe(0); expect(commit).toHaveBeenCalledOnce();
  const calls = clearGuides.mock.calls.length;
  pointer(window, 'pointermove', 900, 600);
  expect(clearGuides).toHaveBeenCalledTimes(calls);
});

it('retains geometry when a preview target replaces its DOM node', () => {
  render(); start(); pointer(window, 'pointermove', 610, 410); pointer(window, 'pointerup', 610, 410);
  const previous = rect().toJSON();
  render({ nodeKey: 'replacement' });
  expect(rect().toJSON()).toEqual(previous);
  expect(node().style.visibility).toBe('visible');
});
