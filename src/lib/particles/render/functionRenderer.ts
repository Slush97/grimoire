// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/ParticleFunctionRenderer.cs and
// Renderer/Particles/Renderers/ParticleVisibilityInputs.cs.
//
// The base of every particle renderer, which draws a particle collection each frame.

import type * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleEventType, ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { ParticleFunction } from '../functions';
import { type KVObject, isCollection } from '../kv';
import { Vector3, distanceSquared, safeNormalize } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';
import { applyColorBlend, convertColorScale, toBytes, type Rgba } from './colorBlend';
import { ParticleColorBlendType, ParticleSortingChoiceList } from './enums';
import type { ParticleSheet } from './sheet';
import type { RenderView } from './view';

/** The renderer scales, evaluated once for a draw of the whole collection. */
export interface RendererScales {
  /** Scales every particle's radius. */
  radius: number;
  /** Scales every particle's alpha. */
  alpha: number;
  /** Scales every particle's roll. */
  roll: number;
  /** The colour scale converted for applyColorBlend, with the alpha scale in [3]. */
  color: Rgba;
  /** Scales every particle's alpha by how the camera sees the visibility control point, before the alpha is clamped. */
  visibleAlpha: number;
}

/** What a renderer contributes to the scene a host draws: the objects it adds under the system's root. */
export interface RendererOutput {
  /** The objects this renderer draws through, which the tree renderer parents and orders. */
  readonly objects: readonly THREE.Object3D[];
}

/**
 * Scales a renderer's alpha and radius for a whole draw by how the camera sees a control point: its
 * distance from the camera and the angle between them, each remapped to 0 to 1 and multiplied
 * together, then taken from the minimum to the maximum scale. There is no occlusion query, so the
 * control point always counts as fully in view.
 */
export class ParticleVisibilityInputs {
  private readonly controlPoint: number = -1;
  private readonly proxyRadius: number = 1;
  private readonly inputMin: number = 0;
  private readonly inputMax: number = 1;
  private readonly distanceInputMin: number = 0;
  private readonly distanceInputMax: number = 0;
  private readonly dotInputMin: number = 0;
  private readonly dotInputMax: number = 0;
  private readonly dotControlPointAngles: boolean = true;
  private readonly dotCameraAngles: boolean = false;
  private readonly alphaScaleMin: number = 0;
  private readonly alphaScaleMax: number = 1;
  private readonly radiusScaleMin: number = 1;
  private readonly radiusScaleMax: number = 1;
  private readonly radiusScaleFovBase: number = 0;

  /** How far each particle is drawn moved toward the camera, in world units. */
  readonly cameraBias: number = 0;

  constructor(parse?: ParticleDefinitionParser) {
    if (!parse) {
      return;
    }

    this.cameraBias = parse.float('m_flCameraBias', this.cameraBias);
    this.controlPoint = parse.int32('m_nCPin', this.controlPoint);
    this.proxyRadius = parse.float('m_flProxyRadius', this.proxyRadius);
    this.inputMin = parse.float('m_flInputMin', this.inputMin);
    this.inputMax = parse.float('m_flInputMax', this.inputMax);
    this.distanceInputMin = parse.float('m_flDistanceInputMin', this.distanceInputMin);
    this.distanceInputMax = parse.float('m_flDistanceInputMax', this.distanceInputMax);
    this.dotInputMin = parse.float('m_flDotInputMin', this.dotInputMin);
    this.dotInputMax = parse.float('m_flDotInputMax', this.dotInputMax);
    this.dotControlPointAngles = parse.boolean('m_bDotCPAngles', this.dotControlPointAngles);
    this.dotCameraAngles = parse.boolean('m_bDotCameraAngles', this.dotCameraAngles);
    this.alphaScaleMin = parse.float('m_flAlphaScaleMin', this.alphaScaleMin);
    this.alphaScaleMax = parse.float('m_flAlphaScaleMax', this.alphaScaleMax);
    this.radiusScaleMin = parse.float('m_flRadiusScaleMin', this.radiusScaleMin);
    this.radiusScaleMax = parse.float('m_flRadiusScaleMax', this.radiusScaleMax);
    this.radiusScaleFovBase = parse.float('m_flRadiusScaleFOVBase', this.radiusScaleFovBase);
  }

