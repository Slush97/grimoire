// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/ParticleSpritecardRenderer.cs.
//
// A renderer that draws with the spritecard shader: textured cards, trails and ropes that can be lit,
// feathered against the scene, alpha tested, refract the scene behind them and animate through a
// sprite sheet. Each renderer draws one mesh with a material of its own; the uniforms VRF sets per
// draw are set on it once a frame, in updateBuffers.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { Vector3, cross, normalize, safeNormalize } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { MINIMUM_LENGTH_SQUARED } from '../utils/particleMath';
import {
  BlurFilterType,
  ParticleAlphaReferenceType,
  ParticleAnimationType,
  ParticleBlendMode,
  ParticleDepthFeatheringMode,
  ParticleLightingQuality,
  ParticleSequenceCropOverride,
  SpriteCardPerParticleScale,
  SpriteCardTextureType,
} from './enums';
import { ParticleFunctionRenderer } from './functionRenderer';
import type { ParticleRendererContext } from './context';
import { getSequenceIndex, type ParticleSheet } from './sheet';
import { SPRITECARD_FRAGMENT } from './shaders/spritecardFragment';
import { SPRITECARD_VERTEX } from './shaders/spritecardVertex';
import { MAX_LAYERS, ParticleTextureLayer, bindTextureLayers, buildTextureLayers, type TextureLayerUniforms } from './textureLayer';
import type { ParticleRenderTexture } from './textures';
import type { RenderView } from './view';

/** The largest share of a ribbon's direction that may lie along world Z for Z to serve as its fallback side axis. */
const MAX_RIBBON_VERTICAL_SHARE = 0.999;

/** Where the per particle random value sits past the particle's own slot. */
const RANDOM_SLOT = 235;

/** The edge softness pair that turns the shader's soft edge off, as its lower end is not below its upper end. */
export const NO_EDGE_SOFTNESS = new THREE.Vector2(1000, -1000);

const layerTextureNames = ['uTexture', 'uTextureLayer1', 'uTextureLayer2', 'uTextureLayer3', 'uTextureLayer4'];

type Uniforms = Record<string, THREE.IUniform>;

export abstract class ParticleSpritecardRenderer extends ParticleFunctionRenderer {
  /** Multiplies the luminance-weighted blend the output alpha is scaled by. */
  protected readonly overbrightFactor: NumberProvider;
  /** Scales the scene light a particle is lit by. */
  protected readonly diffuseAmountInput: NumberProvider;
  /** Added on top of the scene light, unlit. */
  protected readonly selfIllumAmount: NumberProvider;
  /** Fraction by which the sampled colour is pulled toward its own luminance. */
  protected readonly desaturation: NumberProvider;
  /** The source alpha values that map to 0 and 1, which the shader remaps the texture alpha by linearly. */
  protected readonly sourceAlphaValueToMapToZero: NumberProvider;
  protected readonly sourceAlphaValueToMapToOne: NumberProvider;
  /** Whether the vertex colour is decoded from gamma space in the shader. */
  protected readonly gammaCorrectVertexColors: boolean;
  /** Whether sheet frame blending keeps the brighter of the two frames per channel. */
  protected readonly maxLuminanceFrameBlend: boolean;
  /** Whether the lit colour is clamped to 1 before it blends. */
  private readonly saturateColorPreAlphaBlend: boolean;
  /** Whether the blend output takes the magnitude of the blend mode's alpha factor and leaves the colour of the blend-add modes unpremultiplied. */
  private readonly unsignedBlendAlpha: boolean;
  /** Whether each texture layer's composite is clamped to [0, 1] rather than only floored at 0. */
  private readonly clampLayers: boolean;
  /** Whether the base texture is decoded from sRGB. */
  private readonly baseTextureSrgbRead: boolean;
  /** Additive self-colour laid over the alpha blend; uploaded as 1 + amount. */
  protected readonly addSelfAmount: NumberProvider;
  /** Shifts the drawn quad within its own plane, in radii. */
  protected readonly centerXOffset: NumberProvider;
  protected readonly centerYOffset: NumberProvider;
  /** Distance toward the camera the depth is re-taken from, in world units. */
  protected readonly depthBias: NumberProvider;

  // ON_OPTIONAL and ON_REQUIRED currently treated the same
  private readonly featheringMode: number;
  private readonly featheringMinDist: NumberProvider;
  private readonly featheringMaxDist: NumberProvider;
  private readonly featheringFilter: NumberProvider;

  /** Whether this renderer draws the opaque scene behind it, displaced by its texture, in place of the texture's colour. */
  private readonly refract: boolean;
  private readonly refractAmount: NumberProvider;
  private readonly refractBlurRadius: number;
  private readonly refractBlurType: number;
  private readonly refractSolid: boolean;

