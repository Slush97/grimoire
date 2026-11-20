import { useLayoutEffect } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PreparedPropCache, propThumbnailSource, preparedPropCache, readPropYaw, savePropYaw } from './soulModel';
import { TiledRenderer } from './SoulContainerCanvas';
import { createSoulRegistry, SoulRegistryContext } from './soulRegistry';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => vi.unstubAllGlobals());

const rect = (top: number) => ({ left: 0, right: 100, top, bottom: top + 100, width: 100, height: 100 });

describe('shared soul canvas scheduling', () => {
  it('sleeps for thumbnails, spins only hovered models, and stops after fading or entering manual mode', async () => {
    const events = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    vi.stubGlobal('window', events);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
    const registry = createSoulRegistry();
    const paneRef = { current: { getBoundingClientRect: () => rect(0) } as HTMLElement };
    const invalidate = vi.fn();
    const render = vi.fn();
    function Scene() {
      const set = useThree(state => state.set);
      const gl = useThree(state => state.gl);
      useLayoutEffect(() => {
        set({ invalidate });
        Object.assign(gl.domElement, { getBoundingClientRect: () => rect(0) });
        gl.render = render;
        gl.setRenderTarget = vi.fn();
      }, [gl, set]);
      return <SoulRegistryContext value={registry}><TiledRenderer paneRef={paneRef} /></SoulRegistryContext>;
    }
    const renderer = await ReactThreeTestRenderer.create(<Scene />);
    const model = new THREE.Group();
    registry.register('prop', { getBoundingClientRect: () => rect(0) } as HTMLElement);
    registry.setRoot('prop', model);
    invalidate.mockClear();
    await renderer.advanceFrames(1, 30);
    expect(render).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    registry.hover('prop', true);
    await renderer.advanceFrames(1, 30);
    expect(model.rotation.y).toBe(0);
    await renderer.advanceFrames(1, 0.1);
    expect(model.rotation.y).toBeCloseTo(0.05);
    expect(model.parent).toBeNull();
    registry.tiles.get('prop')!.manual = true;
    invalidate.mockClear();
    await renderer.advanceFrames(1, 0.1);
    expect(model.rotation.y).toBeCloseTo(0.05);
    expect(invalidate).not.toHaveBeenCalled();
    render.mockClear();
    registry.hover('prop', false);
    await renderer.advanceFrames(1, 0.1);
    expect(render).not.toHaveBeenCalled();
    await renderer.unmount();
  });

  it('restores manual angles across resource releases and resets auto-spin to the saved view', () => {
    const registry = createSoulRegistry();
    registry.register('prop', {} as HTMLElement);
    const tile = registry.tiles.get('prop')!;
    tile.savedYaw = 0.75;
    const root = new THREE.Group(); registry.setRoot('prop', root);
    expect(root.rotation.y).toBe(0.75);
    tile.manual = true; root.rotation.y = 2;
    registry.setRoot('prop', null);
    const next = new THREE.Group(); registry.setRoot('prop', next);
    registry.hover('prop', true); expect(next.rotation.y).toBe(2);
    tile.manual = false; registry.hover('prop', false); registry.hover('prop', true);
    expect(next.rotation.y).toBe(0.75);
  });

  it('captures the card aspect and rejects queued captures when the category unloads', async () => {
    const registry = createSoulRegistry();
    registry.register('prop', {} as HTMLElement);
    const landscape = registry.capture('prop', 1);
    expect(registry.captures[0]).toMatchObject({ width: 1024, height: 576 });
    registry.tiles.get('prop')!.portrait = true;
    const portrait = registry.capture('prop', 2);
    expect(registry.captures[1]).toMatchObject({ width: 768, height: 1024 });
    registry.unregister('prop');
    await expect(landscape).rejects.toThrow('Preview unloaded');
    await expect(portrait).rejects.toThrow('Preview unloaded');
    expect(registry.captures).toEqual([]);
  });
});

