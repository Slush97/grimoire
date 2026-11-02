// Ported from ValveResourceFormat (MIT): Renderer/Particles/ParticleRenderer.cs and
// Renderer/Particles/ParticleRendererFactory.cs.
//
// Draws a ParticleSystemSimulation. One of these mirrors each system in the simulation's child tree
// and owns only the renderers that system draws through. Particles, control points and timing belong
// to the simulation it watches.

import type * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleEventType } from '../enums';
import { type KVObject, getObjectArray, getString } from '../kv';
import { FLOAT_MAX, Vector3, distanceSquared } from '../numerics';
import { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemObserver, ParticleSystemSimulation } from '../simulation';
import type { ParticleSystemState } from '../state';
import type { ParticleRendererContext } from './context';
import type { ParticleFunctionRenderer } from './functionRenderer';
import { RenderModels } from './renderModels';
import { RenderOmni2Light } from './renderOmni2Light';
import { RenderRopes } from './renderRopes';
import { RenderSprites } from './renderSprites';
import { RenderStandardLight } from './renderStandardLight';
import { RenderTrails } from './renderTrails';
import { getSequenceIndex, sequenceIdCount } from './sheet';
import type { RenderView } from './view';

type RendererConstructor = (parse: ParticleDefinitionParser, context: ParticleRendererContext) => ParticleFunctionRenderer;

/** The renderer classes this port draws, by Source 2 class name. */
const RENDERERS = new Map<string, RendererConstructor>([
  ['C_OP_RenderSprites', (parse, context) => new RenderSprites(parse, context)],
  ['C_OP_RenderRopes', (parse, context) => new RenderRopes(parse, context)],
  ['C_OP_RenderTrails', (parse, context) => new RenderTrails(parse, context)],
  ['C_OP_RenderStandardLight', (parse) => new RenderStandardLight(parse)],
  ['C_OP_RenderOmni2Light', (parse) => new RenderOmni2Light(parse)],
  ['C_OP_RenderModels', (parse, context) => new RenderModels(parse, context)],
]);

/** Renderers that draw nothing in the viewer, so they are created as no-ops rather than reported. */
const GAME_ONLY = new Set([
  'C_OP_ClientPhysics',
  'C_OP_RenderGpuImplicit',
  'C_OP_RenderScreenShake',
  'C_OP_RenderStatusEffect',
  'C_OP_RenderStatusEffectCitadel',
  'C_OP_RenderText',
  'C_OP_RenderTonemapController',
  'C_OP_RenderTreeShake',
  'C_OP_RenderVRHapticEvent',
  'C_OP_RenderSound',
]);

/** Registers a renderer class; the port of each renderer file adds itself here. */
export function registerRenderer(className: string, create: RendererConstructor): void {
  RENDERERS.set(className, create);
}

/** Whether a renderer class is drawn (or deliberately draws nothing) by this port. */
export function isRendererSupported(className: string): boolean {
  return RENDERERS.has(className) || GAME_ONLY.has(className);
}

export class ParticleRenderer implements ParticleSystemObserver {
  private readonly renderers: ParticleFunctionRenderer[] = [];
  private readonly childRenderers: ParticleRenderer[] = [];
  private readonly skippedRendererClasses: string[] = [];

  /** The system this draws. */
  readonly simulation: ParticleSystemSimulation;

  readonly observedEvents: number = ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;

  /** Whether this system, or any system nested under it, soft-fades against the scene. */
  readonly wantsSceneDepth: boolean;

  /** Whether this system, or any system nested under it, draws the scene behind it refracted. */
  readonly wantsSceneColor: boolean;

  constructor(simulation: ParticleSystemSimulation, context: ParticleRendererContext) {
    this.simulation = simulation;
    simulation.observer = this;

    this.setupRenderers(getObjectArray(simulation.definition, 'm_Renderers'), context);

    let observed = 0;

    for (const renderer of this.renderers) {
      observed |= renderer.observedEvents;
    }

    this.observedEvents = observed;
    simulation.renderState.sequenceDurations = this.collectSequenceDurations();

    for (const childSimulation of simulation.children) {
      this.childRenderers.push(new ParticleRenderer(childSimulation, context));
    }

    this.wantsSceneDepth = this.renderers.some((r) => r.wantsSceneDepth) || this.childRenderers.some((c) => c.wantsSceneDepth);
    this.wantsSceneColor = this.renderers.some((r) => r.wantsSceneColor) || this.childRenderers.some((c) => c.wantsSceneColor);
  }

