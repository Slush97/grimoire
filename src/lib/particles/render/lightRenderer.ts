// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/ParticleLightRenderer.cs and
// Renderer/Particles/Renderers/ParticleLightPool.cs.
//
// A renderer that places lights in the scene rather than drawing geometry. VRF hands each light to
// its scene as a SceneLight; here each one is a three.js light under the renderer's group, which the
// host's scene lighting then picks up. Particles themselves are never lit by these, as VRF's are not
// in a scene without light probes.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ParticleFunctionRenderer } from './functionRenderer';
import type { RenderView } from './view';

/** SceneLight.LinearBrightnessDistance: the distance in Source units at which a light gives its linear brightness. */
export const LINEAR_BRIGHTNESS_DISTANCE = 100;

/** ParticleLightPool.LightState: what one particle's light is set to. Colours are gamma encoded. */
export interface ParticleLightState {
  color: [number, number, number];
  linearBrightness: number;
  brightnessScale: number;
  /** In Source units; 0 for none. */
  range: number;
  /** The spot cone's inner and outer angles in degrees; 0 and 180 for a point light. */
  spotInnerAngle: number;
  spotOuterAngle: number;
  luminaireSize: number;
  fallOff: number;
  /** Where the light is, in Source space. */
  position: THREE.Vector3;
  /** The unit direction a spot light points (the transform's first row). */
  direction: THREE.Vector3;
  /** Half the length of a capsule's tube, 0 for a point. */
  tubeHalfLength: number;
}

class LightSlot {
  particleId = 0;
  inUse = false;
  touched = false;
  state: ParticleLightState | null = null;
  light: THREE.PointLight | THREE.SpotLight | null = null;
}

/**
 * The lights a renderer places, one slot per particle it lights, each following its particle by id.
 * A slot left untouched by a step is let go.
 */
export class ParticleLightPool {
  private readonly slots: LightSlot[] = [];
  readonly group = new THREE.Group();
  private readonly spot: boolean;

  /** Scales light intensities from Source units to the viewer's, set by the renderer each frame. */
  viewerUnitsPerSourceUnit = 1;

  constructor(spot: boolean) {
    this.spot = spot;
    this.group.name = 'particle lights';
  }

  beginStep(count: number): void {
    while (this.slots.length < count) {
      this.slots.push(new LightSlot());
    }

    for (const slot of this.slots) {
      slot.touched = false;
    }
  }

  claim(particleId: number): LightSlot | null {
    let free: LightSlot | null = null;

    for (const slot of this.slots) {
      if (slot.inUse && slot.particleId === particleId) {
        return slot;
      }

      if (!slot.inUse) {
        free ??= slot;
      }
    }

    if (free !== null) {
      free.inUse = true;
      free.particleId = particleId;
    }

    return free;
  }

  endStep(): void {
    for (const slot of this.slots) {
      if (!slot.touched) {
        slot.inUse = false;
      }
    }
  }

  releaseAll(): void {
    for (const slot of this.slots) {
      slot.inUse = false;
    }
  }

  /** The state of every light in use, for hosts that light by other means. */
  get states(): ParticleLightState[] {
    return this.slots.filter((slot) => slot.inUse && slot.state !== null).map((slot) => slot.state!);
  }

  /** Puts every light where its slot says, and turns off those not in use. */
  apply(): void {
    for (const slot of this.slots) {
      if (slot.light === null) {
        if (!slot.inUse) {
          continue;
        }

        slot.light = this.spot ? new THREE.SpotLight() : new THREE.PointLight();
        slot.light.decay = 2;
        this.group.add(slot.light);

        if (slot.light instanceof THREE.SpotLight) {
          this.group.add(slot.light.target);
        }
      }

      const light = slot.light;
      const state = slot.state;

      if (!slot.inUse || state === null) {
        light.intensity = 0;
        continue;
      }

      applyLightState(light, state, this.viewerUnitsPerSourceUnit);
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.light?.dispose();
    }

    this.group.clear();
    this.slots.length = 0;
  }
}

/**
 * Sets a three.js light to a particle light's state. VRF's lights shade with the gamma-decoded colour
 * times linearBrightness * brightnessScale * (100 / d)^2 at distance d, and without the 1/pi of
 * three.js's Lambert term, so the intensity carries pi and the reference distance in viewer units. A
 * spot's cone takes half the outer angle and softens over the inner one; a capsule shines from the
 * middle of its tube. three.js lights end smoothly at their distance where VRF's are cut.
 */
