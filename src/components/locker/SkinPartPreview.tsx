import { useEffect } from 'react';
import * as THREE from 'three';
import { editForMaterial, materialBasename } from '../../lib/skinParts';
import type { SkinPartEdit } from '../../types/skinEditor';

export function SkinPartPreview({ scene, edits, wireframe, highlight }: {
  scene: THREE.Object3D; edits: SkinPartEdit[]; wireframe: boolean; highlight: string | null;
}) {
  useEffect(() => {
    const restore: Array<() => void> = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const edit = editForMaterial(material.name, edits);
        const oldVisible = material.visible;
        material.visible = oldVisible && !edit?.hidden;
        restore.push(() => { material.visible = oldVisible; });
        if ('wireframe' in material && typeof material.wireframe === 'boolean') {
          const oldWireframe = material.wireframe;
          material.wireframe = wireframe;
          restore.push(() => { material.wireframe = oldWireframe; });
        }
        if (material instanceof THREE.MeshStandardMaterial) {
          const oldColor = material.color.clone();
          if (edit?.tint && !('uniforms' in material)) material.color.set(edit.tint);
          restore.push(() => { material.color.copy(oldColor); });
        }
      }
    });
    return () => restore.forEach((reset) => reset());
  }, [scene, edits, wireframe]);
  useEffect(() => {
    if (!highlight) return;
    const meshes: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => materialBasename(material.name) === materialBasename(highlight) && material.visible)) meshes.push(object);
    });
    const color = new THREE.Color();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    if (accent) color.set(accent);
    const material = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.65,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const overlays = meshes.map((mesh) => {
      const overlay = mesh instanceof THREE.SkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, material) : new THREE.Mesh(mesh.geometry, material);
      if (overlay instanceof THREE.SkinnedMesh && mesh instanceof THREE.SkinnedMesh) {
        overlay.bind(mesh.skeleton, mesh.bindMatrix);
        overlay.bindMatrixInverse.copy(mesh.bindMatrixInverse);
      }
      overlay.raycast = () => {};
      mesh.add(overlay);
      return overlay;
    });
    return () => { overlays.forEach((overlay) => overlay.removeFromParent()); material.dispose(); };
  }, [scene, highlight, edits]);
  return null;
}
