// Ported from ValveResourceFormat (MIT): Renderer/Renderer/PostProcess/PostProcessRenderer.cs,
// Renderer/Renderer/PostProcess/BloomRenderer.cs and the TonemapSettings and BloomSettings of
// Renderer/Renderer/SceneEnvironment/ScenePostProcessVolume.cs.
//
// Takes a linear HDR scene colour to the display: exposure, bloom, the filmic tonemap, the sRGB
// encode, the colour correction LUT, the display gamma and the blue noise dither. The game is
// Deadlock throughout: its bloom thresholds the unexposed scene and upsamples with a 2x2 box, and its
// scene blooms by the strongest of the three bloom modes. There is no auto exposure; the exposure is
// the tonemap scalar the host sets (PostProcessRenderer.CustomExposure).

import * as THREE from 'three';
import type { KVObject } from '../../kv';
import { BLOOM_THRESHOLD_FRAGMENT, FULLSCREEN_VERTEX, POST_PROCESSING_FRAGMENT, bloomBlurFragment } from './shaders';

/** PostProcessingTonemapParameters_t, as TonemapSettings keeps it. */
export interface SourceTonemapSettings {
  /** In log2 stops. */
  exposureBias: number;
  shoulderStrength: number;
  linearStrength: number;
  linearAngle: number;
  toeStrength: number;
  toeNum: number;
  toeDenom: number;
  /** The white point in stops: the scene value that displays as white is two to its power. */
  whitePoint: number;
}

export type BloomBlendMode = 'BLOOM_BLEND_ADD' | 'BLOOM_BLEND_SCREEN' | 'BLOOM_BLEND_BLUR';

/** PostProcessingBloomParameters_t, as BloomSettings keeps it. */
export interface SourceBloomSettings {
  blendMode: BloomBlendMode;
  addBloomStrength: number;
  screenBloomStrength: number;
  blurBloomStrength: number;
  bloomThreshold: number;
  bloomThresholdWidth: number;
  /** One per blur buffer, 1/2 through 1/32 resolution. */
  blurWeight: [number, number, number, number, number];
  blurTint: [number, number, number][];
}

export interface SourcePostSettings {
  tonemap: SourceTonemapSettings;
  /** The bloom of the post process volume, or null for none (PostProcessState.HasBloom). */
  bloom: SourceBloomSettings | null;
  /** The linear tonemap scalar, the exposure before the bias. */
  exposure: number;
  /** The game's brightness setting; 2.2 is identity, lower is brighter. */
  fullScreenGamma: number;
}

/** TonemapSettings(): the curve VRF draws a scene without a post process volume with. */
export const VRF_DEFAULT_TONEMAP: SourceTonemapSettings = {
  exposureBias: 0,
  shoulderStrength: 0.15,
  linearStrength: 0.5,
  linearAngle: 0.1,
  toeStrength: 0.2,
  toeNum: 0.02,
  toeDenom: 0.3,
  whitePoint: 4,
};

/** BloomSettings(): every mode's default with the five blur weights at 0.2 and white tints. */
export const VRF_DEFAULT_BLOOM: SourceBloomSettings = {
  blendMode: 'BLOOM_BLEND_ADD',
  addBloomStrength: 1,
  screenBloomStrength: 0,
  blurBloomStrength: 0,
  bloomThreshold: 1.05,
  bloomThresholdWidth: 1.661,
  blurWeight: [0.2, 0.2, 0.2, 0.2, 0.2],
  blurTint: [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ],
};

/** postprocessing/basepostprocess_deadlock.vpost: the post process the game's maps start from. */
export const DEADLOCK_BASE_POST: SourcePostSettings = {
  tonemap: {
    exposureBias: 0.8992,
    shoulderStrength: 0.3538,
    linearStrength: 0.3258,
    linearAngle: 0.2528,
    toeStrength: 0.6966,
    toeNum: 0,
    toeDenom: 0.7819,
    whitePoint: 3.9996,
  },
  bloom: {
    blendMode: 'BLOOM_BLEND_ADD',
    addBloomStrength: 0.5,
    screenBloomStrength: 0,
    blurBloomStrength: 0,
    bloomThreshold: 1,
    bloomThresholdWidth: 0.999,
    blurWeight: [0, 0.070259, 0.181076, 0.300013, 0.448652],
    blurTint: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
  },
  exposure: 1,
  fullScreenGamma: 2.2,
};

