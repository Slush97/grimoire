// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/ParticleTextureLayer.cs.
//
// One entry of m_vecTexturesInput: a texture plus how it folds into the layers below it.

import type { KVObject } from '../kv';
import { getString, isCollection } from '../kv';
import { degreesToRadians } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ParticleTextureLayerBlendType, SpriteCardPerParticleScale, SpriteCardTextureChannel, SpriteCardTextureType } from './enums';
import type { ParticleSheetCache } from './sheetCache';
import { ParticleRenderTexture, createGradientTexture, type GradientStop, type ParticleTextureSource } from './textures';

/** The most layers any spritecard renderer composites. */
export const MAX_LAYERS = 5;

/** The bit of the packed per particle modes that randomizes the layer's offsets. */
const RANDOMIZE_OFFSETS_BIT = 28;

const ONE = new LiteralNumberProvider(1);
const ZERO = new LiteralNumberProvider(0);

/** The per-layer uniforms of the spritecard shader, filled by `bindTextureLayers`. */
export interface TextureLayerUniforms {
  uLayerCount: { value: number };
  uLayerChannels: { value: number[] };
  uLayerBlendMode: { value: number[] };
  uLayerBlend: { value: number[] };
  uLayerEffectMode: { value: number[] };
  uLayerDistortion: { value: number[] };
  uLayerZoomScale: { value: number[] };
  uLayerUvScaleOffset: { value: { x: number; y: number; z: number; w: number }[] };
  uLayerUvRotation: { value: number[] };
  uLayerSheet: { value: { x: number; y: number }[] };
  uLayerPerParticleModes: { value: number[] };
  uLayerLookup: { value: boolean[] };
  uLayerBorder: { value: { x: number; y: number }[] };
  uLayerAnisotropy: { value: number[] };
  uFrameZoom: { value: { x: number; y: number } };
  uAnyLayerHasSheet: { value: boolean };
}

export class ParticleTextureLayer {
  texture: ParticleRenderTexture;
  channels: number = SpriteCardTextureChannel.SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA;
  effectMode: number = SpriteCardTextureType.SPRITECARD_TEXTURE_DIFFUSE;
  blendMode: number = ParticleTextureLayerBlendType.SPRITECARD_TEXTURE_BLEND_MULTIPLY;
  blend: NumberProvider = ONE;

  /** m_flFinalTextureScaleU/V: how many times this layer's texture tiles across the card. */
  scaleU: NumberProvider = ONE;
  scaleV: NumberProvider = ONE;

  /** m_flFinalTextureOffsetU/V: where this layer's texture starts within the card. */
  offsetU: NumberProvider = ZERO;
  offsetV: NumberProvider = ZERO;

  /** m_flDistortion: how far a distortion layer pushes the layer beneath it. */
  distortion: NumberProvider = ZERO;

  /** m_flZoomScale: how fast a zoom layer sweeps between its two magnifications. */
  zoomScale: NumberProvider = ZERO;

  /**
   * m_flFinalTextureUVRotation: how far this layer's texture turns about the card centre, in
   * degrees. A texture with a sheet does not turn; the value scales how fast it plays instead.
   */
  rotation: NumberProvider = ZERO;

  /** m_bClampUVs: whether this layer is sampled with its edge texels held outside its range instead of repeating. */
  clampUVs = false;

  /** m_bRandomizeOffsets: whether each particle shifts this layer by a random amount of its own. */
  randomizeOffsets = false;

  perParticleScale: number = SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
  perParticleOffsetU: number = SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
  perParticleOffsetV: number = SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
  perParticleRotation: number = SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
  perParticleZoom: number = SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
  perParticleDistortion: number = SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
  perParticleBlend: number = SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;

  constructor(texture: ParticleRenderTexture) {
    this.texture = texture;
  }

  /**
   * The per particle modes packed four bits each in the order the shader keys them (scale, offset u,
   * offset v, rotation, zoom, distortion, blend), with the randomized offsets flag above them.
   */
  packPerParticleModes(): number {
    let packed =
      this.perParticleScale |
      (this.perParticleOffsetU << 4) |
      (this.perParticleOffsetV << 8) |
      (this.perParticleRotation << 12) |
      (this.perParticleZoom << 16) |
      (this.perParticleDistortion << 20) |
      (this.perParticleBlend << 24);

    if (this.randomizeOffsets) {
      packed |= 1 << RANDOMIZE_OFFSETS_BIT;
    }

    return packed >>> 0;
  }