  private setupRenderers(rendererData: KVObject[], context: ParticleRendererContext): void {
    const initialReads = { value: 0n };
    const simulation = this.simulation;

    for (const rendererInfo of rendererData) {
      const parse = new ParticleDefinitionParser(rendererInfo, simulation.diagnostics, initialReads, simulation.behaviorVersion);

      if (parse.boolean('m_bDisableOperator', false)) {
        continue;
      }

      const rendererClass = getString(rendererInfo, '_class', '');

      if (GAME_ONLY.has(rendererClass)) {
        continue;
      }

      const create = RENDERERS.get(rendererClass);

      if (create === undefined) {
        simulation.diagnostics.report('unsupported-class', `Unsupported renderer class '${rendererClass}'`, simulation.name);
        this.skippedRendererClasses.push(rendererClass);
        continue;
      }

      const renderer = create(parse, context);
      renderer.className = rendererClass;
      this.renderers.push(renderer);
    }

    let writtenFields = 0n;
    let blendedFields = 0n;

    for (const renderer of this.renderers) {
      writtenFields |= renderer.storedFields;
      blendedFields |= renderer.blendedFields;
    }

    simulation.addRendererFields(writtenFields, initialReads.value, blendedFields);
  }

  /**
   * How long the sequence each sequence number reaches on the first sheet this system's renderers offer
   * runs, in frames, or null when none of them draws with one. A number no sequence answers to runs for 0.
   */
  private collectSequenceDurations(): number[] | null {
    for (const renderer of this.renderers) {
      const sheet = renderer.spriteSheet;

      if (sheet === null) {
        continue;
      }

      const durations = new Array<number>(sequenceIdCount(sheet)).fill(0);

      for (let id = 0; id < durations.length; id++) {
        const index = getSequenceIndex(sheet, id);

        if (index >= 0) {
          durations[id] = sheet.sequences[index].totalTime;
        }
      }

      return durations;
    }

    return null;
  }

  /** Called when a sheet arrives after the system was built, so sequence lifetimes read it as VRF's would. */
  refreshSequenceDurations(): void {
    if (this.simulation.renderState.sequenceDurations === null) {
      this.simulation.renderState.sequenceDurations = this.collectSequenceDurations();
    }

    for (const child of this.childRenderers) {
      child.refreshSequenceDurations();
    }
  }

  /** The renderers of this system and the systems nested under it, in draw order. */
  *enumerateRenderers(): Generator<ParticleFunctionRenderer> {
    yield* this.renderers;

    for (const child of this.childRenderers) {
      yield* child.enumerateRenderers();
    }
  }

  /** The renderer classes of this system and the systems nested under it that could not be created. */
  *enumerateSkippedRendererClasses(): Generator<string> {
    yield* this.skippedRendererClasses;

    for (const child of this.childRenderers) {
      yield* child.enumerateSkippedRendererClasses();
    }
  }

  /** The objects every renderer of the tree draws through, in VRF's draw order: a system's own before its children's. */
  *enumerateObjects(): Generator<THREE.Object3D> {
    for (const renderer of this.enumerateRenderers()) {
      yield* renderer.objects;
    }
  }

  onFrameSimulated(particles: ParticleCollection, state: ParticleSystemState): void {
    for (const renderer of this.renderers) {
      renderer.simulate(particles, state);
    }
  }

  onParticlesInitialized(particles: ParticleCollection, state: ParticleSystemState, first: number, count: number): void {
    for (const renderer of this.renderers) {
      renderer.initializeParticles(particles, state, first, count);
    }
  }