  private readonly disableZBuffering: boolean;
  private readonly reverseZBuffering: boolean;

  /** The per particle value whose complement is the alpha test threshold. */
  private readonly perParticleAlphaReference: number;
  /** The per particle value giving the width of the alpha band that passes the test. */
  private readonly perParticleAlphaRefWindow: number;
  private readonly alphaReferenceType: number;
  private readonly alphaReferenceSoftness: NumberProvider;

  /** Where scene lighting is sampled. */
  protected readonly lightingMode: number;
  /** How the drawn colour composites over what is behind it. */
  protected readonly blendMode: number;
  /** Whether consecutive sheet frames cross-fade rather than step from one to the next. */
  private readonly blendFrames: boolean;
  /** Passes through the sequence per second, or frames per second when animating in FPS. */
  private readonly animationRate: number;
  /** What the sheet animation is timed by. */
  private readonly animationType: number;
  /** What the age each particle hands the shader is measured by. Normally animationType. */
  protected ageAnimationType: number;
  private readonly animateInFps: boolean;
  /** The absolute cosine between the facing axis and the view direction at which the view angle fade starts and ends. */
  private readonly startFadeDot: number;
  private readonly endFadeDot: number;

  /** The texture layers, in composite order; the first is the base texture. */
  protected readonly layers: ParticleTextureLayer[];
  /** The sheet of motion vectors that warps the first two layers, or null. */
  protected readonly motionVectors: ParticleRenderTexture | null;
  private readonly motionVectorScaleU: NumberProvider;
  private readonly motionVectorScaleV: NumberProvider;
  /** Whether the card shrinks to the art of the frames its first layer blends. */
  private readonly cropsFrames: boolean;

  protected readonly context: ParticleRendererContext;
  protected readonly material: THREE.RawShaderMaterial;
  protected readonly uniforms: Uniforms;
  protected readonly mesh: THREE.Mesh;

  /** How many quads the vertex buffer holds since the last updateBuffers. */
  protected quadCount = 0;
  private diffuseAmount = 1;
  private visible = false;

