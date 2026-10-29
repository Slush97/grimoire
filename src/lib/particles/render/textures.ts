// Ported from ValveResourceFormat (MIT): Renderer/Renderer/Materials/MaterialLoader.cs (LoadTexture's
// colour space, wrap and filter choices, and GenerateGradientTexture) and
// Renderer/Utils/ImageFormatExtensions.cs (HasSrgbVariant).
//
// The renderer never decodes texture pixels itself. A ParticleTextureSource hands it each texture's
// header (from readParticleTextureInfo) and its decoded image, and the renderer makes its own
// THREE.Texture over that image with the sampling VRF would give it.

import * as THREE from 'three';
import { VTexFlags, VTexFormat, type ParticleSheet, type ParticleTextureInfo } from './sheet';

/** One texture a renderer asked for: its header, and its decoded image once there is one. */
export interface ParticleTextureEntry {
  info: ParticleTextureInfo;
  /**
   * The decoded texels, or null until they arrive. Only its `source` (the image) is used: the
   * renderer samples it through textures of its own, so its colour space, wrap and filter settings
   * do not matter. The image must hold the stored texel values: top row first, alpha not
   * premultiplied, and no colour management applied. When its `mipmaps` hold the texture's own
   * mip chain (every level, largest first, the first being the image), those are sampled as VRF
   * samples them; otherwise the levels are built from the image.
   */
  texture: THREE.Texture | null;
}

/** Hands the renderer the particle textures it names (`materials/.../x.vtex`). */
export interface ParticleTextureSource {
  /** The texture at `vtexPath`, or null while nothing is known of it (it is asked for again every update). */
  get(vtexPath: string): ParticleTextureEntry | null;
}

/** The formats whose GL storage has an sRGB variant (ImageFormatExtensions.HasSrgbVariant over MaterialLoader.GetTextureFormat). */
const SRGB_VARIANT_FORMATS: ReadonlySet<number> = new Set([
  VTexFormat.RGBA8888,
  VTexFormat.BGRA8888,
  VTexFormat.DXT1,
  VTexFormat.DXT5,
  VTexFormat.BC7,
  VTexFormat.ETC2,
  VTexFormat.ETC2_EAC,
]);

/** PNG, JPEG and WebP payloads, which VRF decodes to a bitmap and uploads as stored. */
const RAW_IMAGE_FORMATS: ReadonlySet<number> = new Set([
  VTexFormat.JPEG_RGBA8888,
  VTexFormat.PNG_RGBA8888,
  VTexFormat.JPEG_DXT5,
  VTexFormat.PNG_DXT5,
  VTexFormat.WEBP_RGBA8888,
  VTexFormat.WEBP_DXT5,
]);

/**
 * Whether a texture is decoded from sRGB when it is sampled. VRF asks for an sRGB read per use (a
 * renderer's colour layers ask for one, data such as motion vectors or a refraction offset does
 * not), and the texture is then stored sRGB only when its format has an sRGB variant. A raw image
 * payload is always uploaded as stored. The texture's own flags play no part.
 */
export function decodesSrgb(info: Pick<ParticleTextureInfo, 'format'>, srgbRead: boolean): boolean {
  return srgbRead && !RAW_IMAGE_FORMATS.has(info.format) && SRGB_VARIANT_FORMATS.has(info.format);
}

/** How a texture wraps outside 0 to 1 on one axis. */
export type ParticleTextureWrap = 'repeat' | 'clamp' | 'border';

/**
 * A texture as a renderer samples it: one image, read in one colour space with VRF's sampling.
 * The texture may still be loading, in which case `texture` is null and the renderer draws nothing.
 */
export class ParticleRenderTexture {
  readonly name: string;
  private readonly srgbRead: boolean;
  private readonly source: ParticleTextureSource | null;
  private entry: ParticleTextureEntry | null = null;
  private sharedImage: THREE.Texture["source"] | null = null;

  /** The texture to sample, configured for this use, or null while the image is missing. */
  texture: THREE.Texture | null = null;

