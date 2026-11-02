import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseSource2Volume, source2NormalizedVolume, source2ViewerToMap } from './source2ProbeVolume';
import { SOURCE_TO_GLTF } from './hideoutTransform';

describe('map probe coordinates and volume transport', () => {
  it('inverts the map placement including heading, hero normalization and floor', () => {
    const info = { anchor: [100, -200, 30] satisfies [number, number, number], heading: 67 };
    const scale = 0.7, floor = -1.02;
    const original = new THREE.Vector3(120, -150, 85);
    const viewer = original.clone().applyMatrix4(SOURCE_TO_GLTF)
      .sub(new THREE.Vector3(...info.anchor).applyMatrix4(SOURCE_TO_GLTF))
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -67 * Math.PI / 180).multiplyScalar(scale).add(new THREE.Vector3(0, floor, 0));
    expect(viewer.applyMatrix4(source2ViewerToMap(info, scale, floor)).distanceTo(original)).toBeLessThan(1e-10);
  });

  it('normalizes an authored rotated volume before atlas addressing', () => {
    const placement = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(10, 20, 30);
    const volume = { matrix: placement.toArray(), min: [-2, -4, -6] satisfies [number, number, number], max: [2, 4, 6] satisfies [number, number, number],
      size: [2, 3, 4] satisfies [number, number, number], offset: [0, 0, 0] satisfies [number, number, number], fade: [0, 0, 0] satisfies [number, number, number], priority: 0, handshake: 1 };
    expect(new THREE.Vector3(0, 0, 0).applyMatrix4(placement).applyMatrix4(source2NormalizedVolume(volume)).toArray()).toEqual([0.5, 0.5, 0.5]);
  });

  it('retains each raw slice and alpha and rejects truncated volume data', () => {
    const bytes = new ArrayBuffer(28); const header = new DataView(bytes);
    [0x31565456, 1, 1, 2, 1].forEach((value, i) => header.setUint32(i * 4, value, true));
    new Uint8Array(bytes, 20).set([1, 2, 3, 4, 252, 253, 254, 255]);
    const texture = parseSource2Volume(bytes, false);
    expect(Array.from(texture.image.data ?? [])).toEqual([1, 2, 3, 4, 252, 253, 254, 255]);
    expect(texture.image.depth).toBe(2);
    expect(() => parseSource2Volume(bytes.slice(0, 27), false)).toThrow('Invalid volume pixel count');
    texture.dispose();
  });
});
