import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ambientLuminanceFit, CITADEL_NPR, CITADEL_NPR_GLSL, citadelNprUniforms, directLightNormalization, powerStep, wrappedStepResponse,
} from './citadelNprLighting';
import { buildDeadlockMaterial } from './deadlockMaterial';
import { applyNprMapDefines, NPR_PATCH_MAP, type MorphicExtras } from './source2NprMaterial';

describe('Citadel NPR scalar lighting', () => {
  it.each([[0, 0], [0.25, 1 / 2048], [0.5, 0.5], [0.75, 2047 / 2048], [1, 1]])(
    'power-steps %s like the shipped 0.9 sharpness', (input, expected) => expect(powerStep(input, 0.9)).toBeCloseTo(expected, 12),
  );

  it('puts the wrapped terminator past the geometric one', () => {
    // The response crosses one half where 2 (n.l + wrap) - 1.5 = 0.5, at n.l = 0.2.
    expect(wrappedStepResponse(0.2, CITADEL_NPR.directLightWrap, CITADEL_NPR.diffuseStepSharpness)).toBeCloseTo(0.5, 9);
    expect(wrappedStepResponse(-0.2, CITADEL_NPR.directLightWrap, CITADEL_NPR.diffuseStepSharpness)).toBeLessThan(1e-6);
    expect(wrappedStepResponse(0.6, CITADEL_NPR.directLightWrap, CITADEL_NPR.diffuseStepSharpness)).toBeGreaterThan(0.999);
  });

  it('normalizes the stepped light to the same sphere energy as Lambert', () => {
    // A sharp step at n.l = 0.2 lights 0.8 of the sphere's cosine range, 1.6x Lambert's half.
    expect(directLightNormalization()).toBeCloseTo(0.625, 3);
    // Without wrap or sharpening the response is a clamped ramp from n.l = 0.25.
    expect(directLightNormalization(0.5, 0)).toBeGreaterThan(directLightNormalization());
  });

  it('fits ambient cube luminance to first order', () => {
    const cube = [1, 0.5, 2, 0.2, 0.8, 0.8].map((v) => new THREE.Vector3(v, v, v));
    const fit = ambientLuminanceFit(cube);
    const luma = 0.2125 + 0.7154 + 0.0721;
    expect(fit.y).toBeCloseTo((0.9 * luma), 6);
    expect(fit.x).toBeCloseTo(0.25 * luma, 6);
    expect(fit.z).toBeCloseTo(0, 6);
    expect(fit.w).toBeCloseTo((5.3 / 6) * luma, 6);
  });

  it('allocates independent uniforms', () => {
    const a = citadelNprUniforms(true);
    const b = citadelNprUniforms(false);
    expect(a.uCitadelLighting.value).toBe(1);
    expect(b.uCitadelLighting.value).toBe(0);
    expect(a.uCitadelAmbientFit.value).not.toBe(b.uCitadelAmbientFit.value);
  });
});

// Run the GLSL decode itself so the shader and these expectations cannot drift.
function hemiOct(r: number, g: number): number[] {
  const match = CITADEL_NPR_GLSL.match(/vec3 citadelHemiOctNormal\(vec2 rg\) \{([^}]+)\}/);
  if (!match) throw new Error('missing citadelHemiOctNormal');
  const source = match[1].replace(/\bfloat\b|\bvec3\b(?= n)/g, 'let');
  const vec3 = (x: number, y: number, z: number) => [x, y, z];
  const normalize = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); return v.map((c) => c / l); };
  const fn = new Function('rg', 'vec3', 'normalize', 'abs', source.replace(/n\.x/g, 'n[0]').replace(/n\.y/g, 'n[1]').replace(/n\.z/g, 'n[2]').replace(/rg\.x/g, 'rg[0]').replace(/rg\.y/g, 'rg[1]'));
  return fn([r, g], vec3, normalize, Math.abs);
}