  onParticleEvent(particles: ParticleCollection, eventType: number, indices: readonly number[]): void {
    for (const renderer of this.renderers) {
      if ((renderer.observedEvents & eventType) !== 0) {
        renderer.onParticleEvent(particles, eventType, indices);
      }
    }
  }

  /**
   * Finishes the frame for this system's renderers and its children's. Renderers out of draw
   * distance or faded out are hidden; the rest finish the step when there was one.
   */
  act(view: RenderView, stepped: boolean): void {
    const withinDrawDistance = this.isWithinDrawDistance(view);

    for (const renderer of this.renderers) {
      if (!withinDrawDistance || renderer.getOperatorRunStrength(this.simulation.renderState) <= 0) {
        renderer.hide(this.simulation.particles);
      } else if (stepped) {
        renderer.act(this.simulation.particles, this.simulation.renderState);
      }
    }

    for (const child of this.childRenderers) {
      child.act(view, stepped);
    }
  }

  /** Hides what this system's renderers and its children's placed in the scene. */
  hide(): void {
    for (const renderer of this.renderers) {
      renderer.hide(this.simulation.particles);
      renderer.setVisible(false);
    }

    for (const child of this.childRenderers) {
      child.hide();
    }
  }

  /**
   * Fills the draws of every renderer that draws this frame (UpdateBuffers), and shows exactly those
   * that Render would draw: in a running system with particles, within draw distance, at a nonzero
   * strength, and drawing in the scene's own passes.
   */
  updateBuffers(view: RenderView, drawn = true): void {
    for (const child of this.childRenderers) {
      child.updateBuffers(view, drawn && child.simulation.shouldRunAsChildOf(this.simulation.renderState));
    }

    const hasParticles = this.simulation.particles.count > 0;
    const withinDrawDistance = this.isWithinDrawDistance(view);

    for (const renderer of this.renderers) {
      if (!renderer.enabled) {
        renderer.setVisible(false);
        continue;
      }

      const running = renderer.getOperatorRunStrength(this.simulation.renderState) > 0;
      const visible = drawn && hasParticles && running && withinDrawDistance && renderer.drawsInPasses && this.drawsInScene(renderer);

      if (drawn && hasParticles && running) {
        renderer.updateBuffers(this.simulation.particles, this.simulation.renderState, view);
      }

      renderer.setVisible(visible);
    }
  }

  /**
   * Whether a renderer draws in the scene: those that draw only into the bloom or water effects maps
   * draw nowhere here, and a screen-space system is not drawn by this port.
   */
  private drawsInScene(renderer: ParticleFunctionRenderer): boolean {
    return !this.simulation.isScreenSpaceEffect && !renderer.onlyRenderInEffectsBloomPass && !renderer.onlyRenderInEffectsWaterPass;
  }

  /** Whether the camera is near enough for this system to draw and simulate. */
  isWithinDrawDistance(view: RenderView): boolean {
    return this.simulation.isScreenSpaceEffect || isWithinDrawDistance(this.simulation, view.location);
  }

  dispose(): void {
    for (const renderer of this.renderers) {
      renderer.dispose();
    }

    for (const child of this.childRenderers) {
      child.dispose();
    }

    if (this.simulation.observer === this) {
      this.simulation.observer = null;
    }
  }
}

/** ParticleSystemSimulation.IsWithinDrawDistance: whether the camera is within the system's draw distance of its bounds. */
function isWithinDrawDistance(simulation: ParticleSystemSimulation, cameraPosition: Vector3): boolean {
  if (simulation.maxDrawDistanceSquared === FLOAT_MAX) {
    return true;
  }

  const box = simulation.localBoundingBox;
  const origin = simulation.mainControlPoint.position;
  const nearest = new Vector3(
    clamp(cameraPosition.x, box.min.x + origin.x, box.max.x + origin.x),
    clamp(cameraPosition.y, box.min.y + origin.y, box.max.y + origin.y),
    clamp(cameraPosition.z, box.min.z + origin.z, box.max.z + origin.z),
  );

  return distanceSquared(cameraPosition, nearest) <= simulation.maxDrawDistanceSquared;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
