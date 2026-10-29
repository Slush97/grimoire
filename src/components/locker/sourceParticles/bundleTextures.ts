import * as THREE from 'three';
import type { ParticleBundle } from '../../../lib/particles/host/bundle';
import type { ParticleTextureInfo } from '../../../lib/particles/render/sheet';

/** What the particle renderer reads per texture (ParticleTextureEntry): its header and, once loaded, its image. */
export interface BundleTextureEntry {
  info: ParticleTextureInfo;
  texture: THREE.Texture | null;
}

/**
 * The particle renderer's texture source (ParticleTextureSource) over a hero particle bundle. Images
 * load on first use as stored: no premultiplied alpha and no colour conversion, top row first, with
 * the stored mip chain when the bundle has one.
 */
export class BundleTextureSource {
  private readonly bundle: ParticleBundle;
  private readonly baseUrl: string;
  private readonly entries = new Map<string, BundleTextureEntry>();
  private disposed = false;

  constructor(bundle: ParticleBundle, baseUrl: string) {
    this.bundle = bundle;
    this.baseUrl = baseUrl;
  }

  get(vtexPath: string): BundleTextureEntry | null {
    const key = vtexPath.replace(/_c$/, '').replace(/\\/g, '/');
    const existing = this.entries.get(key);

    if (existing) {
      return existing;
    }

    const texture = this.bundle.textures[key];

    if (!texture) {
      return null;
    }

    const entry: BundleTextureEntry = { info: texture.info, texture: null };
    this.entries.set(key, entry);
    // The stored mip chain when the bundle has it (its first level is the top image); the renderer
    // generates the levels from the top one otherwise, which is also the fallback when a stored
    // level cannot load, so one missing file costs this texture its mips, never its image
    const mips = texture.mips && texture.mips.length > 0 ? texture.mips : null;
    const loadAll = (files: readonly string[]) => Promise.all(files.map((file) => this.load(`${this.baseUrl}${file}`)));
    const loaded = mips ? loadAll(mips).catch(() => loadAll([texture.file])) : loadAll([texture.file]);
    loaded.then((bitmaps) => {
      if (this.disposed) {
        for (const bitmap of bitmaps) bitmap.close();
        return;
      }

      const image = new THREE.Texture(bitmaps[0]);
      image.flipY = false;
      // three.js uploads image mipmaps of any kind, though its typings name only canvases
      if (bitmaps.length > 1) image.mipmaps = bitmaps as unknown as HTMLCanvasElement[];
      image.needsUpdate = true;
      entry.texture = image;
    }, () => {
      // An image that cannot load leaves the entry without a texture, which the renderer skips
    });
    return entry;
  }

  /** One PNG as stored: no premultiplied alpha, no colour conversion, top row first. */
  private async load(url: string): Promise<ImageBitmap> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return createImageBitmap(await response.blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }

  dispose(): void {
    this.disposed = true;

    for (const entry of this.entries.values()) {
      entry.texture?.dispose();
      const bitmaps = entry.texture ? [entry.texture.image as ImageBitmap, ...((entry.texture.mipmaps ?? []) as unknown as ImageBitmap[])] : [];
      for (const bitmap of new Set(bitmaps)) bitmap?.close?.();
    }

    this.entries.clear();
  }
}