export function applyLightState(light: THREE.PointLight | THREE.SpotLight, state: ParticleLightState, viewerUnitsPerSourceUnit: number): void {
  const reference = LINEAR_BRIGHTNESS_DISTANCE * viewerUnitsPerSourceUnit;

  // Lights stay visible and go dark at intensity 0: three.js recompiles every lit material when the
  // number of visible lights changes, which stalls a frame each time a particle light comes or goes
  light.color.setRGB(srgbToLinear(state.color[0]), srgbToLinear(state.color[1]), srgbToLinear(state.color[2]), THREE.LinearSRGBColorSpace);
  light.intensity = state.brightnessScale > 0 && state.linearBrightness > 0 ? Math.PI * state.linearBrightness * state.brightnessScale * reference * reference : 0;
  // three.js reads the cut-off distance in world units, unscaled by the light's parents
  light.distance = state.range > 0 ? state.range * viewerUnitsPerSourceUnit : 0;
  light.position.copy(state.position);

  if (light instanceof THREE.SpotLight) {
    const outer = THREE.MathUtils.degToRad(Math.min(state.spotOuterAngle, 179) * 0.5);
    light.angle = outer;
    light.penumbra = state.spotOuterAngle > 0 ? THREE.MathUtils.clamp(1 - state.spotInnerAngle / state.spotOuterAngle, 0, 1) : 0;
    light.target.position.copy(state.position).add(state.direction);
  }
}

function srgbToLinear(c: number): number {
  return c > 0.04045 ? Math.pow(c / 1.055 + 0.0521327, 2.4) : c / 12.92;
}

export abstract class ParticleLightRenderer extends ParticleFunctionRenderer {
  private readonly maxAllowed: number;
  private drawn = false;
  protected readonly lights: ParticleLightPool;

  /** Scales every particle's alpha by how the camera sees the visibility control point, as of the last draw. */
  protected visibleAlpha = 1;
  protected visibleRadius = 1;

  protected constructor(parse: ParticleDefinitionParser, spot: boolean) {
    super(parse);
    this.lights = new ParticleLightPool(spot);
    this.maxAllowed = parse.int32('m_nMaxAllowed', 32);
  }

  protected lightCount(particleCount: number): number {
    return Math.min(particleCount, this.maxAllowed);
  }

  /** Writes every light's state for the step, returning false to keep the lights of the last one. */
  protected abstract updateLights(particles: ParticleCollection, state: ParticleSystemState): boolean;

  override get objects(): readonly THREE.Object3D[] {
    return [this.lights.group];
  }

  override get drawsInPasses(): boolean {
    return false;
  }

  /** The lights in use, in Source space, for hosts that light by other means than three.js lights. */
  get lightStates(): ParticleLightState[] {
    return this.lights.states;
  }

  override hide(): void {
    this.lights.releaseAll();
    this.lights.apply();
  }

  override act(): void {
    this.lights.apply();
  }

  override simulate(particles: ParticleCollection, state: ParticleSystemState): void {
    this.lights.beginStep(this.lightCount(particles.count));

    if (this.getOperatorRunStrength(state) <= 0) {
      this.lights.releaseAll();
      return;
    }

    if (this.drawn && !this.updateLights(particles, state)) {
      return;
    }

    this.lights.endStep();
    this.drawn = false;
  }

  /** Render: reads how the camera sees the visibility control point, and marks the lights drawn. */
  override updateBuffers(_particles: ParticleCollection, state: ParticleSystemState, view: RenderView): void {
    const visibility = this.evaluateControlPointVisibility(state, view);
    this.visibleAlpha = visibility.alpha;
    this.visibleRadius = visibility.radius;
    this.drawn = true;
    this.lights.viewerUnitsPerSourceUnit = 1 / view.sourceUnitsPerViewerUnit;
  }

  override setVisible(): void {
    // Lights shine whether or not the renderer draws, and a light without a particle is already dark
    // (intensity 0); hiding the group would change three.js's light count and recompile lit materials
    this.lights.group.visible = true;
  }

  override dispose(): void {
    this.lights.dispose();
  }
}