  /** Whether the layer drawing this clamps its uvs, which samples through a clamp-to-edge sampler. */
  readonly clampSampler: boolean;

  constructor(
    name: string,
    srgbRead: boolean,
    clampSampler: boolean,
    source: ParticleTextureSource | null,
    generated?: THREE.Texture,
    info?: ParticleTextureInfo,
  ) {
    this.name = name;
    this.srgbRead = srgbRead;
    this.clampSampler = clampSampler;
    this.source = source;

    if (generated && info) {
      this.entry = { info, texture: generated };
      this.texture = generated;
    } else {
      // The header is asked for at once: the sheet times the system's sequences before it starts
      this.entry = source?.get(name) ?? null;
    }
  }

  get info(): ParticleTextureInfo | null {
    return this.entry?.info ?? null;
  }

  /** Texture.SpriteSheetData: the sheet the texture carries, or null. */
  get sheet(): ParticleSheet | null {
    return this.entry?.info.sheet ?? null;
  }

  get width(): number {
    return this.entry?.info.width ?? 0;
  }

  get height(): number {
    return this.entry?.info.height ?? 0;
  }

  /** The wrap the texture's flags suggest on each axis, as LoadTexture sets it. */
  get wrap(): [ParticleTextureWrap, ParticleTextureWrap] {
    const flags = this.entry?.info.flags ?? 0;
    return [flags & VTexFlags.SUGGEST_CLAMPS ? 'border' : 'repeat', flags & VTexFlags.SUGGEST_CLAMPT ? 'border' : 'repeat'];
  }

  /** Asks the source again while the texture is incomplete. Returns whether `texture` changed. */
  resolve(maxAnisotropy: number): boolean {
    if (this.source === null) {
      return false;
    }

    if (this.entry === null || this.entry.texture === null) {
      this.entry = this.source.get(this.name);
    }

    const image = this.entry?.texture?.source ?? null;

    if (image === null || image === this.sharedImage) {
      return false;
    }

    this.sharedImage = image;
    this.texture?.dispose();
    this.texture = this.createTexture(image, maxAnisotropy);
    return true;
  }

  private createTexture(image: THREE.Texture["source"], maxAnisotropy: number): THREE.Texture {
    const info = this.entry!.info;
    const texture = new THREE.Texture();
    texture.source = image;
    texture.name = this.name;
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    texture.colorSpace = decodesSrgb(info, this.srgbRead) ? THREE.SRGBColorSpace : THREE.NoColorSpace;

    const [wrapS, wrapT] = this.wrap;
    const clamp = this.clampSampler;
    // ClampToBorder has no WebGL equivalent. The border is black and transparent; the shader takes
    // texels outside the edge to it (see the layer border uniforms), and clamps to the edge here.
    texture.wrapS = clamp || wrapS === 'border' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.wrapT = clamp || wrapT === 'border' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;

    if (RAW_IMAGE_FORMATS.has(info.format)) {
      // A decoded bitmap is uploaded with one level and no filtering set, so it reads its texels nearest
      texture.generateMipmaps = false;
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.LinearFilter;
    } else if (info.mipLevels <= 1) {
      // A texture stored without mips is sampled at its one level, whatever the filter asks; the
      // filter stays mipmapped so a clamping layer's anisotropy still applies
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
    } else {
      // The stored chain when the source supplies it: rebuilding it from the top level filters the
      // smaller levels differently, which shows wherever a noise texture is minified
      const mipmaps = this.entry!.texture?.mipmaps ?? [];
      texture.mipmaps = mipmaps;
      texture.generateMipmaps = mipmaps.length === 0;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
    }

    // The clamp sampler of a layer that clamps its uvs filters anisotropically
    if (clamp && maxAnisotropy >= 4) {
      texture.anisotropy = maxAnisotropy;
    }

    texture.needsUpdate = true;
    return texture;
  }