/**
 * postprocessing/caldera.vpost, the master post_processing_volume in
 * maps/ui/hero_shop/necro_shop/entities/default_ents.vents and maps/ui/hero_container.
 * This is the inspect portrait preset. The hideout volume uses DEADLOCK_BASE_POST instead.
 */
export const DEADLOCK_HERO_POST: SourcePostSettings = {
  tonemap: { ...VRF_DEFAULT_TONEMAP, whitePoint: 3.9996 },
  bloom: {
    ...VRF_DEFAULT_BLOOM,
    addBloomStrength: 0.888,
    bloomThreshold: 4,
    bloomThresholdWidth: 0.999,
  },
  exposure: 1,
  fullScreenGamma: 2.2,
};

/** The settings a decoded `.vpost` holds (m_toneMapParams, m_bloomParams), on top of `base`. */
export function postSettingsFromVpost(vpost: KVObject, base: SourcePostSettings = { tonemap: VRF_DEFAULT_TONEMAP, bloom: null, exposure: 1, fullScreenGamma: 2.2 }): SourcePostSettings {
  const number = (object: KVObject, key: string) => (typeof object[key] === 'number' ? (object[key] as number) : 0);
  const settings: SourcePostSettings = { ...base };

  if (vpost.m_bHasTonemapParams === true && typeof vpost.m_toneMapParams === 'object' && vpost.m_toneMapParams !== null) {
    const t = vpost.m_toneMapParams as KVObject;
    settings.tonemap = {
      exposureBias: number(t, 'm_flExposureBias'),
      shoulderStrength: number(t, 'm_flShoulderStrength'),
      linearStrength: number(t, 'm_flLinearStrength'),
      linearAngle: number(t, 'm_flLinearAngle'),
      toeStrength: number(t, 'm_flToeStrength'),
      toeNum: number(t, 'm_flToeNum'),
      toeDenom: number(t, 'm_flToeDenom'),
      whitePoint: number(t, 'm_flWhitePoint'),
    };
  }

  if (vpost.m_bHasBloomParams === true && typeof vpost.m_bloomParams === 'object' && vpost.m_bloomParams !== null) {
    const b = vpost.m_bloomParams as KVObject;
    const weights = (Array.isArray(b.m_flBlurWeight) ? b.m_flBlurWeight : []).map(Number);
    const tints = (Array.isArray(b.m_vBlurTint) ? b.m_vBlurTint : []).map((tint) => (Array.isArray(tint) ? tint.map(Number) : [1, 1, 1]) as [number, number, number]);
    settings.bloom = {
      blendMode: (typeof b.m_blendMode === 'string' ? b.m_blendMode : 'BLOOM_BLEND_ADD') as BloomBlendMode,
      addBloomStrength: number(b, 'm_flBloomStrength'),
      screenBloomStrength: number(b, 'm_flScreenBloomStrength'),
      blurBloomStrength: number(b, 'm_flBlurBloomStrength'),
      bloomThreshold: number(b, 'm_flBloomThreshold'),
      bloomThresholdWidth: number(b, 'm_flBloomThresholdWidth'),
      blurWeight: [0, 1, 2, 3, 4].map((i) => weights[i] ?? 0) as SourceBloomSettings['blurWeight'],
      blurTint: [0, 1, 2, 3, 4].map((i) => tints[i] ?? [1, 1, 1]),
    };
  }

  return settings;
}

/** TonemapSettings.ApplyTonemapping: the curve at one value. */
export function applyTonemapping(settings: SourceTonemapSettings, value: number): number {
  const num = value * (value * settings.shoulderStrength + settings.linearAngle * settings.linearStrength) + settings.toeStrength * settings.toeNum;
  const denom = value * (value * settings.shoulderStrength + settings.linearStrength) + settings.toeStrength * settings.toeDenom;
  return num / denom - settings.toeNum / settings.toeDenom;
}