describe('hemi-octahedral normal decode', () => {
  it('reads the flat encoding as straight out', () => {
    const n = hemiOct(128 / 255, 128 / 255);
    expect(n[2]).toBeGreaterThan(0.999);
  });
  it('maps R+G to tangent X and R-G to tangent -Y (Source stores Y down)', () => {
    const tiltX = hemiOct(0.75, 0.75);
    expect(tiltX[0]).toBeGreaterThan(0.4);
    expect(Math.abs(tiltX[1])).toBeLessThan(1e-3);
    const tiltY = hemiOct(0.75, 0.25);
    expect(tiltY[1]).toBeLessThan(-0.4);
    expect(Math.abs(tiltY[0])).toBeLessThan(0.01);
  });
  it('is patched into three normal map decoding', () => {
    const patch = NPR_PATCH_MAP['*']['#include <normal_fragment_maps>'] as { value: string };
    expect(patch.value).toContain('citadelHemiOctNormal(');
  });
});

function morphic(extra: Partial<MorphicExtras> = {}): MorphicExtras {
  return {
    schema_version: 2, shader: 'pbr.vfx', blend_mode: 'opaque',
    ints: { F_USE_NPR_LIGHTING: 1, F_SELF_ILLUM: 1 },
    floats: { g_flSelfIllumScale1: 2.5, g_flSelfIllumFresnelMaskExponent: 3 },
    vectors: { g_vSelfIllumFresnelMaskTint1: [0.5, 0.25, 1, 0], g_vSelfIllumFresnelMaskRange1: [0.1, 0.9, 0, 0] },
    ...extra,
  };
}

describe('buildDeadlockMaterial Citadel wiring', () => {
  it('enables the faithful path with the authored self-illum inputs', () => {
    const base = new THREE.MeshStandardMaterial({ normalMap: new THREE.Texture() });
    base.userData.morphic = morphic();
    const built = buildDeadlockMaterial(base);
    expect(built.uniforms.uCitadelLighting.value).toBe(1);
    expect(built.uniforms.uCitadelHemiOctNormals.value).toBe(1);
    expect(built.uniforms.uCitadelSelfIllumOn.value).toBe(1);
    expect(built.uniforms.uCitadelSelfIllumScale.value).toBe(2.5);
    expect(built.uniforms.uCitadelSelfIllumFresnel.value.toArray()).toEqual([0.5, 0.25, 1, 3]);
    expect(built.uniforms.uCitadelSelfIllumFresnelRange.value.toArray()).toEqual([0.1, 0.9]);
    built.dispose();
  });

  it('lights blended and glass NPR materials while retaining the non-NPR fallback', () => {
    const cases: { extra: Partial<MorphicExtras>; enabled: number }[] = [
      { extra: { blend_mode: 'blend' }, enabled: 1 },
      { extra: { ints: { F_USE_NPR_LIGHTING: 1, F_GLASS: 1 } }, enabled: 1 },
      { extra: { ints: { F_SELF_ILLUM: 1 } }, enabled: 0 },
    ];
    for (const { extra, enabled } of cases) {
      const base = new THREE.MeshPhysicalMaterial();
      base.userData.morphic = morphic(extra);
      const built = buildDeadlockMaterial(base);
      expect(built.uniforms.uCitadelLighting.value).toBe(enabled);
      built.dispose();
    }
  });

  it('decodes hemi-oct normals only for pbr.vfx with a normal map', () => {
    const plain = new THREE.MeshStandardMaterial();
    plain.userData.morphic = morphic();
    const built = buildDeadlockMaterial(plain);
    expect(built.uniforms.uCitadelHemiOctNormals.value).toBe(0);
    built.dispose();
  });
});

describe('per-material sampler defines', () => {
  it('compiles detail and jitter samplers only when bound, without touching the base', () => {
    const base = new THREE.MeshStandardMaterial();
    base.userData.morphic = morphic();
    const built = buildDeadlockMaterial(base);
    const defines = (built.material as THREE.Material & { defines?: Record<string, string> }).defines ?? {};
    expect(defines.NPR_DETAIL_MAP).toBeUndefined();
    expect(defines.NPR_JITTER_MAP).toBeUndefined();
    built.dispose();

    const material = new THREE.MeshStandardMaterial();
    const shared = material.defines;
    applyNprMapDefines(material, true, false);
    expect(material.defines).toMatchObject({ NPR_DETAIL_MAP: '' });
    expect(material.defines).not.toBe(shared);
    expect(shared?.NPR_DETAIL_MAP).toBeUndefined();
  });

  it('starts rim depth occlusion off until the viewer binds a depth pass', () => {
    const uniforms = citadelNprUniforms(true);
    expect(uniforms.uCitadelDepthOn.value).toBe(0);
    expect(uniforms.uCitadelUnit.value).toBe(1);
  });
});
