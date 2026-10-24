import { expect, it } from 'vitest';
import * as THREE from 'three';
import { SOURCE_TO_GLTF, hideoutInstanceMatrix } from './hideoutTransform';

it('converts the spawn and placed model with the same exporter basis', () => {
  const source = new THREE.Matrix4().makeTranslation(100, 200, 300);
  const placed = new THREE.Vector3(1, 2, 3).applyMatrix4(SOURCE_TO_GLTF).applyMatrix4(hideoutInstanceMatrix(source.toArray()));
  const expected = new THREE.Vector3(101, 202, 303).applyMatrix4(SOURCE_TO_GLTF);
  expect(placed.distanceTo(expected)).toBeLessThan(1e-10);
});
