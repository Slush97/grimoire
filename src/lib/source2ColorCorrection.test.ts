import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applySource2ColorCorrection, decodedAlbedoAverage, source2TintPlan,
  SOURCE2_SATURATION_WEIGHTS,
} from './source2ColorCorrection';
import {
  albedoReflectivity, NPR_FRAGMENT, resolveMorphicTextures,
  unwrapNprBase, wrapMaterialWithNpr, type MorphicExtras,
} from './source2NprMaterial';
import { buildDeadlockMaterial } from './deadlockMaterial';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const v = (r: number, g: number, b: number) => new THREE.Vector3(r, g, b);
const morphic = (extras: Partial<MorphicExtras> = {}): MorphicExtras => ({
  schema_version: 2, shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, g_bMaskColorTint1: 0 },
  vectors: { g_vColorTint1: [0.5, 0.25, 1, 1] }, ...extras,
});
const material = (extras = morphic()) => {
  const base = new THREE.MeshStandardMaterial();
  base.color.setRGB(0.5, 0.25, 1);
  base.userData.morphic = extras;
  return base;
};

describe('MatrixColorCorrect2', () => {
  it('matches the independently evaluated VRF scale/rotation matrix on colored input', () => {
    // Evaluated from VRF b20af381... VfxEvalFunctions using the complete axis-angle
    // construction, not the simplified shader dot product. Exercises all stages.
    const actual = applySource2ColorCorrection(v(0.1, 0.4, 0.8), v(1.7, 0.35, 1.25), v(0.15, 0.3, 0.55));
    const expected = [0.387650442154, 0.564837942154, 0.785775442154];
    actual.toArray().forEach((value, index) => expect(value).toBeCloseTo(expected[index], 7));
  });
  it('uses each linear reflectivity channel as the contrast pivot, preserves identity and HDR', () => {
    const pivot = v(0.02, 0.3, 0.75);
    expect(applySource2ColorCorrection(v(0, 0, 0), v(0, 1, 1), pivot).toArray()).toEqual(pivot.toArray());
    expect(applySource2ColorCorrection(v(0.1, 0.4, 0.8), v(1, 1, 1), pivot).toArray()).toEqual([0.1, 0.4, 0.8]);
    expect(applySource2ColorCorrection(v(2, 2, 2), v(1, 1, 2), pivot).toArray()).toEqual([4, 4, 4]);
    expect(applySource2ColorCorrection(v(0, 0, 0), v(2, 1, 1), pivot).x).toBe(-0.02);
  });
  it('binds header reflectivity without another gamma decode and labels the legacy fallback separately', () => {
    expect(albedoReflectivity(morphic({ texture_reflectivity: { g_tColor: [0.15, 0.3, 0.55, 1] }, preview_albedo_average: [0.5, 0.5, 0.5] })).toArray()).toEqual([0.15, 0.3, 0.55]);
    expect(albedoReflectivity(morphic({ preview_albedo_average: [0.2, 0.3, 0.4] })).toArray()).toEqual([0.2, 0.3, 0.4]);
  });
  it('places correction before the authored tint and detail in the production shader', () => {
    const correction = NPR_FRAGMENT.indexOf('applyAlbedoCSB(csm_DiffuseColor.rgb');
    expect(correction).toBeLessThan(NPR_FRAGMENT.indexOf('uSource2ColorTint * csm_DiffuseColor.rgb'));
    expect(correction).toBeLessThan(NPR_FRAGMENT.indexOf('nprDetail = texture2D'));
    expect(NPR_FRAGMENT).toContain('c = (c - reflectivity) * csb.x + reflectivity;');
    expect(NPR_FRAGMENT).toContain(`vec3(${SOURCE2_SATURATION_WEIGHTS.map((n) => n.toPrecision(12)).join(', ')})`);
  });
});

