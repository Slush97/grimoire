import { expect, it } from 'vitest';
import * as THREE from 'three';
import { cacheMapStaticUniforms, cacheMapUniformValues, flattenMapUniform } from './mapStaticUniforms';

it('flattens authored matrix/vector arrays in WebGL column-major order without changing their values', () => {
  const matrices = [new THREE.Matrix4().makeTranslation(1, -2, 3), new THREE.Matrix4().makeScale(.5, 2, 4)];
  expect(flattenMapUniform(matrices)).toEqual(new Float32Array(matrices.flatMap(matrix => Array.from(matrix.elements))));
  expect(flattenMapUniform([new THREE.Vector3(.1, .2, .3), new THREE.Vector3(4, 5, 6)]))
    .toEqual(new Float32Array([.1, .2, .3, 4, 5, 6]));
  expect(flattenMapUniform([new THREE.Vector3(), new THREE.Vector4()])).toBeNull();
  expect(flattenMapUniform(new Float32Array([1, 2]))).toBeNull();
  expect(flattenMapUniform([])).toBeNull();
});

it('caches only immutable map inputs and restores borrowed uniforms and hooks', () => {
  const material = new THREE.MeshStandardMaterial(), original = material.onBeforeCompile;
  const lights = [new THREE.Vector3(1, 2, 3)], dynamic = [{ position: new THREE.Vector3() }];
  const uniforms = { source2LightColor: { value: lights }, pointLights: { value: dynamic } };
  const restore = cacheMapStaticUniforms(material);
  expect(cacheMapStaticUniforms(material)).toBe(restore);
  const restoreValues = cacheMapUniformValues(uniforms);
  expect(uniforms.source2LightColor.value).toEqual(new Float32Array([1, 2, 3]));
  expect(uniforms.pointLights.value).toBe(dynamic);
  restoreValues();
  cacheMapStaticUniforms(material, false);
  expect(uniforms.source2LightColor.value).toBe(lights);
  expect(material.onBeforeCompile).toBe(original);
  material.dispose();
});
