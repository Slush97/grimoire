import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loaderMock = vi.hoisted(() => ({
  loadCreateImageBitmapValues: [] as unknown[],
  parseCreateImageBitmapValues: [] as unknown[],
}));

const source2Mock = vi.hoisted(() => ({
  resolveMorphicTextures: vi.fn(),
}));

function fakeGltf(): GLTF {
  return {
    scene: {},
    scenes: [],
    cameras: [],
    animations: [],
    asset: { version: '2.0' },
    parser: {},
    userData: {},
  } as unknown as GLTF;
}

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (gltf: GLTF) => void): void {
      loaderMock.loadCreateImageBitmapValues.push(globalThis.createImageBitmap);
      onLoad(fakeGltf());
    }

    parse(_buffer: ArrayBuffer, _path: string, onLoad: (gltf: GLTF) => void): void {
      loaderMock.parseCreateImageBitmapValues.push(globalThis.createImageBitmap);
      onLoad(fakeGltf());
    }
  },
}));

vi.mock('./source2NprMaterial', () => ({
  resolveMorphicTextures: source2Mock.resolveMorphicTextures,
}));

function setCreateImageBitmap(value: Window['createImageBitmap'] | undefined): void {
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    writable: true,
    value,
  });
}

describe('loadGltfPreview createImageBitmap guard', () => {
  beforeEach(() => {
    loaderMock.loadCreateImageBitmapValues = [];
    loaderMock.parseCreateImageBitmapValues = [];
    source2Mock.resolveMorphicTextures.mockReset();
    source2Mock.resolveMorphicTextures.mockResolvedValue(undefined);
  });

  it('suppresses createImageBitmap while parsing in-memory GLB bytes and restores it', async () => {
    const sentinel = (() => Promise.resolve({})) as unknown as Window['createImageBitmap'];
    setCreateImageBitmap(sentinel);

    const { parseGltfPreview } = await import('./loadGltfPreview');
    const gltf = await parseGltfPreview(new ArrayBuffer(4));

    expect(loaderMock.parseCreateImageBitmapValues).toEqual([undefined]);
    expect(globalThis.createImageBitmap).toBe(sentinel);
    expect(source2Mock.resolveMorphicTextures).toHaveBeenCalledWith(gltf);
  });

  it('removes createImageBitmap after URL loads when it was originally absent', async () => {
    delete (globalThis as { createImageBitmap?: Window['createImageBitmap'] }).createImageBitmap;

    const { loadGltfPreview } = await import('./loadGltfPreview');
    const gltf = await loadGltfPreview('grimoire-hero://m/test/model.glb?v=1');

    expect(loaderMock.loadCreateImageBitmapValues).toEqual([undefined]);
    expect('createImageBitmap' in globalThis).toBe(false);
    expect(source2Mock.resolveMorphicTextures).toHaveBeenCalledWith(gltf);
  });
});