  /**
   * Reads the shared settings, and builds the layers and the material. `instancing` is the
   * S_PARTICLE_INSTANCED combo: 0 for strips, otherwise the shape each instance expands to.
   */
  protected constructor(parse: ParticleDefinitionParser, context: ParticleRendererContext, defaultTextureName: string, instancing: number) {
    super(parse);
    this.context = context;

    this.lightingMode = parse.enum('m_nLightingMode', ParticleLightingQuality, ParticleLightingQuality.PARTICLE_LIGHTING_PER_PARTICLE);
    this.overbrightFactor = parse.numberProvider('m_flOverbrightFactor', new LiteralNumberProvider(1));
    this.addSelfAmount = parse.numberProvider('m_flAddSelfAmount', new LiteralNumberProvider(0));
    this.depthBias = parse.numberProvider('m_flDepthBias', new LiteralNumberProvider(0));
    this.diffuseAmountInput = parse.numberProvider('m_flDiffuseAmount', new LiteralNumberProvider(1));
    parse.int32('m_nLightingControlPoint', -1);
    this.selfIllumAmount = parse.numberProvider('m_flSelfIllumAmount', new LiteralNumberProvider(0));
    this.desaturation = parse.numberProvider('m_flDesaturation', new LiteralNumberProvider(0));
    this.sourceAlphaValueToMapToZero = parse.numberProvider('m_flSourceAlphaValueToMapToZero', new LiteralNumberProvider(0));
    this.sourceAlphaValueToMapToOne = parse.numberProvider('m_flSourceAlphaValueToMapToOne', new LiteralNumberProvider(1));
    let gammaCorrectVertexColors = parse.boolean('m_bGammaCorrectVertexColors', true);
    let maxLuminanceFrameBlend = parse.boolean('m_bMaxLuminanceBlendingSequence0', false);
    this.centerXOffset = parse.numberProvider('m_flCenterXOffset', new LiteralNumberProvider(0));
    this.centerYOffset = parse.numberProvider('m_flCenterYOffset', new LiteralNumberProvider(0));
    this.featheringMode = parse.enum('m_nFeatheringMode', ParticleDepthFeatheringMode, ParticleDepthFeatheringMode.PARTICLE_DEPTH_FEATHERING_OFF);
    this.featheringMinDist = parse.numberProvider('m_flFeatheringMinDist', new LiteralNumberProvider(0));
    this.featheringMaxDist = parse.numberProvider('m_flFeatheringMaxDist', new LiteralNumberProvider(15));
    this.featheringFilter = parse.numberProvider('m_flFeatheringFilter', new LiteralNumberProvider(0));
    this.refract = parse.boolean('m_bRefract', false);
    this.refractAmount = parse.numberProvider('m_flRefractAmount', new LiteralNumberProvider(1));
    this.refractBlurRadius = Math.min(Math.max(parse.int32('m_nRefractBlurRadius', 0), 0), 4);
    this.refractBlurType = parse.enum('m_nRefractBlurType', BlurFilterType, BlurFilterType.BLURFILTER_GAUSSIAN);
    this.refractSolid = parse.boolean('m_bRefractSolid', false);
    this.disableZBuffering = parse.boolean('m_bDisableZBuffering', false);
    this.reverseZBuffering = parse.boolean('m_bReverseZBuffering', false);
    this.perParticleAlphaReference = parse.enum(
      'm_nPerParticleAlphaReference',
      SpriteCardPerParticleScale,
      SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE,
    );
    this.perParticleAlphaRefWindow = parse.enum(
      'm_nPerParticleAlphaRefWindow',
      SpriteCardPerParticleScale,
      SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE,
    );
    this.alphaReferenceType = parse.enum('m_nAlphaReferenceType', ParticleAlphaReferenceType, ParticleAlphaReferenceType.PARTICLE_ALPHA_REFERENCE_ALPHA_ALPHA);
    this.alphaReferenceSoftness = parse.numberProvider('m_flAlphaReferenceSoftness', new LiteralNumberProvider(0));
    this.blendMode = parse.enum('m_nOutputBlendMode', ParticleBlendMode, ParticleBlendMode.PARTICLE_OUTPUT_BLEND_MODE_ALPHA);
    this.blendFrames = parse.boolean('m_bBlendFramesSeq0', true);
    this.animationRate = parse.float('m_flAnimationRate', 0.1);
    this.animationType = parse.enum('m_nAnimationType', ParticleAnimationType, ParticleAnimationType.ANIMATION_TYPE_FIXED_RATE);
    this.ageAnimationType = this.animationType;
    this.animateInFps = parse.boolean('m_bAnimateInFPS', false);
    this.startFadeDot = parse.float('m_flStartFadeDot', 1);
    this.endFadeDot = parse.float('m_flEndFadeDot', 2);
    this.motionVectorScaleU = parse.numberProvider('m_flMotionVectorScaleU', new LiteralNumberProvider(1));
    this.motionVectorScaleV = parse.numberProvider('m_flMotionVectorScaleV', new LiteralNumberProvider(1));
    let saturateColorPreAlphaBlend = parse.boolean('m_bSaturateColorPreAlphaBlend', true);

    // TODO: m_bUseMixedResolutionRendering draws the renderer into a lower resolution target that is
    // upscaled over the scene, this draws it at full resolution

    // Games that switch particle shader features at run time pass these two as feature bits instead of
    // static combos, and their shader never reads the saturate bit and tests the max luminance bit so
    // that it never matches
    const game = context.game;

    if (game.particleShaderFeatureBranching) {
      maxLuminanceFrameBlend = false;
      saturateColorPreAlphaBlend = false;
    }

    // Shaders that switch features at run time have texture layers, and so do the static combo ones of these games
    this.unsignedBlendAlpha = game.particleShaderFeatureBranching || game.unsignedBlendAlphaGame;
    this.clampLayers = game.clampLayers;

    gammaCorrectVertexColors &&= this.outputIsColor;
    saturateColorPreAlphaBlend &&= this.outputIsColor;
    this.gammaCorrectVertexColors = gammaCorrectVertexColors;
    this.maxLuminanceFrameBlend = maxLuminanceFrameBlend;
    this.saturateColorPreAlphaBlend = saturateColorPreAlphaBlend;

    // Static combo shaders read the modulate-2x base texture as stored, so a stored half is the neutral,
    // rather than decoded from sRGB like any other layer
    const rawMod2xBase = !game.particleShaderFeatureBranching && this.blendMode === ParticleBlendMode.PARTICLE_OUTPUT_BLEND_MODE_MOD2X;
    this.baseTextureSrgbRead = this.texturesAreColor && !rawMod2xBase;

    const built = buildTextureLayers(parse, context.textures, defaultTextureName, this.texturesAreColor, this.baseTextureSrgbRead);
    this.layers = built.layers;
    this.motionVectors = built.motionVectors;
    this.cropsFrames = this.readCropsFrames(parse);

    const defines: Record<string, number> = { S_TEXTURE_LAYERS: this.layers.length - 1 };

    if (this.motionVectors !== null) {
      defines.S_MOTION_VECTORS = 1;
    }

    if (instancing !== 0) {
      defines.S_PARTICLE_INSTANCED = instancing;
    }

    if (this.wantsSceneColor) {
      defines.S_REFRACT = 1;
    }

    this.uniforms = createSpritecardUniforms(this.layers.length);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPRITECARD_VERTEX,
      fragmentShader: SPRITECARD_FRAGMENT,
      defines,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      // VRF disables culling and draws each card once. Three's two-pass transparency is
      // for closed meshes; cards and ribbons have the same shader on both faces.
      forceSinglePass: true,
      toneMapped: false,
      fog: false,
    });
    this.applyRenderState(this.material);

    this.mesh = new THREE.Mesh(this.createGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.name = `${this.className || this.constructor.name}: ${built.firstTextureName ?? defaultTextureName}`;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.onBeforeRender(renderer, camera);
  }

  /** The geometry the mesh draws, filled by updateVertices. */
  protected abstract createGeometry(): THREE.BufferGeometry;

  /** Whether the textures this renderer draws are colour, rather than data such as a refraction offset. */
  protected get texturesAreColor(): boolean {
    return this.outputIsColor && !this.refract;
  }

  override get wantsSceneDepth(): boolean {
    return this.featheringMode !== ParticleDepthFeatheringMode.PARTICLE_DEPTH_FEATHERING_OFF;
  }

  override get requiresSceneDepth(): boolean {
    return this.featheringMode === ParticleDepthFeatheringMode.PARTICLE_DEPTH_FEATHERING_ON_REQUIRED;
  }

  override get wantsSceneColor(): boolean {
    return this.refract && this.outputIsColor;
  }

  /** Whether the particles are alpha tested against a per particle threshold. */
  private get alphaTested(): boolean {
    return this.perParticleAlphaReference !== SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
  }

  /** The base texture's sheet, which maps the particles' sequence numbers to sequences. */
  override get spriteSheet(): ParticleSheet | null {
    return this.layers[0].texture.sheet;
  }

  override get objects(): readonly THREE.Object3D[] {
    return [this.mesh];
  }

  override setVisible(visible: boolean): void {
    this.visible = visible;
    this.mesh.visible = visible && this.quadCount > 0 && this.texturesReady();
  }

  /** Whether every texture the draw samples has arrived; VRF would sample a streaming texture's smallest mip instead. */
  private texturesReady(): boolean {
    return this.layers.every((layer) => layer.texture.texture !== null) && (this.motionVectors === null || this.motionVectors.texture !== null);
  }

  override updateBuffers(particles: ParticleCollection, state: ParticleSystemState, view: RenderView): void {
    for (const layer of this.layers) {
      layer.texture.resolve(this.context.maxAnisotropy);
    }

    this.motionVectors?.resolve(this.context.maxAnisotropy);

    this.diffuseAmount = this.diffuseAmountInput.nextNumber(state);
    this.quadCount = particles.count === 0 ? 0 : this.updateVertices(particles, state, view);

    if (this.quadCount > 0) {
      this.setRenderUniforms(state);
    }

    this.mesh.visible = this.visible && this.quadCount > 0 && this.texturesReady();
  }

  /** Fills the vertex buffer, returning how many quads it holds. */
  protected abstract updateVertices(particles: ParticleCollection, state: ParticleSystemState, view: RenderView): number;

  /** The uniforms Render sets for a draw. */
  private setRenderUniforms(state: ParticleSystemState): void {
    const u = this.uniforms;

    this.layers.forEach((layer, index) => {
      u[layerTextureNames[index]].value = layer.texture.texture;
    });

    bindTextureLayers(u as unknown as TextureLayerUniforms, this.layers, state, this.context.sheets, this.context.maxAnisotropy);
    this.bindMotionVectors(state);

    // Bound once every sheet of this draw is in, since adding one can replace the texture
    u.uSheetCache.value = this.context.sheets.texture ?? this.context.emptySheetCache;

    this.setSharedUniforms(state);
    u.uBlendFrames.value = this.blendFrames;
    u.uCropFrames.value = this.cropsFrames;

    // A manually animated particle's age is already its place in the sequence
    u.uAnimationRate.value = this.animationType === ParticleAnimationType.ANIMATION_TYPE_MANUAL_FRAMES ? 1 : this.animationRate;
    u.uAnimateInFps.value = this.animateInFps;
    u.uBlendMode.value = this.blendMode;

    this.setDrawUniforms(state);
  }

  /** Points the view uniforms at the camera drawing this frame. */
  private onBeforeRender(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const view = this.context.viewFor(camera);
    const u = this.uniforms;
    (u.g_vCameraPositionWs.value as THREE.Vector3).set(view.location.x, view.location.y, view.location.z);
    (u.g_vCameraDirWs.value as THREE.Vector3).set(view.forward.x, view.forward.y, view.forward.z);

    const sun = this.context.sunColor;
    (u.uSunColor.value as THREE.Vector3).set(sun[0], sun[1], sun[2]);

    const sceneDepth = this.context.sceneDepth;
    u.uHasSceneDepth.value = sceneDepth !== null;

    if (sceneDepth !== null) {
      u.uSceneDepth.value = sceneDepth.texture;
      (u.uSceneDepthNearFar.value as THREE.Vector2).set(sceneDepth.near * view.sourceUnitsPerViewerUnit, sceneDepth.far * view.sourceUnitsPerViewerUnit);
    }

    if (this.wantsSceneColor) {
      u.g_tSceneColor.value = this.context.sceneColor ?? this.context.blackTexture;
    }

    renderer.getDrawingBufferSize(drawingBuffer);
    (u.uViewportSize.value as THREE.Vector2).copy(drawingBuffer);
  }

  /**
   * Binds the motion vector sheet, where its sequences sit in the sheet cache, and how far a full
   * vector pushes, in units of the base texture.
   */
  private bindMotionVectors(state: ParticleSystemState): void {
    if (this.motionVectors === null) {
      return;
    }

    const baseTexture = this.layers[0].texture;
    const maxDistance = this.motionVectors.info?.motionVectorsMaxDistance ?? 0;
    const rows = this.context.sheets.getRows(this.motionVectors.sheet);
    const u = this.uniforms;

    u.uMotionVectors.value = this.motionVectors.texture;
    (u.uMotionVectorSheet.value as THREE.Vector2).set(rows.firstRow, rows.sequenceCount);
    (u.uMotionVectorScale.value as THREE.Vector2).set(
      (maxDistance * this.motionVectorScaleU.nextNumber(state)) / baseTexture.width,
      (maxDistance * this.motionVectorScaleV.nextNumber(state)) / baseTexture.height,
    );
  }

  /** Sets the uniforms only this renderer's draws read. Turns the outline and soft edges off unless overridden. */
  protected setDrawUniforms(_state: ParticleSystemState): void {
    this.uniforms.uOutline.value = false;
    (this.uniforms.uEdgeSoftness.value as THREE.Vector2).copy(NO_EDGE_SOFTNESS);
  }

  /** The scale and offset the shader remaps the sampled alpha by. */
  private getAlphaRemap(state: ParticleSystemState): [number, number] {
    const mapToZero = this.sourceAlphaValueToMapToZero.nextNumber(state);
    const mapToOne = this.sourceAlphaValueToMapToOne.nextNumber(state);
    return [1 / (mapToOne - mapToZero), -mapToZero];
  }

  /**
   * The state a spritecard draw runs under (SpritecardStateScope). The translucent pass leaves blend
   * and depth to each draw, so blending is enabled and depth writes stopped; an opaque renderer keeps
   * the pass defaults. Modulate-2x scales what is behind it, lighten keeps the brighter of the card and
   * what is behind it, and everything else composites premultiplied. Both faces are drawn. The lighten
   * blend mode keeps the depth test whatever the z buffering settings ask.
   */
  protected applyRenderState(material: THREE.Material): void {
    const depthSettings = this.blendMode !== ParticleBlendMode.PARTICLE_OUTPUT_BLEND_MODE_LIGHTEN;
    material.depthTest = !(depthSettings && this.disableZBuffering);
    // three.js draws with forward depth, where VRF's reverse-Z Farther is GreaterDepth
    material.depthFunc = depthSettings && !this.disableZBuffering && this.reverseZBuffering ? THREE.GreaterDepth : THREE.LessEqualDepth;

    if (this.pass === 'opaque') {
      material.transparent = false;
      material.blending = THREE.NoBlending;
      material.depthWrite = true;
      return;
    }

    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.CustomBlending;

    switch (this.blendMode) {
      case ParticleBlendMode.PARTICLE_OUTPUT_BLEND_MODE_MOD2X:
        material.blendSrc = THREE.DstColorFactor;
        material.blendDst = THREE.SrcColorFactor;
        material.blendEquation = THREE.AddEquation;
        break;
      case ParticleBlendMode.PARTICLE_OUTPUT_BLEND_MODE_LIGHTEN:
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneFactor;
        material.blendEquation = THREE.MaxEquation;
        break;
      default:
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneMinusSrcAlphaFactor;
        material.blendEquation = THREE.AddEquation;
    }

    // glBlendFunc sets the alpha factors along with the colour ones
    material.blendSrcAlpha = null;
    material.blendDstAlpha = null;
    material.blendEquationAlpha = null;
  }

  /** The random value of every particle, which the per particle modes spread per control. */
  protected static readParticleRandoms(particles: ParticleSpan, state: ParticleSystemState): Float32Array {
    const particleIds = particles.readIntegers(ParticleField.ParticleId);
    const randoms = new Float32Array(particles.length);

    for (let i = 0; i < randoms.length; i++) {
      randoms[i] = state.random.forParticle(particleIds[i], RANDOM_SLOT);
    }

    return randoms;
  }

  /** Uploads the shared source 2 renderer state every particle shader reads. */
  private setSharedUniforms(state: ParticleSystemState): void {
    const u = this.uniforms;

    u.uOverbrightFactor.value = this.overbrightFactor.nextNumber(state);
    // A literal amount at or below zero turns add-self off, which leaves the colour unscaled
    const addSelfDisabled = this.addSelfAmount instanceof LiteralNumberProvider && this.addSelfAmount.value <= 0;
    u.uAddSelfAmount.value = addSelfDisabled ? 1 : 1 + this.addSelfAmount.nextNumber(state);
    u.uDiffuseAmount.value = this.diffuseAmount;
    u.uSelfIllumAmount.value = this.selfIllumAmount.nextNumber(state);
    u.uDesaturation.value = saturate(this.desaturation.nextNumber(state));
    const hsv = this.getHsvShift(state);
    (u.uHsvShift.value as THREE.Vector3).set(hsv.x, hsv.y, hsv.z);
    const remap = this.getAlphaRemap(state);
    (u.uAlphaRemap.value as THREE.Vector2).set(remap[0], remap[1]);
    u.uGammaCorrectVertexColors.value = this.gammaCorrectVertexColors;
    u.uDepthBias.value = -this.depthBias.nextNumber(state);
    u.uMaxLuminanceFrameBlend.value = this.maxLuminanceFrameBlend;
    u.uSaturateColor.value = this.saturateColorPreAlphaBlend;
    u.uUnsignedBlendAlpha.value = this.unsignedBlendAlpha;
    u.uClampLayers.value = this.clampLayers;
    u.uLightingMode.value = this.lightingMode;

    u.uFeathering.value = this.wantsSceneDepth;

    if (this.wantsSceneDepth) {
      (u.uFeatheringRange.value as THREE.Vector2).set(this.featheringMinDist.nextNumber(state), this.featheringMaxDist.nextNumber(state));
    }

    u.uFeatheringFilter.value = this.featheringFilter.nextNumber(state);
    u.uAlphaReference.value = this.alphaTested;
    u.uAlphaReferenceMode.value = this.perParticleAlphaReference;
    u.uAlphaRefWindowMode.value = this.perParticleAlphaRefWindow;

    if (this.alphaTested) {
      const softness = this.alphaReferenceSoftness.nextNumber(state);
      const windowed = this.perParticleAlphaRefWindow !== SpriteCardPerParticleScale.SPRITECARD_TEXTURE_PP_SCALE_NONE;
      const type = this.alphaReferenceType;

      (u.uAlphaReferenceOpaque.value as THREE.Vector2).set(
        type === ParticleAlphaReferenceType.PARTICLE_ALPHA_REFERENCE_OPAQUE_ALPHA || type === ParticleAlphaReferenceType.PARTICLE_ALPHA_REFERENCE_OPAQUE_OPAQUE ? 1 : 0,
        type === ParticleAlphaReferenceType.PARTICLE_ALPHA_REFERENCE_ALPHA_OPAQUE || type === ParticleAlphaReferenceType.PARTICLE_ALPHA_REFERENCE_OPAQUE_OPAQUE ? 1 : 0,
      );
      (u.uAlphaReferenceSoftness.value as THREE.Vector2).set(windowed ? softness * 0.5 : 0, windowed ? softness * 0.5 : softness);
    }

    if (this.refract) {
      u.uRefractAmount.value = this.refractAmount.nextNumber(state);
      u.uRefractBlurRadius.value = this.refractBlurRadius;
      u.uRefractBlurBox.value = this.refractBlurType === BlurFilterType.BLURFILTER_BOX;
      u.uRefractSolid.value = this.refractSolid;
    }
  }

  /**
   * The age every particle plays its sheet by, as ageAnimationType measures it: the seconds it has
   * lived, the share of its life it has lived, or the passes through the sequence it was given by hand.
   */
  protected readSheetAges(particles: ParticleSpan): Float32Array {
    switch (this.ageAnimationType) {
      case ParticleAnimationType.ANIMATION_TYPE_FIT_LIFETIME: {
        const ages = particles.readAges();
        const lifetimes = particles.readFloats(ParticleField.LifeDuration);
        const lifeShares = new Float32Array(particles.length);

        for (let i = 0; i < lifeShares.length; i++) {
          // A particle without a lifetime stays at the start of its sequence
          lifeShares[i] = lifetimes[i] > 0 ? ages[i] / lifetimes[i] : 0;
        }

        return lifeShares;
      }
      case ParticleAnimationType.ANIMATION_TYPE_MANUAL_FRAMES:
        return particles.readFloats(ParticleField.ManualAnimationFrame);
      default:
        return particles.readAges();
    }
  }

  /**
   * The sequence a particle's sequence number plays, as the shader reads it. The number is rounded to
   * the nearest integer and, unless `rawIndices` is set, looked up as a sequence id of the first
   * layer's sheet, where an id the sheet does not have plays sequence 0.
   */
  protected sequenceLane(sequenceNumber: number, rawIndices: boolean): number {
    const number = roundToInt(sequenceNumber);
    const sheet = this.layers[0].texture.sheet;

    if (rawIndices || sheet === null) {
      // A raw index is handed over in 16 bits
      return (number << 16) >> 16;
    }

    return Math.max(getSequenceIndex(sheet, number), 0);
  }

  /**
   * The sequence every particle plays in place of its own, or -1 for none. The override is truncated
   * and always looked up as a sequence id of the first layer's sheet.
   */
  protected overrideSequence(sequenceOverride: number): number {
    const number = Math.trunc(sequenceOverride) | 0;
    const sheet = this.layers[0].texture.sheet;

    if (number === -1 || sheet === null) {
      return -1;
    }

    return Math.max(getSequenceIndex(sheet, number), 0);
  }

  /**
   * Whether the first layer's sheet frames are cropped to their art, as m_nCropTextureOverride asks,
   * or by default when no later layer would be cut by it.
   */
  private readCropsFrames(parse: ParticleDefinitionParser): boolean {
    switch (parse.enum('m_nCropTextureOverride', ParticleSequenceCropOverride, ParticleSequenceCropOverride.PARTICLE_SEQUENCE_CROP_OVERRIDE_DEFAULT)) {
      case ParticleSequenceCropOverride.PARTICLE_SEQUENCE_CROP_OVERRIDE_DEFAULT:
        return this.layers.slice(1).every((layer) => layer.effectMode === SpriteCardTextureType.SPRITECARD_TEXTURE_1D_COLOR_LOOKUP);
      case ParticleSequenceCropOverride.PARTICLE_SEQUENCE_CROP_OVERRIDE_FORCE_ON:
        return true;
      default:
        return false;
    }
  }

  /** Whether the view angle fade can take anything away, which needs its start below 1 and its end past the start. */
  protected get fadesByViewAngle(): boolean {
    return this.startFadeDot < 1 && this.endFadeDot > this.startFadeDot;
  }

  /** Turns the shader's view angle fade on or off; when on, it fades over the start and end dots. */
  protected setViewAngleFadeUniforms(active: boolean): void {
    this.uniforms.uViewAngleFade.value = active;
    (this.uniforms.uViewAngleFadeDots.value as THREE.Vector2).set(this.startFadeDot, this.endFadeDot);
  }

  /** Sets the size clamp and the distance fade, each bound a radius per unit of camera distance, or turns both off. */
  protected setSizeClampAndFadeUniforms(active: boolean, minSize: number, startFadeSize: number, endFadeSize: number, maxSize: number): void {
    this.uniforms.uSizeClampAndFade.value = active;
    (this.uniforms.uSizeBounds.value as THREE.Vector4).set(minSize, startFadeSize, endFadeSize, maxSize);
  }

  /**
   * The unit axis across a ribbon that runs along the unit `direction` and lies flat in the plane
   * facing `planeNormal`. When the two are parallel the ribbon turns about world Z instead, or about
   * world X while it runs nearly vertical.
   */
  protected static ribbonWidthAxis(direction: Vector3, planeNormal: Vector3): Vector3 {
    const widthAxis = cross(direction, planeNormal);

    if (widthAxis.lengthSquared() > MINIMUM_LENGTH_SQUARED) {
      return normalize(widthAxis);
    }

    const reference = Math.abs(direction.z) < MAX_RIBBON_VERTICAL_SHARE ? Vector3.unitZ : Vector3.unitX;
    const fallback = cross(direction, reference);
    return fallback.lengthSquared() > 0 ? safeNormalize(fallback) : Vector3.unitX;
  }

  override dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();

    for (const layer of this.layers) {
      layer.texture.dispose();
    }

    this.motionVectors?.dispose();
  }
}

