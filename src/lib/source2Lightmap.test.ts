import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SOURCE_TO_GLTF } from './hideoutTransform';
import { source2CubemapNormalization, source2LightmapNormalMatrix } from './source2Lightmap';

describe('Source 2 world lightmap directions', () => {
  it.each([0, 45, 180, -90])('recovers Source normals after the viewer heading %s', heading => {
    const rotation = new THREE.Matrix4().makeRotationY(-THREE.MathUtils.degToRad(heading));
    for (const normal of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      const viewer = normal.clone().transformDirection(SOURCE_TO_GLTF).transformDirection(rotation);
      expect(viewer.applyMatrix3(source2LightmapNormalMatrix(heading)).distanceTo(normal)).toBeLessThan(1e-12);
    }
  });
});

describe('Source 2 cubemap normalization', () => {
  it('averages a uniform cubemap to its value', () => {
    const face = { width: 2, height: 2, data: new Float32Array(16).fill(0.5) };
    const fit = source2CubemapNormalization(Array.from({ length: 6 }, () => face));
    expect(fit.w).toBeCloseTo(0.5, 10);
    expect(Math.hypot(fit.x, fit.y, fit.z)).toBeLessThan(1e-12);
  });
});
