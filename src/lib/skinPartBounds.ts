import * as THREE from 'three';
import { materialBasename } from './skinParts';

/** Bounds of the selected draw calls, excluding unused vertices in shared buffers. */
export function skinPartBounds(root: THREE.Object3D, name: string): THREE.Box3 {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const selected = materials.map(material => material.visible && materialBasename(material.name) === materialBasename(name));
    if (!selected.some(Boolean)) return;
    const geometry = object.geometry;
    const count = geometry.index?.count ?? geometry.attributes.position.count;
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      if (!selected[group.materialIndex ?? 0]) continue;
      const first = Math.max(group.start, geometry.drawRange.start);
      const end = Math.min(count, group.start + group.count, geometry.drawRange.start + geometry.drawRange.count);
      for (let index = first; index < end; index++) {
        object.getVertexPosition(geometry.index?.getX(index) ?? index, point);
        bounds.expandByPoint(point.applyMatrix4(object.matrixWorld));
      }
    }
  });
  return bounds;
}
