/**
 * Always-on Source 2 draw-state compilation over a loaded GLTF scene.
 *
 * Traverses the scene once and applies `applySource2DrawState` to every material
 * carrying morphic extras, regardless of dev flags. This is the pass that makes
 * additive self-illum glow overlays (kept by the vpkmerge exporter) composite
 * correctly on the default preview path, where the scene would otherwise render
 * untouched GLTFLoader materials (an opaque white hull for an additive overlay).
 *
 * Returns a `restore` handle so the host component can revert the mutations on
 * scene change / unmount, exactly like `applySource2MaterialHints`. The mutations
 * are restricted to the draw-state subset (blend/depth/cull/render-order), so
 * this composes cleanly with the flag-gated NPR/unified passes: those operate on
 * owned clones (the GLTF base is restored here) and re-decide material state on
 * the clone, while the mesh-level `renderOrder` set here persists across a
 * material swap.
 */
import type * as THREE from 'three';
import { getMorphic } from '../source2NprMaterial';
import { applySource2DrawState } from './drawState';
import type { Source2CompileResult, Source2CompileStats } from './types';

export function compileSource2DrawState(scene: THREE.Object3D): Source2CompileResult {
  const restores: Array<() => void> = [];
  const seen = new Set<THREE.Material>();
  const stats: Source2CompileStats = {
    meshes: 0,
    morphicMaterials: 0,
    additive: 0,
    translucent: 0,
    backfaces: 0,
    unlit: 0,
    glass: 0,
  };

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let meshCounted = false;
    mats.forEach((mat) => {
      if (!mat) return;
      const morphic = getMorphic(mat);
      if (!morphic) return;

      const application = applySource2DrawState(mesh, mat, morphic);
      if (!application) return;

      // Count each unique material once (a material may be shared across meshes).
      if (!seen.has(mat)) {
        seen.add(mat);
        stats.morphicMaterials += 1;
        const { plan } = application;
        if (plan.additive) stats.additive += 1;
        if (plan.translucent) stats.translucent += 1;
        if (plan.backfaces) stats.backfaces += 1;
        if (plan.unlit) stats.unlit += 1;
        if (plan.glass) stats.glass += 1;
      }
      if (!meshCounted) {
        meshCounted = true;
        stats.meshes += 1;
      }
      if (application.restore) restores.push(application.restore);
    });
  });

  return {
    // Restore in reverse application order so multi-material meshes (whose
    // renderOrder is per-mesh) wind back to their original draw order.
    restore: () => {
      for (let i = restores.length - 1; i >= 0; i -= 1) restores[i]();
    },
    stats,
  };
}