  dispose(): void {
    if (this.source !== null) {
      this.texture?.dispose();
    }

    this.texture = null;
  }
}

/** One stop of an m_Gradient ramp: its position, and its colour in bytes. */
export interface GradientStop {
  position: number;
  color: [number, number, number];
}

const GRADIENT_WIDTH = 64;
const MAX_INSERTION_SORT_STOPS = 32;

/**
 * The 64 texel ramp MaterialLoader.GenerateGradientTexture synthesizes for a gradient layer, as RGBA
 * bytes. Its storage is sRGB, so a sample lands in linear space like any other colour layer.
 */
export function gradientTexels(stops: readonly GradientStop[]): Uint8Array {
  const sorted = stops.map((stop) => ({ position: Math.min(Math.max(Math.fround(stop.position), 0), 1), color: stop.color }));

  // Both orderings are stable, so stops sharing a position keep their authored order
  if (sorted.length <= MAX_INSERTION_SORT_STOPS) {
    for (let i = 1; i < sorted.length; i++) {
      const stop = sorted[i];
      let j = i - 1;

      while (j >= 0 && sorted[j].position > stop.position) {
        sorted[j + 1] = sorted[j];
        j--;
      }

      sorted[j + 1] = stop;
    }
  } else {
    sorted.sort((a, b) => a.position - b.position);
  }

  const texels = new Uint8Array(GRADIENT_WIDTH * 4);

  for (let x = 0; x < GRADIENT_WIDTH; x++) {
    // Texel x samples x / 64, so the ramp never reaches its position of 1
    const color = sampleGradient(sorted, Math.fround(x / GRADIENT_WIDTH));
    texels.set([color[0], color[1], color[2], 255], x * 4);
  }

  return texels;
}

/** A gradient layer's texture: the ramp, wrapping unless the layer clamps. */
export function createGradientTexture(stops: readonly GradientStop[], clamp: boolean, maxAnisotropy = 16): THREE.DataTexture {
  const texture = new THREE.DataTexture(gradientTexels(stops), GRADIENT_WIDTH, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;

  // A clamping layer is sampled through VRF's clamp sampler, which filters with mips (of which the
  // ramp has one) and anisotropically; otherwise the ramp's own linear filter applies
  if (clamp) {
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = maxAnisotropy >= 4 ? maxAnisotropy : 1;
  } else {
    texture.minFilter = THREE.LinearFilter;
  }
  texture.name = 'GeneratedGradient';
  texture.needsUpdate = true;
  return texture;
}

/**
 * The colour of sorted stops at a position: the first stop's before it, the last stop's after it,
 * and otherwise each channel interpolated between the two bracketing stops and truncated. Without
 * stops the ramp is white.
 */
function sampleGradient(stops: readonly GradientStop[], position: number): [number, number, number] {
  if (stops.length === 0) {
    return [255, 255, 255];
  }

  // A bisection that ends at the first stop sitting exactly on the position, and otherwise at the
  // last stop below it, or -1 when the position precedes every stop
  let low = -1;
  let first = 0;
  let last = stops.length - 1;

  while (first <= last) {
    const middle = (first + last) >> 1;
    const stopPosition = stops[middle].position;

    if (stopPosition === position) {
      low = middle;
      break;
    }

    if (stopPosition < position) {
      low = middle;
      first = middle + 1;
    } else {
      last = middle - 1;
    }
  }

  if (low === -1) {
    return stops[0].color;
  }

  if (low === stops.length - 1) {
    return stops[low].color;
  }

  const lower = stops[low];
  const upper = stops[low + 1];
  const span = Math.fround(upper.position - lower.position);

  if (span < Math.fround(1e-5)) {
    return lower.color;
  }

  const fraction = Math.fround(Math.fround(position - lower.position) / span);
  const channel = (i: number) => Math.trunc(Math.fround(Math.fround((upper.color[i] - lower.color[i]) * fraction) + lower.color[i])) & 0xff;
  return [channel(0), channel(1), channel(2)];
}
