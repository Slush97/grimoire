import { useEffect } from 'react';
import * as THREE from 'three';
import { editForMaterial } from '../../lib/skinParts';
import type { SkinPartEdit } from '../../types/skinEditor';

export function SkinPartPreview({ scene, edits, wireframe }: {
  scene: THREE.Object3D; edits: SkinPartEdit[]; wireframe: boolean;
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
  return null;
}
