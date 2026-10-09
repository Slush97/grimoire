import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GLTF, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loaderMock = vi.hoisted(() => ({
  textureLoaders: [] as unknown[],
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
    private plugins: ((parser: GLTFParser) => { name: string })[] = [];

    register(callback: (parser: GLTFParser) => { name: string }): this {
      this.plugins.push(callback);
      return this;
    }

    // Mirrors GLTFLoader: the parser picks ImageBitmapLoader, then plugins run.
    private runParser(): void {
      const parser = {
        options: { manager: undefined, crossOrigin: 'anonymous', requestHeader: {} },
        textureLoader: 'image-bitmap-loader',
      } as unknown as GLTFParser;
      this.plugins.forEach((plugin) => plugin(parser));
      loaderMock.textureLoaders.push(parser.textureLoader);
    }

    async parseAsync(_buffer: ArrayBuffer, _path: string): Promise<GLTF> {
      this.runParser();
      return fakeGltf();
    }
  },
}));

vi.mock('./source2NprMaterial', () => ({
  resolveMorphicTextures: source2Mock.resolveMorphicTextures,
}));

describe('loadGltfPreview texture decoding', () => {
  beforeEach(() => {
    loaderMock.textureLoaders = [];
    source2Mock.resolveMorphicTextures.mockReset();
    source2Mock.resolveMorphicTextures.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(4))));
    return () => vi.unstubAllGlobals();
  });

  it('decodes with <img> textures by default, per parser', async () => {
    const { loadGltfPreview, parseGltfPreview } = await import('./loadGltfPreview');
    const loaded = await loadGltfPreview('grimoire-hero://m/test/model.glb?v=1');
    const parsed = await parseGltfPreview(new ArrayBuffer(4));

    expect(loaderMock.textureLoaders).toHaveLength(2);
    loaderMock.textureLoaders.forEach((loader) =>
      expect(loader).toBeInstanceOf(THREE.TextureLoader)
    );
    expect(source2Mock.resolveMorphicTextures).toHaveBeenCalledWith(loaded);
    expect(source2Mock.resolveMorphicTextures).toHaveBeenCalledWith(parsed);
  });

  it('keeps the ImageBitmap loader when imageBitmaps is set', async () => {
    const { loadGltfPreview } = await import('./loadGltfPreview');
    const gltf = await loadGltfPreview('grimoire-hero://m/test/model.glb?v=1', {
      imageBitmaps: true,
    });

    expect(loaderMock.textureLoaders).toEqual(['image-bitmap-loader']);
    expect(source2Mock.resolveMorphicTextures).toHaveBeenCalledWith(gltf);
  });

  it('rejects a failed GLB request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const { loadGltfPreview } = await import('./loadGltfPreview');

    await expect(loadGltfPreview('grimoire-hero://m/missing/model.glb')).rejects.toThrow('404');
    expect(loaderMock.textureLoaders).toEqual([]);
  });
});

describe('texture disposal', () => {
  it('lists every texture a material holds', async () => {
    const { materialTextures } = await import('./loadGltfPreview');
    const map = new THREE.Texture();
    const sheen = new THREE.Texture();
    const material = new THREE.MeshPhysicalMaterial({ map, sheenColorMap: sheen });

    expect(materialTextures(material)).toEqual(expect.arrayContaining([map, sheen]));
    expect(materialTextures(material)).toHaveLength(2);
  });

  it('closes an ImageBitmap-backed texture when disposing it', async () => {
    const { disposeTexture } = await import('./loadGltfPreview');
    const close = vi.fn();
    class FakeImageBitmap {
      width = 4;
      height = 4;
      close = close;
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    try {
      const texture = new THREE.Texture(new FakeImageBitmap() as unknown as ImageBitmap);
      const onDispose = vi.fn();
      texture.addEventListener('dispose', onDispose);

      disposeTexture(texture);

      expect(onDispose).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
