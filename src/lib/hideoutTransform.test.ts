import { expect, it } from 'vitest';
import * as THREE from 'three';
import { SOURCE_TO_GLTF, hideoutDrawTint, hideoutGammaTint, hideoutInstanceMatrix, hideoutMaterialTint, hideoutObjectTint, hideoutViewHeading } from './hideoutTransform';
import { source2MapProbeNormals } from './source2ProbeVolume';

it('puts the viewer camera behind the spawned player, where the game camera is', () => {
  // A spawn facing -X: the game camera trails it on the +X side.
  const towardCamera = new THREE.Vector3(0, 0, 1).applyMatrix3(source2MapProbeNormals(hideoutViewHeading(180)));
  expect(towardCamera.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-10);
});

it('converts the spawn and placed model with the same exporter basis', () => {
  const source = new THREE.Matrix4().makeTranslation(100, 200, 300);
  const placed = new THREE.Vector3(1, 2, 3).applyMatrix4(SOURCE_TO_GLTF).applyMatrix4(hideoutInstanceMatrix(source.toArray()));
  const expected = new THREE.Vector3(101, 202, 303).applyMatrix4(SOURCE_TO_GLTF);
  expect(placed.distanceTo(expected)).toBeLessThan(1e-10);
});

it('tints by the draw call as VRF does: node tint times the draw tint in sRGB, decoded once', () => {
  // The hideout chimney breast's draw call (n0_lr0_c26_s_cb_mesh, draw 4) under a white node.
  const chimney = hideoutDrawTint([0.18354902, 0.03287592, 0.02899119, 1]);
  hideoutObjectTint([1, 1, 1], chimney).toArray().forEach((value, i) => expect(value).toBeCloseTo([0.18354902, 0.03287592, 0.02899119][i], 4));
  // A tinted node and no draw tint is the node's tint decoded.
  const node = hideoutObjectTint([0.5, 1, 1], null);
  expect(node.r).toBeCloseTo(new THREE.Color().setRGB(0.5, 1, 1).convertSRGBToLinear().r, 9);
  // Both: the product is taken in sRGB, not linear.
  const both = hideoutObjectTint([0.5, 1, 1], hideoutDrawTint([0.25, 1, 1, 1]));
  const expected = new THREE.Color().setRGB(0.5 * new THREE.Color().setRGB(0.25, 0, 0).convertLinearToSRGB().r, 1, 1).convertSRGBToLinear().r;
  expect(both.r).toBeCloseTo(expected, 9);
  expect(hideoutDrawTint([1, 1, 1])).toBeNull();
  expect(hideoutDrawTint('red')).toBeNull();
});

it('decodes authored map tints for environment and multiply-mode pbr materials', () => {
  // salt_line.vmat: pbr.vfx, mode 0, g_vColorTint1 (0.714, 0.6, 0.584) exported raw as the factor.
  const salt = hideoutMaterialTint({ shader: 'pbr.vfx', vectors: { g_vColorTint1: [0.7137, 0.6, 0.5843, 0] }, ints: { g_nTextureColorTintMode1: 0 } });
  expect(salt?.r).toBeCloseTo(new THREE.Color().setRGB(0.7137, 0, 0).convertSRGBToLinear().r, 9);
  const doubled = hideoutMaterialTint({ shader: 'environment_blend.vfx', vectors: { g_vColorTint1: [0.5, 0.5, 0.5, 0] }, ints: { g_nTextureColorTintMode1: 2 } });
  expect(doubled?.g).toBeCloseTo(new THREE.Color().setRGB(0, 0.5, 0).convertSRGBToLinear().g * 2, 9);
  expect(hideoutMaterialTint({ shader: 'pbr.vfx', vectors: { g_vColorTint1: [0.5, 0.5, 0.5, 0] }, ints: { g_nTextureColorTintMode1: 1 } })).toBeNull();
  expect(hideoutMaterialTint({ shader: 'generic.vfx', vectors: { g_vColorTint1: [0.5, 0.5, 0.5, 0] } })).toBeNull();
  expect(hideoutMaterialTint({ shader: 'pbr.vfx' })).toBeNull();
});

it('hands world cards the same object tint still in sRGB', () => {
  // The Maelstrom glow card above the tower: a white node and a green draw call.
  const draw = hideoutDrawTint([0.0022629532, 0.4259053171, 0.1904629022, 1]);
  const gamma = hideoutGammaTint([1, 1, 1], draw);
  const linear = hideoutObjectTint([1, 1, 1], draw);
  gamma.forEach((value, i) => expect(new THREE.Color().setRGB(value, value, value).convertSRGBToLinear().r).toBeCloseTo(linear.toArray()[i], 9));
  expect(linear.g).toBeCloseTo(0.4259053171, 4);
  expect(hideoutGammaTint([0.5, 1, 1], null)).toEqual([0.5, 1, 1]);
});