  /** Whether a visibility control point is set. */
  get hasControlPoint(): boolean {
    return this.controlPoint >= 0;
  }

  /** The alpha and radius scales for a draw seen from `view`. Both are 1 when neither a control point nor a radius FOV base is set. */
  evaluate(state: ParticleSystemState, view: RenderView): { alpha: number; radius: number } {
    if (this.controlPoint < 0 && this.radiusScaleFovBase <= 0) {
      return { alpha: 1, radius: 1 };
    }

    let visibility = 1;

    if (this.controlPoint >= 0) {
      const point = state.getControlPoint(this.controlPoint);
      const toPoint = point.position.sub(view.location);

      // The game multiplies the query result by the proxy radius remapped over the input range, not
      // by the remapped result; the result itself counts as fully visible here
      if (this.inputMin !== this.inputMax) {
        visibility = remapClamped(this.proxyRadius, this.inputMin, this.inputMax);
      }

      if (this.dotInputMin !== this.dotInputMax) {
        const from = this.dotCameraAngles ? view.forward : safeNormalize(toPoint);
        const to = this.dotControlPointAngles ? point.forward : safeNormalize(toPoint.negate());
        visibility *= remapClamped(from.dot(to), this.dotInputMin, this.dotInputMax);
      }

      if (this.distanceInputMin !== this.distanceInputMax) {
        visibility *= remapClamped(toPoint.length(), this.distanceInputMin, this.distanceInputMax);
      }
    }

    return {
      alpha: this.alphaScaleMin + (this.alphaScaleMax - this.alphaScaleMin) * visibility,
      radius: this.radiusScaleMin + (this.radiusScaleMax - this.radiusScaleMin) * visibility,
    };
  }
}

