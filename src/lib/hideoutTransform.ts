import * as THREE from 'three';

// morphic converts Source inches/Z-up to glTF metres/Y-up with this basis.
export const SOURCE_TO_GLTF = new THREE.Matrix4().set(
  0, 0.0254, 0, 0,
  0, 0, 0.0254, 0,
  0.0254, 0, 0, 0,
  0, 0, 0, 1,
);

export function hideoutInstanceMatrix(source: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(SOURCE_TO_GLTF, new THREE.Matrix4().fromArray(source)).multiply(SOURCE_TO_GLTF.clone().invert());
}