describe('prepared General preview cache', () => {
  const scene = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  it('deduplicates loads and leases independent transforms while sharing cache-owned resources', async () => {
    const cache = new PreparedPropCache(); const template = scene(); const load = vi.fn(async () => template);
    const disposed = vi.spyOn(template.geometry, 'dispose');
    const [first, second] = await Promise.all([cache.acquire('model', load), cache.acquire('model', load)]);
    expect(load).toHaveBeenCalledOnce(); expect(first.root).not.toBe(second.root);
    first.root.rotation.y = 1; expect(second.root.rotation.y).toBe(0);
    first.release(); first.release(); expect(disposed).not.toHaveBeenCalled();
    cache.clear(); expect(disposed).not.toHaveBeenCalled();
    second.release(); expect(disposed).toHaveBeenCalledOnce();
  });
  it('reuses released models on later visits and evicts the least recently used idle model', async () => {
    const cache = new PreparedPropCache(1); const loadA = vi.fn(async () => scene());
    const first = await cache.acquire('a', loadA); first.release();
    const revisit = await cache.acquire('a', loadA); revisit.release(); expect(loadA).toHaveBeenCalledOnce();
    const b = await cache.acquire('b', async () => scene()); b.release();
    const reload = await cache.acquire('a', loadA); expect(loadA).toHaveBeenCalledTimes(2);
    reload.release(); cache.clear();
  });
  it('enforces the idle memory budget and retries failed loads', async () => {
    const cache = new PreparedPropCache(4, 0); const template = scene(); const disposed = vi.spyOn(template.geometry, 'dispose');
    const lease = await cache.acquire('large', async () => template); expect(disposed).not.toHaveBeenCalled();
    lease.release(); expect(disposed).toHaveBeenCalledOnce();
    await expect(cache.acquire('failure', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    const retry = await cache.acquire('failure', async () => scene()); retry.release();
  });
  it('measures geometry views without counting the entire downloaded GLB backing buffer', async () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(new ArrayBuffer(1024 * 1024), 0, 9), 3));
    const load = vi.fn(async () => new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
    const cache = new PreparedPropCache(4, 1024);
    const first = await cache.acquire('view', load); first.release();
    const second = await cache.acquire('view', load); expect(load).toHaveBeenCalledOnce();
    second.release(); cache.clear();
  });
  it('clearing an active entry cannot dispose its replacement or reuse stale data', async () => {
    const cache = new PreparedPropCache(); const old = scene(); const fresh = scene();
    const oldDisposed = vi.spyOn(old.geometry, 'dispose'); const freshDisposed = vi.spyOn(fresh.geometry, 'dispose');
    const first = await cache.acquire('same', async () => old); cache.clear();
    const second = await cache.acquire('same', async () => fresh);
    first.release(); expect(oldDisposed).toHaveBeenCalledOnce(); expect(freshDisposed).not.toHaveBeenCalled();
    second.release(); cache.clear(); expect(freshDisposed).toHaveBeenCalledOnce();
  });
});

it('persists independent per-slot angles outside the model cache', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  savePropYaw('same-vpk-hidden-king', 1.2);
  savePropYaw('same-vpk-archmother', -0.5);
  preparedPropCache.clear();
  expect(readPropYaw('same-vpk-hidden-king')).toBeCloseTo(1.2);
  expect(readPropYaw('same-vpk-archmother')).toBeCloseTo(2 * Math.PI - 0.5);
});

it('keeps the captured model image when the disk cache rejects portrait PNGs', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const png = 'data:image/png;base64,model-preview';
    const url = vi.fn((mtime: number) => 'preview.png?v=' + mtime);
    expect(await propThumbnailSource(png, async () => { throw new Error('Invalid preview PNG'); }, url)).toBe(png);
    expect(url).not.toHaveBeenCalled();
    expect(await propThumbnailSource(png, async () => ({ mtimeMs: null }), url)).toBe(png);
    expect(await propThumbnailSource(png, async () => ({ mtimeMs: 42 }), url)).toBe('preview.png?v=42');
  } finally { warning.mockRestore(); }
});