const drawingBuffer = new THREE.Vector2();

/** Every uniform the spritecard shaders declare, at the defaults their GLSL 4.60 initializers give. */
function createSpritecardUniforms(layerCount: number): Uniforms {
  const perLayer = <T>(make: () => T) => Array.from({ length: Math.max(layerCount, 1) }, make);

  return {
    g_vCameraPositionWs: { value: new THREE.Vector3() },
    g_vCameraDirWs: { value: new THREE.Vector3(1, 0, 0) },
    uSunColor: { value: new THREE.Vector3() },
    uGammaCorrectVertexColors: { value: true },
    uDepthBias: { value: 0 },
    uSizeClampAndFade: { value: false },
    uSizeBounds: { value: new THREE.Vector4(0, 1, 2, 1) },
    uViewAngleFade: { value: false },
    uViewAngleFadeDots: { value: new THREE.Vector2(1, 2) },
    uCenterOffset: { value: new THREE.Vector2(0, 0) },
    uRopeVMapping: { value: new THREE.Vector2(0, 1) },
    uClampV: { value: false },
    uTrailHeadColorScale: { value: new THREE.Vector3(1, 1, 1) },
    uTrailTailColorScale: { value: new THREE.Vector3(1, 1, 1) },
    uLayerUvScaleOffset: { value: perLayer(() => new THREE.Vector4(1, 1, 0, 0)) },
    uLayerUvRotation: { value: perLayer(() => 0) },
    uLayerPerParticleModes: { value: perLayer(() => 0) },
    uLayerLookup: { value: perLayer(() => false) },
    uLayerBorder: { value: perLayer(() => new THREE.Vector2(0, 0)) },
    uLayerAnisotropy: { value: perLayer(() => 0) },
    uAnyLayerHasSheet: { value: false },
    uAlphaReferenceMode: { value: 0 },
    uAlphaRefWindowMode: { value: 0 },
    uAlphaReference: { value: false },
    uSheetCache: { value: null },
    uLayerSheet: { value: perLayer(() => new THREE.Vector2(0, 0)) },
    uMotionVectorSheet: { value: new THREE.Vector2(0, 0) },
    uFrameZoom: { value: new THREE.Vector2(1, 1) },
    uAnimationRate: { value: 1 },
    uAnimateInFps: { value: false },
    uCropFrames: { value: false },
    uBlendMode: { value: 0 },
    uTexture: { value: null },
    uTextureLayer1: { value: null },
    uTextureLayer2: { value: null },
    uTextureLayer3: { value: null },
    uTextureLayer4: { value: null },
    uMotionVectors: { value: null },
    uMotionVectorScale: { value: new THREE.Vector2(0, 0) },
    uOverbrightFactor: { value: 1 },
    uAddSelfAmount: { value: 1 },
    uDiffuseAmount: { value: 1 },
    uSelfIllumAmount: { value: 0 },
    uDesaturation: { value: 0 },
    uBlendFrames: { value: true },
    uMaxLuminanceFrameBlend: { value: false },
    uLightingMode: { value: 0 },
    uHsvShift: { value: new THREE.Vector3(0, 1, 1) },
    uAlphaRemap: { value: new THREE.Vector2(1, 0) },
    uEdgeSoftness: { value: NO_EDGE_SOFTNESS.clone() },
    uOutline: { value: false },
    uOutlineColor: { value: new THREE.Vector4(1, 1, 1, 1) },
    uOutlineRanges: { value: new THREE.Vector4(0.5, 0.7, 0.6, 0.8) },
    uFeathering: { value: false },
    uFeatheringRange: { value: new THREE.Vector2(0, 0) },
    uFeatheringFilter: { value: 1 },
    uHasSceneDepth: { value: false },
    uSceneDepth: { value: null },
    uSceneDepthNearFar: { value: new THREE.Vector2(1, 1000) },
    uViewportSize: { value: new THREE.Vector2(1, 1) },
    uSaturateColor: { value: true },
    uUnsignedBlendAlpha: { value: false },
    uClampLayers: { value: false },
    uAlphaReferenceOpaque: { value: new THREE.Vector2(0, 0) },
    uAlphaReferenceSoftness: { value: new THREE.Vector2(0, 0) },
    g_tSceneColor: { value: null },
    uRefractAmount: { value: 1 },
    uRefractBlurRadius: { value: 0 },
    uRefractBlurBox: { value: false },
    uRefractSolid: { value: false },
    uLayerCount: { value: 1 },
    uLayerChannels: { value: perLayer(() => 0) },
    uLayerBlendMode: { value: perLayer(() => 0) },
    uLayerBlend: { value: perLayer(() => 1) },
    uLayerEffectMode: { value: perLayer(() => 0) },
    uLayerDistortion: { value: perLayer(() => 0) },
    uLayerZoomScale: { value: perLayer(() => 0) },
  };
}

function saturate(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** MathF.Round to an int: halves to even. */
function roundToInt(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  const rounded = diff > 0.5 || (diff === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
  return rounded | 0;
}

export { MAX_LAYERS };