  /** Whether this layer's texture carries a sheet with any sequences. */
  get hasSheet(): boolean {
    return (this.texture.sheet?.sequences.length ?? 0) > 0;
  }
}

/** The layer chain a spritecard renderer composites, and the motion vector sheet that warps it. */
export interface BuiltLayers {
  layers: ParticleTextureLayer[];
  motionVectors: ParticleRenderTexture | null;
  firstTextureName: string | null;
}

/**
 * Reads m_vecTexturesInput into the layer chain a spritecard renderer composites, falling back to a
 * single `defaultTextureName` layer when the definition supplies none. `srgbRead` says whether the
 * layers are colour (water effects cards carry data instead), and `baseSrgbRead` whether the first
 * layer is decoded from sRGB in its place.
 */
export function buildTextureLayers(
  parse: ParticleDefinitionParser,
  textures: ParticleTextureSource,
  defaultTextureName: string,
  srgbRead: boolean,
  baseSrgbRead: boolean,
): BuiltLayers {
  let firstTextureName: string | null = null;
  let motionVectors: ParticleRenderTexture | null = null;
  const parsed: ParticleTextureLayer[] = [];

  for (const textureInput of parse.array('m_vecTexturesInput')) {
    if (!textureInput.boolean('m_bEnabled', true)) {
      continue;
    }

    const textureType = textureInput.enum('m_nTextureType', SpriteCardTextureType, SpriteCardTextureType.SPRITECARD_TEXTURE_DIFFUSE);

    // The first motion vector sheet warps the colour layers rather than becoming one, and is never
    // replaced by a gradient. The vectors are signed data packed about a half, and a gamma decode
    // would bend the flow field, so it is never read as colour.
    if (textureType === SpriteCardTextureType.SPRITECARD_TEXTURE_ANIMMOTIONVEC) {
      const motionVectorsName = textureName(textureInput.data);

      if (motionVectors === null && motionVectorsName !== null) {
        motionVectors = new ParticleRenderTexture(motionVectorsName, false, false, textures);
      }

      continue;
    }

    // Only the colour types composite. Of the rest, the spritecard shader has inputs for motion
    // vectors alone, so normal, lighting and depth textures change nothing.
    if (textureType >= SpriteCardTextureType.SPRITECARD_TEXTURE_NORMALMAP || parsed.length === MAX_LAYERS) {
      continue;
    }

    const controls = isCollection(textureInput.data.m_TextureControls) ? (textureInput.data.m_TextureControls as KVObject) : null;
    const uv = controls === null ? textureInput : textureInput.nested(controls);
    const clampUVs = controls !== null && uv.boolean('m_bClampUVs', false);

    // Zoom and distortion are only scaled per particle on layers that zoom or distort
    const zooms = textureType === SpriteCardTextureType.SPRITECARD_TEXTURE_ZOOM || textureType === SpriteCardTextureType.SPRITECARD_TEXTURE_UVDISTORTION_ZOOM;
    const distorts =
      textureType === SpriteCardTextureType.SPRITECARD_TEXTURE_UVDISTORTION || textureType === SpriteCardTextureType.SPRITECARD_TEXTURE_UVDISTORTION_ZOOM;

    let layerTexture: ParticleRenderTexture;

    // A gradient layer synthesizes its ramp from m_Gradient rather than loading a texture
    if (textureInput.boolean('m_bReplaceTextureWithGradient', false)) {
      const gradient = createGradientTexture(parseGradientStops(textureInput), clampUVs);
      layerTexture = new ParticleRenderTexture('GeneratedGradient', true, clampUVs, null, gradient, {
        width: 64,
        height: 1,
        format: 0,
        flags: 0,
        mipLevels: 1,
        motionVectorsMaxDistance: 0,
        sheet: null,
      });
    } else {
      // DEVIATION from VRF, which adds no layer for a group that names no texture: a colour group left
      // empty draws the renderer's default texture instead. Without it the card shows whatever the
      // remaining layers hold edge to edge, a hard square no effect is authored to show (Celeste's
      // baton contact glow); 203 hero systems leave such a group empty. Other group types still add
      // no layer.
      const colour = textureType === SpriteCardTextureType.SPRITECARD_TEXTURE_DIFFUSE || textureType === SpriteCardTextureType.SPRITECARD_TEXTURE_ZOOM;
      const layerTextureName = textureName(textureInput.data) ?? (colour ? defaultTextureName : null);

      if (layerTextureName === null) {
        continue;
      }

      const layerSrgbRead = parsed.length === 0 ? baseSrgbRead : srgbRead;
      firstTextureName ??= layerTextureName;
      layerTexture = new ParticleRenderTexture(layerTextureName, layerSrgbRead, clampUVs, textures);
    }

    const perParticleMode = (key: string) =>
      controls === null
        ? SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE
        : uv.enum(key, SpriteCardPerParticleScale, SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE);

    const layer = new ParticleTextureLayer(layerTexture);
    layer.channels = textureInput.enum('m_nTextureChannels', SpriteCardTextureChannel, SpriteCardTextureChannel.SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA);
    layer.blendMode = textureInput.enum(
      'm_nTextureBlendMode',
      ParticleTextureLayerBlendType,
      ParticleTextureLayerBlendType.SPRITECARD_TEXTURE_BLEND_MULTIPLY,
    );
    layer.blend = textureInput.numberProvider('m_flTextureBlend', ONE);
    layer.effectMode = textureType;
    layer.scaleU = controls === null ? ONE : uv.numberProvider('m_flFinalTextureScaleU', ONE);
    layer.scaleV = controls === null ? ONE : uv.numberProvider('m_flFinalTextureScaleV', ONE);
    layer.offsetU = controls === null ? ZERO : uv.numberProvider('m_flFinalTextureOffsetU', ZERO);
    layer.offsetV = controls === null ? ZERO : uv.numberProvider('m_flFinalTextureOffsetV', ZERO);
    layer.rotation = controls === null ? ZERO : uv.numberProvider('m_flFinalTextureUVRotation', ZERO);
    layer.distortion = controls === null ? ZERO : uv.numberProvider('m_flDistortion', ZERO);
    layer.zoomScale = controls === null ? ZERO : uv.numberProvider('m_flZoomScale', ZERO);
    layer.clampUVs = clampUVs;
    layer.randomizeOffsets = controls !== null && uv.boolean('m_bRandomizeOffsets', false);
    layer.perParticleScale = perParticleMode('m_nPerParticleScale');
    layer.perParticleOffsetU = perParticleMode('m_nPerParticleOffsetU');
    layer.perParticleOffsetV = perParticleMode('m_nPerParticleOffsetV');
    layer.perParticleRotation = perParticleMode('m_nPerParticleRotation');
    layer.perParticleZoom = zooms ? perParticleMode('m_nPerParticleZoom') : 0;
    layer.perParticleDistortion = distorts ? perParticleMode('m_nPerParticleDistortion') : 0;
    layer.perParticleBlend = perParticleMode('m_nPerParticleBlend');
    parsed.push(layer);
  }

  if (parsed.length === 0) {
    parsed.push(new ParticleTextureLayer(new ParticleRenderTexture(defaultTextureName, baseSrgbRead, false, textures)));

    // Without a colour layer the motion vectors have no texture size to scale by, so they push nothing
    motionVectors = null;
  } else if (parsed.length > 3) {
    // A chain of more than three colour layers draws without its motion vectors
    motionVectors = null;
  }

  return { layers: parsed, motionVectors, firstTextureName };
}

