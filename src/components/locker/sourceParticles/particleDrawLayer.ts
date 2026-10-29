// What draws one effect host's simulation: the three.js port of VRF's particle renderers
// (src/lib/particles/render/), one ParticleSystemRenderer per effect tree.

import type * as THREE from 'three';
import type { ControlPointDefaults } from '../../../lib/particles/controlPointDefaults';
import { ParticleSystemRenderer, type ParticleSceneDepth } from '../../../lib/particles/render';
import type { ParticleModelSource } from '../../../lib/particles/render/particleModels';
import type { ParticleSystemSimulation } from '../../../lib/particles/simulation';
import type { BundleTextureSource } from './bundleTextures';

export interface ParticleDrawLayer {
  /** Drawn in Source space; parent it under the Source-to-viewer frame. */
  readonly object3d: THREE.Object3D;
  /** Whether the tree feathers against the opaque scene, and so wants `setScene`'s depth. */
  readonly wantsSceneDepth: boolean;
  /** Whether the tree refracts the opaque scene, and so wants `setScene`'s colour. */
  readonly wantsSceneColor: boolean;
  /** Prepares the frame's draws; call every frame after the simulation stepped, also while paused. */
  update(camera: THREE.Camera, viewport: [number, number], time?: number): void;
  /** The opaque scene this frame, for feathering and refraction; null where the host has none. */
  setScene(depth: ParticleSceneDepth | null, color: THREE.Texture | null): void;
  dispose(): void;
  /** Control point defaults the drawing layer's renderers imply, applied before the system starts. */
  addControlPointDefaults?: (defaults: ControlPointDefaults) => void;
}

/**
 * Builds the drawing layer for a simulation; call before the simulation starts, as VRF builds its
 * renderers: they tell the simulation which fields they read and which sheet times its sequences.
 */
export function createParticleDrawLayer(simulation: ParticleSystemSimulation, textures: BundleTextureSource, models?: ParticleModelSource): ParticleDrawLayer {
  const renderer = new ParticleSystemRenderer(simulation, textures, { models });
  const renderers = renderer.renderers;

  // The tree's draws keep VRF's order among themselves (renderOrder 0 up) and all come after the hero's
  // translucent meshes (renderOrder 0), not only the first draw sorting among them by depth. VRF sorts
  // the whole effect against the model by their bounds' centres, and the hero's own effects sit in
  // front of its centre (hands, weapon, head). The translucent meshes they meet are glow shells
  // (Infernus' arm and head, the Doorman's key).
  for (const object of renderer.object3d.children) object.renderOrder += 1;

  return {
    object3d: renderer.object3d,
    wantsSceneDepth: renderer.wantsSceneDepth,
    wantsSceneColor: renderer.wantsSceneColor,
    update: (camera, viewport, time) => renderer.update(camera, viewport, time),
    setScene(depth, color) {
      renderer.sceneDepth = depth;
      renderer.sceneColor = color;
    },
    dispose: () => renderer.dispose(),
    // ParticleSceneNode.ApplyControlPointDefaults asks every renderer of the tree after the simulation
    addControlPointDefaults(defaults) {
      for (const function_ of renderers) function_.addControlPointDefaults(defaults);
    },
  };
}