/** The display value of one linear HDR channel: exposure, curve and sRGB encode, without bloom, LUT or dither. */
export function tonemapChannel(settings: SourcePostSettings, value: number): number {
  const white = 2 ** settings.tonemap.whitePoint;
  const exposed = value * settings.exposure * 2 ** settings.tonemap.exposureBias;
  const mapped = applyTonemapping(settings.tonemap, Math.min(exposed * 2.8, white)) / applyTonemapping(settings.tonemap, white);
  const gamma = mapped <= 0.0031308 ? mapped * 12.92 : 1.055 * Math.pow(mapped, 1 / 2.4) - 0.055;
  return Math.pow(Math.max(gamma, 0), settings.fullScreenGamma / 2.2);
}

/** The linear HDR channel `settings` shows as `display` (0 to 1, gamma encoded): tonemapChannel inverted. */
export function linearForDisplay(settings: SourcePostSettings, display: number): number {
  let low = 0;
  let high = 2 ** settings.tonemap.whitePoint / Math.max(settings.exposure * 2 ** settings.tonemap.exposureBias * 2.8, 1e-6);

  for (let i = 0; i < 60; i++) {
    const middle = (low + high) / 2;

    if (tonemapChannel(settings, middle) < display) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return (low + high) / 2;
}

/**
 * The exposure (tonemap scalar) at which `settings` shows `linear` as `display` (0 to 1, gamma
 * encoded). For a host whose own lighting is calibrated against another curve: it anchors one value,
 * such as mid grey, and leaves the curve's shape VRF's.
 */
export function exposureForDisplay(settings: SourcePostSettings, linear: number, display: number): number {
  let low = 1e-4;
  let high = 1e4;

  for (let i = 0; i < 80; i++) {
    const middle = Math.sqrt(low * high);

    if (tonemapChannel({ ...settings, exposure: middle }, linear) < display) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return Math.sqrt(low * high);
}

/** How many blur buffers the bloom's mip chain has. */
const BLOOM_MIP_COUNT = 4;
const NUM_BLUR_BUFFERS = 5;

function hdrTarget(width: number, height: number, name: string): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  target.texture.name = name;
  return target;
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, number> = {}): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

/**
 * PostProcessRenderer.Render with BloomRenderer for Deadlock, drawn through three.js. Construct one,
 * set `settings`, and call `render` once a frame with the HDR scene colour.
 */
export class SourcePostProcess {
  settings: SourcePostSettings;

  /** textures/dev/blue_noise_256.vtex decoded as stored, or null to skip the dither. */
  blueNoise: THREE.Texture | null = null;

  /** A colour correction LUT (32x32x32 by default) and its weight, or null for none. */
  colorCorrection: { lut: THREE.Data3DTexture; weight: number } | null = null;

  /** The effects bloom map (geometry drawn only to glow) for the frame, or null. */
  effectsBloom: THREE.Texture | null = null;

  private readonly mipChain: THREE.WebGLRenderTarget[] = [];
  private readonly output = hdrTarget(4, 4, 'BloomOutput');
  private readonly triangle: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly threshold: THREE.RawShaderMaterial;
  private readonly downsample: THREE.RawShaderMaterial;
  private readonly horizontalBlur: THREE.RawShaderMaterial;
  private readonly verticalBlur: THREE.RawShaderMaterial;
  private readonly upsample: THREE.RawShaderMaterial;
  private readonly finalUpsample: THREE.RawShaderMaterial;
  private readonly composite: THREE.RawShaderMaterial;
  private readonly compositeBloom: THREE.RawShaderMaterial;
  private readonly neutralLut: THREE.Data3DTexture;
  private readonly blackTexture: THREE.DataTexture;

  constructor(settings: SourcePostSettings = DEADLOCK_BASE_POST) {
    this.settings = settings;

    for (let level = 0; level < BLOOM_MIP_COUNT; level++) {
      this.mipChain.push(hdrTarget(4, 4, `BloomMipChain${level}`));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.triangle = new THREE.Mesh(geometry);
    this.triangle.frustumCulled = false;

    this.blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blackTexture.needsUpdate = true;
    this.neutralLut = new THREE.Data3DTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, 1);
    this.neutralLut.needsUpdate = true;

    this.threshold = pass(BLOOM_THRESHOLD_FRAGMENT, {
      inputTexture: { value: null },
      g_tEffectsBloom: { value: this.blackTexture },
      g_flBloomScale: { value: 1 },
      g_flToneMapScalarLinear: { value: 1 },
      g_flThresholdParams: { value: new THREE.Vector2() },
      g_flSceneBloomWeight: { value: 1 },
      g_bEffectsBloom: { value: false },
      g_bEffectsBloomClamped: { value: false },
      g_bEffectsBloomEncoded: { value: false },
    });

    const blurUniforms = () => ({
      g_tSource: { value: null },
      g_tSource2: { value: null },
      g_vTexelSize: { value: new THREE.Vector4() },
      g_vCombineUVScaleAndClamp: { value: new THREE.Vector4() },
      g_vCombineUVScaleAndClamp2: { value: new THREE.Vector4() },
      g_vPrevMipBlurTint: { value: new THREE.Vector3(1, 1, 1) },
      g_vCurrMipBlurTint: { value: new THREE.Vector3(1, 1, 1) },
    });

    this.downsample = pass(bloomBlurFragment(0), blurUniforms());
    this.horizontalBlur = pass(bloomBlurFragment(1), blurUniforms());
    this.verticalBlur = pass(bloomBlurFragment(2), blurUniforms());
    this.upsample = pass(bloomBlurFragment(3), blurUniforms());
    this.finalUpsample = pass(bloomBlurFragment(4), blurUniforms());

    // Dual source blending scales the target mip by the second output, a constant tint here
    this.upsample.blending = THREE.CustomBlending;
    this.upsample.blendSrc = THREE.OneFactor;
    this.upsample.blendDst = THREE.ConstantColorFactor;
    this.upsample.blendEquation = THREE.AddEquation;

    const compositeUniforms = () => ({
      g_tColorBuffer: { value: null },
      g_tColorCorrectionLUT: { value: this.neutralLut },
      g_tBlueNoise: { value: this.blackTexture },
      g_tBloom: { value: null },
      g_bPostProcessEnabled: { value: true },
      g_flToneMapScalarLinear: { value: 1 },
      g_flExposureBiasScaleFactor: { value: 1 },
      g_flShoulderStrength: { value: 0 },
      g_flLinearStrength: { value: 0 },
      g_flLinearAngle: { value: 0 },
      g_flToeStrength: { value: 0 },
      g_flToeNum: { value: 0 },
      g_flToeDenom: { value: 1 },
      g_flWhitePoint: { value: 1 },
      g_flWhitePointScale: { value: 1 },
      g_flFullScreenGamma: { value: 2.2 },
      g_flColorCorrectionDefaultWeight: { value: 0 },
      g_vColorCorrectionColorRange: { value: new THREE.Vector2(0.96875, 0.015625) },
      g_vBlueNoiseDitherParams: { value: new THREE.Vector4(0.5, 0.5, 1 / 256, 2 / 255) },
      g_bDither: { value: false },
      g_vBloomUvScaleClamp: { value: new THREE.Vector4(1, 1, 1, 1) },
      g_vUnNormalizedBloomStrengths: { value: new THREE.Vector3(1, 0, 0) },
      g_vNormalizedBloomStrengths: { value: new THREE.Vector3(1, 0, 0) },
      g_bBloomExposed: { value: false },
    });

    this.composite = pass(POST_PROCESSING_FRAGMENT, compositeUniforms(), { D_BLOOM: 0 });
    this.compositeBloom = pass(POST_PROCESSING_FRAGMENT, compositeUniforms(), { D_BLOOM: 1 });
  }

  /**
   * Draws `input` (linear HDR, the size of the output) to `output`, or the canvas when null. Leaves
   * the renderer's render target as it found it.
   */
  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, output: THREE.WebGLRenderTarget | null): void {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    const { settings } = this;
    const { width, height } = input.image as { width: number; height: number };
    const hasBloom = settings.bloom !== null;
    const runBloom = hasBloom || this.effectsBloom !== null;
    const bloomSettings = settings.bloom ?? VRF_DEFAULT_BLOOM;

    if (runBloom) {
      this.renderBloom(renderer, input, width, height, bloomSettings, hasBloom ? 1 : 0);
    }

    const material = runBloom ? this.compositeBloom : this.composite;
    const u = material.uniforms;
    const tonemap = settings.tonemap;
    const effectiveWhitePoint = 2 ** tonemap.whitePoint;

    u.g_tColorBuffer.value = input;
    u.g_flToneMapScalarLinear.value = settings.exposure;
    u.g_flExposureBiasScaleFactor.value = 2 ** tonemap.exposureBias;
    u.g_flShoulderStrength.value = tonemap.shoulderStrength;
    u.g_flLinearStrength.value = tonemap.linearStrength;
    u.g_flLinearAngle.value = tonemap.linearAngle;
    u.g_flToeStrength.value = tonemap.toeStrength;
    u.g_flToeNum.value = tonemap.toeNum;
    u.g_flToeDenom.value = tonemap.toeDenom;
    u.g_flWhitePoint.value = effectiveWhitePoint;
    u.g_flWhitePointScale.value = 1 / applyTonemapping(tonemap, effectiveWhitePoint);
    u.g_flFullScreenGamma.value = settings.fullScreenGamma;

    // The dither holds still, as VRF draws with AnimateDither off: a half texel offset
    u.g_bDither.value = this.blueNoise !== null;
    u.g_tBlueNoise.value = this.blueNoise ?? this.blackTexture;

    if (this.colorCorrection !== null) {
      const dimensions = (this.colorCorrection.lut.image as { width: number }).width;
      u.g_tColorCorrectionLUT.value = this.colorCorrection.lut;
      u.g_flColorCorrectionDefaultWeight.value = this.colorCorrection.weight;
      (u.g_vColorCorrectionColorRange.value as THREE.Vector2).set(1 - 1 / dimensions, 0.5 / dimensions);
    } else {
      u.g_tColorCorrectionLUT.value = this.neutralLut;
      u.g_flColorCorrectionDefaultWeight.value = 0;
    }

    if (runBloom) {
      u.g_tBloom.value = this.output.texture;
      const strengths = new THREE.Vector3(bloomSettings.addBloomStrength, bloomSettings.screenBloomStrength, bloomSettings.blurBloomStrength);
      const maxStrength = Math.max(strengths.x, strengths.y, strengths.z);

      // The strongest mode is scaled to 1, so blended volumes keep the ratio between modes
      if (maxStrength >= 1e-5) {
        (u.g_vUnNormalizedBloomStrengths.value as THREE.Vector3).copy(strengths);
        (u.g_vNormalizedBloomStrengths.value as THREE.Vector3).copy(strengths).divideScalar(maxStrength);
      } else {
        (u.g_vUnNormalizedBloomStrengths.value as THREE.Vector3).set(1, 0, 0);
        (u.g_vNormalizedBloomStrengths.value as THREE.Vector3).set(1, 0, 0);
      }

      // Deadlock thresholds the unexposed scene, so its bloom takes the exposure in the composite
      u.g_bBloomExposed.value = false;
    }

    this.draw(renderer, material, output, width, height);

    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
  }

  private renderBloom(renderer: THREE.WebGLRenderer, input: THREE.Texture, width: number, height: number, settings: SourceBloomSettings, sceneWeight: number): void {
    const quarterWidth = Math.floor(width / 4);
    const quarterHeight = Math.floor(height / 4);

    // Bloom is skipped when the resolution is too small
    if (quarterWidth < 16 || quarterHeight < 16) {
      renderer.setRenderTarget(this.output);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      return;
    }

    this.mipChain.forEach((target, level) => target.setSize(Math.max(1, quarterWidth >> level), Math.max(1, quarterHeight >> level)));
    this.output.setSize(quarterWidth, quarterHeight);

    // Threshold: the scene blooms by the strongest of the three modes
    const thresholdWidth = Math.max(settings.bloomThresholdWidth, 1e-4);
    const t = this.threshold.uniforms;
    t.inputTexture.value = input;
    t.g_flBloomScale.value = Math.max(settings.addBloomStrength, settings.screenBloomStrength, settings.blurBloomStrength);
    t.g_flToneMapScalarLinear.value = this.settings.exposure;
    (t.g_flThresholdParams.value as THREE.Vector2).set(-settings.bloomThreshold / thresholdWidth, 1 / thresholdWidth);
    t.g_flSceneBloomWeight.value = sceneWeight;
    t.g_bEffectsBloom.value = this.effectsBloom !== null;
    t.g_tEffectsBloom.value = this.effectsBloom ?? this.blackTexture;
    this.draw(renderer, this.threshold, this.mipChain[0], quarterWidth, quarterHeight);

    for (let level = 0; level < BLOOM_MIP_COUNT; level++) {
      const target = this.mipChain[level];
      const size = new THREE.Vector2(target.width, target.height);

      if (level > 0) {
        const source = this.mipChain[level - 1];
        const d = this.downsample.uniforms;
        d.g_tSource.value = source.texture;
        (d.g_vTexelSize.value as THREE.Vector4).set(1 / source.width, 1 / source.height, 0, 0);
        this.draw(renderer, this.downsample, target, size.x, size.y);
      }

      // The output is free until the final upsample, its top left corner holds the horizontal pass
      const h = this.horizontalBlur.uniforms;
      h.g_tSource.value = target.texture;
      (h.g_vTexelSize.value as THREE.Vector4).set(1 / size.x, 1 / size.y, size.x - 0.5, size.y - 0.5);
      this.draw(renderer, this.horizontalBlur, this.output, size.x, size.y);

      const v = this.verticalBlur.uniforms;
      v.g_tSource.value = this.output.texture;
      (v.g_vTexelSize.value as THREE.Vector4).set(1 / this.output.width, 1 / this.output.height, size.x - 0.5, size.y - 0.5);
      this.draw(renderer, this.verticalBlur, target, size.x, size.y);
    }

    const tint = (index: number) => {
      const color = settings.blurTint[index] ?? [1, 1, 1];
      const weight = index < NUM_BLUR_BUFFERS ? settings.blurWeight[index] : 0;
      return new THREE.Vector3(color[0] * weight, color[1] * weight, color[2] * weight);
    };

    const combine = (level: number) => {
      const target = this.mipChain[level];
      const source = this.mipChain[level + 1];
      return new THREE.Vector4(1 / target.width, 1 / target.height, (source.width - 0.5) / source.width, (source.height - 0.5) / source.height);
    };

    for (let level = BLOOM_MIP_COUNT - 2; level >= 1; level--) {
      const u = this.upsample.uniforms;
      const previousTint = level === BLOOM_MIP_COUNT - 2 ? tint(BLOOM_MIP_COUNT) : new THREE.Vector3(1, 1, 1);
      const currentTint = tint(level + 1);
      u.g_tSource.value = this.mipChain[level + 1].texture;
      (u.g_vCombineUVScaleAndClamp.value as THREE.Vector4).copy(combine(level));
      (u.g_vPrevMipBlurTint.value as THREE.Vector3).copy(previousTint);
      this.upsample.blendColor.setRGB(currentTint.x, currentTint.y, currentTint.z, THREE.LinearSRGBColorSpace);
      this.upsample.blendAlpha = 1;
      this.draw(renderer, this.upsample, this.mipChain[level], this.mipChain[level].width, this.mipChain[level].height);
    }

    const mip0 = this.mipChain[0];
    const f = this.finalUpsample.uniforms;
    f.g_tSource.value = this.mipChain[1].texture;
    f.g_tSource2.value = mip0.texture;
    (f.g_vCombineUVScaleAndClamp.value as THREE.Vector4).copy(combine(0));
    (f.g_vCombineUVScaleAndClamp2.value as THREE.Vector4).set(0, 0, (mip0.width - 0.5) / mip0.width, (mip0.height - 0.5) / mip0.height);
    (f.g_vCurrMipBlurTint.value as THREE.Vector3).copy(tint(0).add(tint(1)));
    this.draw(renderer, this.finalUpsample, this.output, mip0.width, mip0.height);
  }

  /** Draws the full screen triangle with `material` into the top left `width` x `height` of `target`. */
  private draw(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null, width: number, height: number): void {
    this.triangle.material = material;

    if (target !== null) {
      target.viewport.set(0, 0, width, height);
      target.scissorTest = false;
    }

    renderer.setRenderTarget(target);
    renderer.render(this.triangle, this.camera);
  }

  dispose(): void {
    this.mipChain.forEach((target) => target.dispose());
    this.output.dispose();
    this.triangle.geometry.dispose();

    for (const material of [this.threshold, this.downsample, this.horizontalBlur, this.verticalBlur, this.upsample, this.finalUpsample, this.composite, this.compositeBloom]) {
      material.dispose();
    }

    this.neutralLut.dispose();
    this.blackTexture.dispose();
  }
}
