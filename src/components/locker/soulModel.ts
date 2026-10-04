import * as THREE from 'three';
import { disposeTexture, materialTextures } from '../../lib/loadGltfPreview';

/**
 * Shared helpers for the Locker's Global soul-container previews.
 *
 * The grid renders every card's model through a SINGLE shared WebGL context
 * (see SoulContainerCanvas), so the per-card pieces here are deliberately
 * renderer-agnostic: a tile just produces a normalized THREE group and the
 * shared canvas scissor-renders it into that card's on-screen rect. This is
 * what keeps a 40-card grid from blowing past the browser's ~16 live-context
 * cap (which silently drops the oldest contexts, leaving cards blank white).
 */

export const SOUL_MODEL_SCHEME = 'grimoire-soul';

/** Normalized size (largest dimension) the model is scaled to fit the card. */
const TARGET_SIZE = 1.7;

export function meshUrlFor(key: string, mtimeMs: number | null): string {
  // The key is a mod metaKey (overflow mods carry a '/', which a standard
  // scheme forbids in the host), so carry it as a single encoded path segment
  // under a fixed `m` host.
  return `${SOUL_MODEL_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
}

/**
 * Wrap a loaded GLB scene in a group normalized to a unit size and centered on
 * the origin, so tall and wide props both fit the small card frame. The shared
 * canvas spins the returned group's `rotation.y`; the inner group recenters.
 */
export function buildNormalizedRoot(scene: THREE.Object3D): THREE.Group {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? TARGET_SIZE / maxDim : 1;

  const centered = new THREE.Group();
  centered.position.set(-center.x, -center.y, -center.z);
  centered.add(scene);

  const root = new THREE.Group();
  root.scale.setScalar(scale);
  root.add(centered);
  return root;
}

/** Free a loaded group's GPU resources (geometry, materials, textures). */
export function disposeScene(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      materialTextures(m).forEach(disposeTexture);
      m.dispose();
    }
  });
}
