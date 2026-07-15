import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MorphicExtras } from '../source2NprMaterial';
import { applySource2DrawState, resolveBlendMode, resolveSource2DrawState } from './drawState';
import { ADDITIVE_OVERLAY_RENDER_ORDER, TRANSLUCENT_OVERLAY_RENDER_ORDER } from './types';

function morphic(overrides: Partial<MorphicExtras> = {}): MorphicExtras {
  return { shader: 'pbr.vfx', ...overrides };
}

function meshWith(morphicExtras: MorphicExtras): {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
} {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  material.userData = { morphic: morphicExtras };
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  return { mesh, material };
}

describe('resolveBlendMode', () => {
  it('prefers the explicit blend_mode extras field', () => {
    expect(resolveBlendMode(morphic({ blend_mode: 'additive' }))).toBe('additive');
    expect(resolveBlendMode(morphic({ blend_mode: 'blend' }))).toBe('blend');
    expect(resolveBlendMode(morphic({ blend_mode: 'blend_zwrite' }))).toBe('blend_zwrite');
    expect(resolveBlendMode(morphic({ blend_mode: 'opaque' }))).toBe('opaque');
  });

  it('falls back to flags when blend_mode is absent (v1 GLBs)', () => {
    expect(resolveBlendMode(morphic({ ints: { F_ADDITIVE_BLEND: 1 } }))).toBe('additive');
    expect(resolveBlendMode(morphic({ ints: { F_TRANSLUCENT: 1 } }))).toBe('blend_zwrite');
    expect(resolveBlendMode(morphic({ ints: { F_ADVANCED_TRANSLUCENCY: 1 } }))).toBe('blend_zwrite');
    expect(resolveBlendMode(morphic())).toBe('opaque');
  });
});

describe('resolveSource2DrawState', () => {
  it('additive overlay: AdditiveBlending, depthTest on, depthWrite off, late renderOrder', () => {
    const plan = resolveSource2DrawState(morphic({ blend_mode: 'additive' }));
    expect(plan.isOverlay).toBe(true);
    expect(plan.additive).toBe(true);
    expect(plan.transparent).toBe(true);
    expect(plan.blending).toBe(THREE.AdditiveBlending);
    expect(plan.depthTest).toBe(true);
    expect(plan.depthWrite).toBe(false);
    expect(plan.renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);
  });

  it('translucent blend_zwrite keeps depthWrite on; plain blend turns it off', () => {
    const zwrite = resolveSource2DrawState(morphic({ blend_mode: 'blend_zwrite' }));
    expect(zwrite.translucent).toBe(true);
    expect(zwrite.transparent).toBe(true);
    expect(zwrite.depthWrite).toBe(true);
    expect(zwrite.renderOrder).toBe(TRANSLUCENT_OVERLAY_RENDER_ORDER);

    const blend = resolveSource2DrawState(morphic({ blend_mode: 'blend' }));
    expect(blend.translucent).toBe(true);
    expect(blend.depthWrite).toBe(false);
    expect(blend.renderOrder).toBe(TRANSLUCENT_OVERLAY_RENDER_ORDER);
  });

  it('opaque material is not an overlay and keeps default render state', () => {
    const plan = resolveSource2DrawState(morphic({ blend_mode: 'opaque' }));
    expect(plan.isOverlay).toBe(false);
    expect(plan.transparent).toBe(false);
    expect(plan.blending).toBe(THREE.NormalBlending);
    expect(plan.renderOrder).toBe(0);
    expect(plan.side).toBeNull();
    expect(plan.toneMapped).toBeNull();
  });

  it('F_RENDER_BACKFACES forces DoubleSide', () => {
    const plan = resolveSource2DrawState(morphic({ ints: { F_RENDER_BACKFACES: 1 } }));
    expect(plan.backfaces).toBe(true);
    expect(plan.side).toBe(THREE.DoubleSide);
  });

  it('F_UNLIT disables tone mapping', () => {
    const plan = resolveSource2DrawState(morphic({ ints: { F_UNLIT: 1 } }));
    expect(plan.unlit).toBe(true);
    expect(plan.toneMapped).toBe(false);
  });

  it('glass renders through transmission, never as an additive/translucent overlay', () => {
    const plan = resolveSource2DrawState(morphic({ ints: { F_GLASS: 1 } }));
    expect(plan.glass).toBe(true);
    expect(plan.additive).toBe(false);
    expect(plan.translucent).toBe(false);
    expect(plan.isOverlay).toBe(false);
  });

  it('explicit additive blend_mode wins over a glass flag', () => {
    const plan = resolveSource2DrawState(morphic({ ints: { F_GLASS: 1 }, blend_mode: 'additive' }));
    expect(plan.glass).toBe(false);
    expect(plan.additive).toBe(true);
  });
});

