// The three.js host side of ValveResourceFormat's ParticleSceneNode (MIT,
// Renderer/Renderer/SceneNodes/ParticleSceneNode.cs): draws a running simulation tree, every child
// system and every renderer of each, under one Object3D in Source space.

import * as THREE from 'three';
import type { ParticleSystemSimulation } from '../simulation';
import { DEADLOCK_GAME_SETTINGS, ParticleRendererContext, type ParticleGameSettings, type ParticleSceneDepth } from './context';
import type { ParticleFunctionRenderer } from './functionRenderer';
import { ParticleRenderer } from './particleRenderer';
import type { ParticleModelSource } from './particleModels';
import type { ParticleTextureSource } from './textures';
import { type RenderView, viewFromCamera } from './view';

/**
 * The sun VRF's viewers light a scene without lighting information with (Renderer.DefaultSunColor,
 * colour times brightness). Every lit particle adds it to an ambient of 1.
 */
export const VRF_VIEWER_SUN_COLOR: [number, number, number] = [(255 / 255) * 2.5, (247 / 255) * 2.5, (235 / 255) * 2.5];

export interface ParticleSystemRendererOptions {
  /** The game the effects come from; Deadlock by default. */
  game?: ParticleGameSettings;
  /** The sun colour lit particles add to an ambient of 1. VRF's viewer default when omitted. */
  sunColor?: [number, number, number];
  /** The models and materials C_OP_RenderModels draws; without them it draws nothing. */
  models?: ParticleModelSource;
}

export class ParticleSystemRenderer {
  /** Parent this under the Source-to-viewer transform; everything below it is in Source space. */
  readonly object3d: THREE.Group;

  private readonly simulation: ParticleSystemSimulation;
  private readonly root: ParticleRenderer;
  private readonly context: ParticleRendererContext;
  private readonly views = new WeakMap<THREE.Camera, { frame: number; view: RenderView }>();
  private frame = 0;
  private lastAge: number | null = null;
  private windowSize: [number, number] = [1, 1];

  /**
   * Builds a renderer for every system of the tree. Construct it before `simulation.start()`: as in
   * VRF, the renderers tell the simulation which fields they read and which sheet times its
   * sequences, before the first particle is made.
   */
  constructor(simulation: ParticleSystemSimulation, textures: ParticleTextureSource, options: ParticleSystemRendererOptions = {}) {
    this.simulation = simulation;
    this.object3d = new THREE.Group();
    this.object3d.name = `particles: ${simulation.name}`;
    this.context = new ParticleRendererContext(textures, options.game ?? DEADLOCK_GAME_SETTINGS, options.sunColor ?? VRF_VIEWER_SUN_COLOR, (camera) =>
      this.viewFor(camera), options.models ?? null,
    );
    this.root = new ParticleRenderer(simulation, this.context);

    // VRF draws a system's renderers in order, its own before its children's
    let order = 0;

    for (const object of this.root.enumerateObjects()) {
      object.renderOrder = order++;
      this.object3d.add(object);
    }
  }

  /** Every renderer of the tree, in draw order: a system's own before its children's. */
  get renderers(): ParticleFunctionRenderer[] {
    return [...this.root.enumerateRenderers()];
  }

  /** The renderer classes of the tree this port does not draw. */
  get skippedRendererClasses(): string[] {
    return [...new Set(this.root.enumerateSkippedRendererClasses())];
  }

  /** Whether any renderer of the tree feathers against the opaque scene, and so wants `sceneDepth`. */
  get wantsSceneDepth(): boolean {
    return this.root.wantsSceneDepth;
  }

  /** Whether any renderer of the tree refracts the opaque scene, and so wants `sceneColor`. */
  get wantsSceneColor(): boolean {
    return this.root.wantsSceneColor;
  }

  /** The opaque scene depth feathering renderers fade against, or null for an infinitely far scene. */
  set sceneDepth(depth: ParticleSceneDepth | null) {
    this.context.sceneDepth = depth;
  }

  /** The opaque scene colour refracting renderers draw displaced, or null for black. */
  set sceneColor(texture: THREE.Texture | null) {
    this.context.sceneColor = texture;
  }

  /** The sun colour lit particles add to an ambient of 1. */
  set sunColor(color: [number, number, number]) {
    this.context.sunColor = color;
  }

  /**
   * Prepares the frame's draws, once a frame after the simulation updated and before rendering
   * (ParticleSceneNode's Act phase, then UpdateBuffers). `viewport` is the drawing buffer size.
   */
  update(camera: THREE.Camera, viewport?: [number, number], time?: number): void {
    this.frame++;

    if (time !== undefined) {
      // Material shaders read it as g_flTime, VRF's renderer uptime
      this.context.time = time;
    }

    if (viewport) {
      this.windowSize = viewport;
    }

    this.object3d.updateWorldMatrix(true, false);
    const view = this.viewFor(camera);

    const age = this.simulation.renderState.age;
    const stepped = this.lastAge !== null && age !== this.lastAge;
    this.lastAge = age;

    if (this.sheetsArrived()) {
      this.root.refreshSequenceDurations();
    }

    this.root.act(view, stepped);
    this.root.updateBuffers(view);
  }

  private sheetsKnown = false;

  /** Whether a texture header arrived since the last frame, the first time any does. */
  private sheetsArrived(): boolean {
    if (this.sheetsKnown) {
      return false;
    }

    for (const renderer of this.root.enumerateRenderers()) {
      if (renderer.spriteSheet !== null) {
        this.sheetsKnown = true;
        return true;
      }
    }

    return false;
  }

  /** Hides everything the tree draws, as VRF does for a system that is not playing. */
  hide(): void {
    this.root.hide();
  }

  private viewFor(camera: THREE.Camera): RenderView {
    const cached = this.views.get(camera);

    if (cached && cached.frame === this.frame) {
      return cached.view;
    }

    camera.updateMatrixWorld();
    const view = viewFromCamera(camera, this.object3d.matrixWorld, this.windowSize);
    this.views.set(camera, { frame: this.frame, view });
    return view;
  }

  dispose(): void {
    this.object3d.removeFromParent();
    this.root.dispose();
    this.context.dispose();
  }
}