function remapClamped(value: number, inputMin: number, inputMax: number): number {
  const t = (value - inputMin) / (inputMax - inputMin);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** RenderPass: the pass a renderer draws in. */
export type RendererPass = 'opaque' | 'translucent';

export abstract class ParticleFunctionRenderer extends ParticleFunction {
  /** Scales the radius every particle is drawn at. */
  protected readonly radiusScale: NumberProvider;
  /** Scales the alpha every particle is drawn at. */
  protected readonly alphaScale: NumberProvider;
  /** Scales the roll every particle is drawn at. */
  protected readonly rollScale: NumberProvider;
  /** Scales the colour every particle is drawn at, combined as colorBlendType asks. */
  protected readonly colorScale: VectorProvider;
  /** How colorScale combines with each particle's colour. */
  protected readonly colorBlendType: number;
  /** The attribute that scales each particle's alpha alongside its own, or ParticleField.NoneDisabled for none. */
  protected readonly alpha2Field: number;

  /** How the camera's view of a control point scales the draw, and how far particles are drawn toward the camera. */
  private readonly visibility: ParticleVisibilityInputs;

  /** Control point carrying a hue shift, saturation and lightness scale. Negative for none. */
  protected readonly hsvShiftControlPoint: number;

  /** The order the particles are drawn in. */
  private readonly sortMethod: number;

  /** Whether this renderer draws only into the water effects map, never into the scene. */
  readonly onlyRenderInEffectsWaterPass: boolean;

  /** Render in the bloom effects. */
  readonly onlyRenderInEffectsBloomPass: boolean;

  /** The pass this renderer draws in. */
  pass: RendererPass = 'translucent';

  /**
   * Whether the renderer runs. One that does not neither evaluates its inputs nor draws, as though it
   * had never been created, though it still told the simulation what it reads. For isolating one
   * renderer of a tree while comparing.
   */
  enabled = true;

  /** Whether this renderer draws itself into the depth only pass. Set alongside `pass`. */
  canRenderDepth = false;

  /** Whether this renderer is lit by the scene: it is, unless it draws into the water effects map. */
  protected readonly litByScene: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);

    this.onlyRenderInEffectsWaterPass = parse.boolean('m_bOnlyRenderInEffectsWaterPass', false);
    this.onlyRenderInEffectsBloomPass = parse.boolean('m_bOnlyRenderInEffectsBloomPass', false);
    this.radiusScale = parse.numberProvider('m_flRadiusScale', new LiteralNumberProvider(1));
    this.alphaScale = parse.numberProvider('m_flAlphaScale', new LiteralNumberProvider(1));
    this.rollScale = parse.numberProvider('m_flRollScale', new LiteralNumberProvider(1));
    this.colorScale = parse.vectorProvider('m_vecColorScale', new LiteralVectorProvider(Vector3.one));
    this.colorBlendType = parse.enum('m_nColorBlendType', ParticleColorBlendType, ParticleColorBlendType.PARTICLE_COLOR_BLEND_MULTIPLY);
    this.alpha2Field = parse.particleField('m_nAlpha2Field', ParticleField.AlphaAlternate);

    const visibilityInputs = parse.data.VisibilityInputs;
    this.visibility = isCollection(visibilityInputs)
      ? new ParticleVisibilityInputs(parse.nested(visibilityInputs as KVObject))
      : new ParticleVisibilityInputs();

    this.sortMethod = parse.enum('m_nSortMethod', ParticleSortingChoiceList, ParticleSortingChoiceList.PARTICLE_SORTING_NEAREST);
    this.hsvShiftControlPoint = parse.int32('m_nHSVShiftControlPoint', -1);
    this.litByScene = !this.onlyRenderInEffectsWaterPass;
  }

  /** Whether what this renderer draws is an image; the water effects map takes data instead. */
  protected get outputIsColor(): boolean {
    return !this.onlyRenderInEffectsWaterPass;
  }

  /**
   * The bit mask over ParticleField of the attributes this renderer blends between two steps besides
   * those every renderer blends: its alpha2Field.
   */
  get blendedFields(): bigint {
    return isScalarField(this.alpha2Field) ? fieldMask(this.alpha2Field) : 0n;
  }

  /** How far each particle is drawn moved toward the camera, in world units. */
  protected get cameraBias(): number {
    return this.visibility.cameraBias;
  }

  /** Whether this renderer samples the opaque scene depth. */
  get wantsSceneDepth(): boolean {
    return false;
  }

  /** Whether this renderer samples the opaque scene colour. */
  get wantsSceneColor(): boolean {
    return false;
  }

  /** Whether this renderer draws in the passes of the system: renderers that place lights or models do not. */
  get drawsInPasses(): boolean {
    return true;
  }

  /** The sheet this renderer animates its particles with, or null when the textures it draws with carry none. */
  get spriteSheet(): ParticleSheet | null {
    return null;
  }

  /** The particle events this renderer wants through onParticleEvent. */
  get observedEvents(): number {
    return ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;
  }

  /**
   * The hue shift, saturation and lightness scale carried by hsvShiftControlPoint, or the identity
   * when no control point is bound. The control point holds the two scales less one, so a zeroed one
   * is the identity too.
   */
  protected getHsvShift(state: ParticleSystemState): Vector3 {
    return this.hsvShiftControlPoint >= 0 ? state.getControlPoint(this.hsvShiftControlPoint).position.add(new Vector3(0, 1, 1)) : new Vector3(0, 1, 1);
  }

  /** Evaluates the renderer scales for one draw, with the radius scaled and visibleAlpha set by how `view` sees the visibility control point. */
  protected evaluateScales(state: ParticleSystemState, view?: RenderView): RendererScales {
    // In the order VRF evaluates them, which a random input draws in
    const alpha = this.alphaScale.nextNumber(state);
    const radius = this.radiusScale.nextNumber(state);
    const roll = this.rollScale.nextNumber(state);
    const color = convertColorScale(this.colorBlendType, vectorToRgb(this.colorScale.nextVector(state)));
    const scales: RendererScales = { radius, alpha, roll, color: [color[0], color[1], color[2], alpha], visibleAlpha: 1 };

    if (view) {
      const visible = this.visibility.evaluate(state, view);
      scales.radius *= visible.radius;
      scales.visibleAlpha = visible.alpha;
    }

    return scales;
  }

  /** The alpha and radius scales of the visibility control point as `view` sees it, or 1 for both when none is set. */
  protected evaluateControlPointVisibility(state: ParticleSystemState, view: RenderView): { alpha: number; radius: number } {
    return this.visibility.hasControlPoint ? this.visibility.evaluate(state, view) : { alpha: 1, radius: 1 };
  }

  /** A particle's position moved toward the camera by cameraBias. */
  protected biasTowardCamera(position: Vector3, cameraPosition: Vector3): Vector3 {
    return this.cameraBias === 0 ? position : position.add(safeNormalize(cameraPosition.sub(position)).scale(this.cameraBias));
  }

  /** The alpha2Field of every particle, or 1 for each when none is set. */
  protected readAlpha2(particles: ParticleSpan): Float32Array {
    if (this.alpha2Field === ParticleField.NoneDisabled || this.alpha2Field < 0) {
      return new Float32Array(particles.length).fill(1);
    }

    return particles.readFloats(this.alpha2Field);
  }

  private readonly blendScratch: Rgba = [0, 0, 0, 0];

  /**
   * A particle's colour and alpha combined with the colour and alpha scale, in 0 to 1, written to
   * `out`. The alpha is taken with its alpha2Field value, `alphaPrescale` and the visible alpha, and
   * both are clamped to bytes before they combine.
   */
  protected blendColor(r: number, g: number, b: number, alpha: number, alpha2: number, scales: RendererScales, out: Rgba, alphaPrescale = 1): Rgba {
    toBytes(r, g, b, alphaPrescale * alpha * alpha2 * scales.visibleAlpha, this.blendScratch);
    applyColorBlend(this.colorBlendType, this.blendScratch, scales.color, out);
    out[0] /= 255;
    out[1] /= 255;
    out[2] /= 255;
    out[3] /= 255;
    return out;
  }

  /** Whether the particles are drawn farthest from the camera first rather than newest first. */
  protected get sortsByDistance(): boolean {
    return this.sortMethod === ParticleSortingChoiceList.PARTICLE_SORTING_NEAREST;
  }

  /**
   * The particle indices farthest from the camera first. Coincident particles keep a steady order,
   * lower index first, as VRF's sorted keys of inverted distance bits and index do.
   */
  protected static sortBackToFront(particles: ParticleSpan, cameraPosition: Vector3): number[] {
    const positions = particles.readVectors(ParticleField.Position);
    const distances = new Float32Array(particles.length);
    const order: number[] = [];

    for (let i = 0; i < particles.length; i++) {
      distances[i] = distanceSquared(new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]), cameraPosition);
      order.push(i);
    }

    return order.sort((a, b) => distances[b] - distances[a] || a - b);
  }

  /**
   * The particles as they stand at the time the system was asked to reach. That is the current
   * span, unless the last step carried the system past that time: then each particle is blended back
   * from its state before the step.
   */
  protected static getBlendedParticles(particles: ParticleCollection, state: ParticleSystemState): ParticleSpan {
    return blendedParticles(particles, state);
  }

  /** Called as the system finishes each step of a frame. */
  simulate(_particles: ParticleCollection, _state: ParticleSystemState): void {}

  /** Called once the initializers have run over particles the system just created. */
  initializeParticles(_particles: ParticleCollection, _state: ParticleSystemState, _first: number, _count: number): void {}

  /** Called when particles of the system raise an event, during the step. */
  onParticleEvent(_particles: ParticleCollection, _eventType: number, _indices: readonly number[]): void {}

  /** Finishes work done on simulate, for what reaches past the system. */
  act(_particles: ParticleCollection, _state: ParticleSystemState): void {}

  /** Called in place of act while the system does not draw. */
  hide(_particles: ParticleCollection): void {}

  /** Fills this renderer's draw for the frame. Called once a frame, before anything draws. */
  abstract updateBuffers(particles: ParticleCollection, state: ParticleSystemState, view: RenderView): void;

  /** Shows or hides the objects this renderer draws through for the frame. */
  abstract setVisible(visible: boolean): void;

  /** The objects this renderer draws through, added under the system's root in draw order. */
  abstract get objects(): readonly THREE.Object3D[];

  dispose(): void {}
}

function vectorToRgb(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

/**
 * ParticleCollection.Blended over ParticleSystemSimulation.TryGetRenderBlend. Only an overshooting
 * step needs it, which a host stepping by whole frames below the system's maximum step never makes.
 */
function blendedParticles(particles: ParticleCollection, _state: ParticleSystemState): ParticleSpan {
  return particles.currentSpan;
}

