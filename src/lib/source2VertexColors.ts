import * as THREE from 'three';
import { getMorphic, requiresVertexColors } from './source2NprMaterial';

/** vpkmerge preserves Source 2's sRGB vertex stream; glTF expects linear RGB.
 * Convert owned preview geometry once, leaving alpha and tint-only masks intact. */
export function prepareSource2VertexColors(scene: THREE.Object3D): void {
  const converted = new Map<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, THREE.BufferAttribute>();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let usesColor = false;
    for (const mat of materials) {
      const hints = getMorphic(mat);
      if (!hints) continue;
      const standard = mat as THREE.MeshStandardMaterial;
      const enabled = requiresVertexColors(hints) && !!mesh.geometry.getAttribute('color');
      standard.vertexColors = enabled;
      standard.needsUpdate = true;
      usesColor ||= enabled;
    }
    const color = mesh.geometry.getAttribute('color');
    if (!usesColor || !color || mesh.geometry.userData.source2ColorLinear) return;
    let linear = converted.get(color);
    if (!linear) {
      linear = new THREE.BufferAttribute(new Float32Array(color.count * color.itemSize), color.itemSize);
      const rgb = new THREE.Color();
      for (let i = 0; i < color.count; i++) {
        rgb.setRGB(color.getX(i), color.getY(i), color.getZ(i)).convertSRGBToLinear();
        linear.setXYZ(i, rgb.r, rgb.g, rgb.b);
        if (color.itemSize === 4) linear.setW(i, color.getW(i));
      }
      converted.set(color, linear);
    }
    mesh.geometry.setAttribute('color', linear);
    mesh.geometry.userData.source2ColorLinear = true;
  });
}