describe('applySource2DrawState', () => {
  it('applies the additive rule to mesh + material and reports the plan', () => {
    const { mesh, material } = meshWith(morphic({ blend_mode: 'additive' }));
    const app = applySource2DrawState(mesh, material);
    expect(app).not.toBeNull();
    expect(app!.plan.additive).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);
  });

  it('restore reverts every mutation to the original GLTFLoader state', () => {
    const { mesh, material } = meshWith(morphic({ blend_mode: 'additive', ints: { F_RENDER_BACKFACES: 1 } }));
    const before = {
      transparent: material.transparent,
      blending: material.blending,
      depthWrite: material.depthWrite,
      side: material.side,
      renderOrder: mesh.renderOrder,
    };
    const app = applySource2DrawState(mesh, material);
    expect(material.side).toBe(THREE.DoubleSide);
    app!.restore!();
    expect(material.transparent).toBe(before.transparent);
    expect(material.blending).toBe(before.blending);
    expect(material.depthWrite).toBe(before.depthWrite);
    expect(material.side).toBe(before.side);
    expect(mesh.renderOrder).toBe(before.renderOrder);
  });

  it('leaves a plain opaque material untouched (no restore needed)', () => {
    const { mesh, material } = meshWith(morphic({ blend_mode: 'opaque' }));
    material.transparent = false;
    const app = applySource2DrawState(mesh, material);
    expect(app).not.toBeNull();
    expect(app!.restore).toBeNull();
    expect(material.transparent).toBe(false);
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(mesh.renderOrder).toBe(0);
  });

  it('returns null when the material has no morphic extras', () => {
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    expect(applySource2DrawState(mesh, material)).toBeNull();
  });

  it('infers additive from F_ADDITIVE_BLEND on a v1 GLB (no blend_mode)', () => {
    const { mesh, material } = meshWith(morphic({ ints: { F_ADDITIVE_BLEND: 1 } }));
    applySource2DrawState(mesh, material);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);
  });
});

describe('real Deadlock overlay materials (vpkmerge round-trip fixtures)', () => {
  // Captured from a local vpkmerge export against the shipped pak01 (the glow
  // overlays the exporter now keeps). The notable nuance: these carry
  // self_illum_valid=false (a placeholder self-illum mask) but blend_mode
  // 'additive', so the additive rule must key on the blend mode, NOT on a valid
  // self-illum mask, or the overlays would render opaque.
  it.each([
    ['inferno_armglow.vmat', { shader: 'pbr.vfx', blend_mode: 'additive', self_illum_valid: false, ints: { F_ADDITIVE_BLEND: 1, F_SELF_ILLUM: 1 } }],
    ['inferno_headglow.vmat', { shader: 'pbr.vfx', blend_mode: 'additive', self_illum_valid: false, ints: { F_ADDITIVE_BLEND: 1, F_SELF_ILLUM: 1 } }],
    ['vindicta_glow.vmat (hornet ghost_glow)', { shader: 'pbr.vfx', blend_mode: 'additive', self_illum_valid: false, ints: { F_ADDITIVE_BLEND: 1, F_SELF_ILLUM: 1 } }],
  ] as const)('%s composites additively despite self_illum_valid=false', (_name, extras) => {
    const { mesh, material } = meshWith(extras as MorphicExtras);
    const app = applySource2DrawState(mesh, material);
    expect(app!.plan.additive).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);
  });
});