/**
 * Describes every layer to the shader: how it composites, how a card coordinate is placed in it,
 * which per particle values scale its controls, and where the sequences of its sheet sit in
 * `sheets`, adding them there the first time.
 */
export function bindTextureLayers(
  uniforms: TextureLayerUniforms,
  layers: readonly ParticleTextureLayer[],
  state: ParticleSystemState,
  sheets: ParticleSheetCache,
  maxAnisotropy: number,
): void {
  uniforms.uLayerCount.value = layers.length;

  let frameZoomX = 1;
  let frameZoomY = 1;
  let anyLayerHasSheet = false;

  layers.forEach((source, layer) => {
    const zoomScale = source.zoomScale.nextNumber(state);

    uniforms.uLayerChannels.value[layer] = source.channels;
    uniforms.uLayerBlendMode.value[layer] = source.blendMode;
    uniforms.uLayerBlend.value[layer] = source.blend.nextNumber(state);
    uniforms.uLayerEffectMode.value[layer] = source.effectMode;
    uniforms.uLayerDistortion.value[layer] = source.distortion.nextNumber(state);
    uniforms.uLayerZoomScale.value[layer] = wrap(zoomScale, 0, 10);

    // The first two layers zoom towards the card centre as they cross between sheet frames, by the
    // unwrapped zoom scale
    if (layer === 0) {
      frameZoomX = saturate(1 / zoomScale);
    } else if (layer === 1) {
      frameZoomY = saturate(1 / zoomScale);
    }

    const rows = sheets.getRows(source.texture.sheet);
    const hasSheet = rows.sequenceCount > 0;
    anyLayerHasSheet ||= hasSheet;

    // A layer showing a sheet does not turn; its rotation scales how fast it plays instead
    const rotation = source.rotation.nextNumber(state);
    const scaleOffset = uniforms.uLayerUvScaleOffset.value[layer];
    scaleOffset.x = source.scaleU.nextNumber(state);
    scaleOffset.y = source.scaleV.nextNumber(state);
    scaleOffset.z = source.offsetU.nextNumber(state);
    scaleOffset.w = source.offsetV.nextNumber(state);

    uniforms.uLayerUvRotation.value[layer] = hasSheet ? rotation : degreesToRadians(rotation);
    uniforms.uLayerSheet.value[layer].x = rows.firstRow;
    uniforms.uLayerSheet.value[layer].y = rows.sequenceCount;
    uniforms.uLayerPerParticleModes.value[layer] = source.packPerParticleModes();
    uniforms.uLayerLookup.value[layer] = source.effectMode === SpriteCardTextureType.SPRITECARD_TEXTURE_1D_COLOR_LOOKUP;

    // A texture suggesting clamps samples a transparent black border outside 0 to 1, unless the
    // layer clamps its uvs to the edge
    const [wrapS, wrapT] = source.texture.wrap;
    uniforms.uLayerBorder.value[layer].x = !source.clampUVs && wrapS === 'border' ? 1 : 0;
    uniforms.uLayerBorder.value[layer].y = !source.clampUVs && wrapT === 'border' ? 1 : 0;

    // The clamp sampler filters anisotropically, which WebGL does not do for a texture of one level
    const singleLevel = (source.texture.info?.mipLevels ?? 1) <= 1;
    uniforms.uLayerAnisotropy.value[layer] = source.clampUVs && singleLevel && maxAnisotropy >= 4 ? maxAnisotropy : 0;
  });

  uniforms.uFrameZoom.value.x = frameZoomX;
  uniforms.uFrameZoom.value.y = frameZoomY;
  uniforms.uAnyLayerHasSheet.value = anyLayerHasSheet;
}

function textureName(data: KVObject): string | null {
  const name = getString(data, 'm_hTexture', '');
  return name === '' ? null : name;
}

function parseGradientStops(textureInput: ParticleDefinitionParser): GradientStop[] {
  const gradient = textureInput.data.m_Gradient;

  if (!isCollection(gradient)) {
    return [];
  }

  return textureInput.nested(gradient as KVObject).array('m_Stops').map((stop) => {
    // The colour is stored as bytes, and taken as they are
    const color = stop.data.m_Color;
    const bytes: [number, number, number] = Array.isArray(color)
      ? [Number(color[0]) & 0xff, Number(color[1]) & 0xff, Number(color[2]) & 0xff]
      : [255, 255, 255];
    return { position: stop.float('m_flPosition', 0), color: bytes };
  });
}

/** MathUtils.Wrap: `value` wrapped into [min, max). */
function wrap(value: number, min: number, max: number): number {
  const range = max - min;
  return value - range * Math.floor((value - min) / range);
}

function saturate(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