describe('morphic v2 tint compatibility', () => {
  it.each([
    ['missing schema', { schema_version: undefined }], ['future schema', { schema_version: 3 }],
    ['other shader', { shader: 'complex.vfx' }],
    ['dynamic tint', { dynamic_params: { g_vColorTint1: { source: 'time()', decompiled: true, byte_len: 4, attributes: [], hash: 'test' } } }],
  ])('does not reinterpret %s', (_name, extra) => {
    expect(source2TintPlan(morphic(extra), new THREE.Color().setRGB(0.5, 0.25, 1)).ownsExportedFactor).toBe(false);
  });
  it('supports mod2x and the luminance-preserving tint matrix without another transfer', () => {
    const factor = new THREE.Color().setRGB(0.5, 0.25, 1);
    const double = source2TintPlan(morphic({ ints: { g_nTextureColorTintMode1: 2 } }), factor);
    expect(v(1, 1, 1).applyMatrix3(double.matrix).x).toBeCloseTo(2 * 0.21404114);
    const preserve = source2TintPlan(morphic({ ints: { g_nTextureColorTintMode1: 1 } }), factor);
    const tint = v(preserve.linearTint.r, preserve.linearTint.g, preserve.linearTint.b);
    const transformed = tint.clone().applyMatrix3(preserve.matrix).add(preserve.offset);
    transformed.toArray().forEach((value, index) => expect(value).toBeCloseTo(tint.toArray()[index]));
    expect(preserve.offset.length()).toBeGreaterThan(0);
  });
  it('leaves independently edited factors alone', () => {
    expect(source2TintPlan(morphic(), new THREE.Color().setRGB(0.2, 0.3, 0.4)).ownsExportedFactor).toBe(false);
  });
  it('builds repeatedly without mutating the base or decoding a linear factor again', () => {
    const base = material();
    for (let i = 0; i < 2; i++) {
      const result = buildDeadlockMaterial(base);
      const tinted = v(1, 1, 1).applyMatrix3(result.uniforms.uSource2ColorTint.value);
      expect(tinted.x).toBeCloseTo(0.21404114);
      expect(tinted.y).toBeCloseTo(0.05087609);
      expect((result.material as unknown as THREE.MeshStandardMaterial).color.toArray()).toEqual([1, 1, 1]);
      result.dispose();
    }
    expect(base.color.toArray()).toEqual([0.5, 0.25, 1]);
    base.color.convertSRGBToLinear();
    const result = buildDeadlockMaterial(base);
    expect(v(1, 1, 1).applyMatrix3(result.uniforms.uSource2ColorTint.value).x).toBeCloseTo(base.color.r);
    result.dispose();
  });
  it('restores the corrected base after legacy wrap and stays stable on the next wrap', () => {
    const base = material();
    for (let i = 0; i < 2; i++) {
      const result = wrapMaterialWithNpr(base)!;
      expect(v(1, 1, 1).applyMatrix3(result.uniforms.uSource2ColorTint.value).x).toBeCloseTo(0.21404114);
      unwrapNprBase(base);
      expect(base.color.r).toBeCloseTo(0.21404114);
      result.material.dispose();
    }
  });
  it('corrects ordinary glTF factors only for proven v2 morphic materials at load', async () => {
    const scene = new THREE.Scene();
    const base = material();
    const ordinary = new THREE.MeshStandardMaterial(); ordinary.color.setRGB(0.5, 0.25, 1);
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), base), new THREE.Mesh(new THREE.BufferGeometry(), ordinary));
    const gltf = { scene, parser: {} } as unknown as GLTF;
    await resolveMorphicTextures(gltf); await resolveMorphicTextures(gltf);
    expect(base.color.r).toBeCloseTo(0.21404114);
    expect(ordinary.color.toArray()).toEqual([0.5, 0.25, 1]);
  });
  it('averages decoded albedo in linear space, excluding alpha and exported tint', () => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0, 0, 255, 0, 255]), 2, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    expect(decodedAlbedoAverage(tex)?.toArray()).toEqual([0.5, 0.5, 0]);
  });
});
