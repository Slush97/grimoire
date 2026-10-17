import { useLayoutEffect } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TiledRenderer } from './SoulContainerCanvas';
import { createSoulRegistry, SoulRegistryContext } from './soulRegistry';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => vi.unstubAllGlobals());

const rect = (top: number) => ({ left: 0, right: 100, top, bottom: top + 100, width: 100, height: 100 });

describe('shared soul canvas scheduling', () => {
  it('sleeps without visible models, wakes on changes, and keeps visible rotation continuous', async () => {
    const events = new EventTarget();
    const removeListener = vi.spyOn(events, 'removeEventListener');
    vi.stubGlobal('window', events);
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = disconnect;
    });
    const registry = createSoulRegistry();
    const paneRef = { current: { getBoundingClientRect: () => rect(0) } as HTMLElement };
    const invalidate = vi.fn();
    const render = vi.fn();
    const clear = vi.fn();
    function Scene() {
      const set = useThree((state) => state.set);
      const gl = useThree((state) => state.gl);
      useLayoutEffect(() => {
        set({ invalidate });
        Object.assign(gl.domElement, { getBoundingClientRect: () => rect(0) });
        gl.render = render;
        gl.clear = clear;
      }, [gl, set]);
      return <SoulRegistryContext value={registry}><TiledRenderer paneRef={paneRef} /></SoulRegistryContext>;
    }
    const renderer = await ReactThreeTestRenderer.create(<Scene />);
    disconnect.mockClear();
    removeListener.mockClear();
    invalidate.mockClear();
    await renderer.advanceFrames(1, 1 / 60);
    expect(clear).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    let top = 200;
    registry.register('soul', { getBoundingClientRect: () => rect(top) } as HTMLElement);
    const model = new THREE.Group();
    registry.setRoot('soul', model);
    expect(invalidate).toHaveBeenCalledTimes(2);
    invalidate.mockClear();
    await renderer.advanceFrames(1, 1 / 60);
    expect(render).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    top = 0;
    events.dispatchEvent(new Event('scroll'));
    expect(invalidate).toHaveBeenCalledOnce();
    invalidate.mockClear();
    await renderer.advanceFrames(1, 30);
    expect(model.rotation.y).toBe(0); // no jump by the time spent asleep
    expect(render).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
    await renderer.advanceFrames(1, 0.2);
    expect(model.rotation.y).toBeCloseTo(0.1);
    expect(model.parent).toBeNull(); // each model leaves the shared holder after drawing

    registry.unregister('soul');
    invalidate.mockClear();
    await renderer.advanceFrames(1, 1 / 60);
    expect(invalidate).not.toHaveBeenCalled();
    await renderer.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls.map(([type]) => type)).toEqual(['scroll', 'resize']);
    registry.setRoot('soul', model);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
