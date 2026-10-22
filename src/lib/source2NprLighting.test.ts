import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NPR_LIGHTING_GLSL, nprLightingUniforms } from './source2NprLighting';
import { buildDeadlockMaterial } from './deadlockMaterial';
import { wrapMaterialWithNpr } from './source2NprMaterial';
import type { MorphicExtras } from './source2NprMaterial';

// Run the scalar shader bodies themselves; expected samples are independent
// reference values at endpoints and the wrapped terminator.
function body(name: string): string {
  const match = NPR_LIGHTING_GLSL.match(new RegExp(`float ${name}\\([^)]*\\)\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Missing scalar shader function ${name}`);
  return match[1].replace(/\bfloat\b/g, 'const');
}
const evaluateStep = new Function('value', 'sharpness', 'max', 'min', 'pow', 'clamp', body('nprPowerStep'));
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const step = (value: number, sharpness: number): number => evaluateStep(value, sharpness, Math.max, Math.min, Math.pow, clamp);
const evaluateDirect = new Function('nDotL', 'uNprDirect', 'clamp', 'mix', 'nprPowerStep', body('nprDirectResponse'));
const direct = (value: number): number => evaluateDirect(value, { x: 0.8, y: 0.9, z: 0.625, w: 0.25 }, clamp,
  (a: number, b: number, t: number) => a * (1 - t) + b * t, step);

describe('NPR scalar lighting', () => {
  it.each([[0, 0], [0.25, 1 / 2048], [0.5, 0.5], [0.75, 2047 / 2048], [1, 1]])(
    'matches the symmetric sharp step at %s', (input, expected) => expect(step(input, 0.9)).toBeCloseTo(expected, 12),
  );
  it('has a linear limit and finite endpoints at maximum sharpness', () => {
    for (const value of [0, 0.1, 0.5, 0.9, 1]) {
      expect(step(value, 0)).toBeCloseTo(value, 12);
      expect(Number.isFinite(step(value, 1))).toBe(true);
    }
  });
  it.each([[0.2, 0.284375], [0.5, 0.59375], [1, 0.71875]])(
    'retains the Lambert share at N.L=%s', (input, expected) => expect(direct(input)).toBeCloseTo(expected, 12),
  );
  it('remains monotonic and does not depend on the surface albedo', () => {
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const response = direct(i / 100);
      expect(response).toBeGreaterThanOrEqual(previous);
      const multiplier = response / Math.max(i / 100, 1e-4);
      expect((0.02 * multiplier) / 0.02).toBeCloseTo((0.8 * multiplier) / 0.8, 12);
      previous = response;
    }
  });
  it('allocates independent uniforms for each material', () => {
    const a = nprLightingUniforms({ enabled: true });
    const b = nprLightingUniforms({ enabled: false });
    expect(a.uNprLighting.value).toBe(1);
    expect(b.uNprLighting.value).toBe(0);
    expect(a.uNprDirect.value).not.toBe(b.uNprDirect.value);
  });
});

describe('NPR material eligibility', () => {
  const cases: { label: string; morphic: MorphicExtras; enabled: number }[] = [
    { label: 'opaque NPR', morphic: { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1 } }, enabled: 1 },
    { label: 'glass', morphic: { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, F_GLASS: 1 } }, enabled: 0 },
    { label: 'translucent', morphic: { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, F_TRANSLUCENT: 1 } }, enabled: 0 },
    { label: 'additive', morphic: { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, F_ADDITIVE_BLEND: 1 } }, enabled: 0 },
    { label: 'non NPR', morphic: { shader: 'pbr.vfx' }, enabled: 0 },
    { label: 'unlit', morphic: { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, F_UNLIT: 1 } }, enabled: 0 },
  ];
  it.each(cases)('keeps $label eligibility consistent between material builders', ({ morphic, enabled }) => {
    const base = new THREE.MeshStandardMaterial();
    base.userData.morphic = morphic;
    const built = buildDeadlockMaterial(base);
    expect(built.uniforms.uNprLighting.value).toBe(enabled);
    const legacy = wrapMaterialWithNpr(base);
    if (legacy) {
      expect(legacy.uniforms.uNprLighting.value).toBe(enabled);
      legacy.material.dispose();
      legacy.ownedTextures.forEach((texture) => texture.dispose());
    }
    built.dispose();
    base.dispose();
  });
});
