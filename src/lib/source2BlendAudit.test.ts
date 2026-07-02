/**
 * ============================================================================
 * BLEND-AUDIT-TEMP  --  TEMPORARY diagnostic harness, safe to delete.
 * ============================================================================
 * Companion to tools/blend-testbed.html. The .html shows the *visual* blend-math
 * soft spots (alpha-weighted additive, no intra-mesh sort, per-mesh renderOrder).
 * This file proves the two *code-path* claims that a visual mock cannot honestly
 * demonstrate, by running the REAL modules:
 *
 *   1. "What draw-state ignores"  (skips non-morphic / opaque / glass; never
 *      touches polygonOffset, depthTest, or material appearance).
 *   2. "The gotcha": with `unified` on (default), the rendered material is the
 *      buildDeadlockMaterial CLONE; the always-on draw-state pass is RESTORED on
 *      the base, and only the mesh-level renderOrder survives. The two files
 *      stay in sync only because both read the shared resolveBlendMode.
 *
 * This file ONLY IMPORTS the preview modules; it does not modify them.
 * To remove the whole harness:  rm src/lib/source2BlendAudit.test.ts
 *                               rm tools/blend-testbed.html
 * (grep token: BLEND-AUDIT-TEMP)
 * ============================================================================
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import {
  resolveSource2DrawState,
  applySource2DrawState,
} from './source2Preview/drawState';
import { compileSource2DrawState } from './source2Preview/compileScene';
import { resolveBlendMode } from './source2Preview/blendMode';
import {
  ADDITIVE_OVERLAY_RENDER_ORDER,
  TRANSLUCENT_OVERLAY_RENDER_ORDER,
} from './source2Preview/types';
import { buildDeadlockMaterial } from './deadlockMaterial';
import type { MorphicExtras } from './source2NprMaterial';

function baseWith(morphic: MorphicExtras): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff });
  m.userData = { morphic };
  return m;
}
function meshWith(mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
}

const OPAQUE: MorphicExtras = { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1 } };
const ADDITIVE: MorphicExtras = {
  shader: 'pbr.vfx',
  blend_mode: 'additive',
  ints: { F_USE_NPR_LIGHTING: 1, F_ADDITIVE_BLEND: 1, F_SELF_ILLUM: 1 },
  floats: { g_flSelfIllumScale1: 5 },
};
const TRANSLUCENT: MorphicExtras = {
  shader: 'pbr.vfx',
  blend_mode: 'blend_zwrite',
  ints: { F_USE_NPR_LIGHTING: 1, F_TRANSLUCENT: 1 },
};
const GLASS: MorphicExtras = { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, F_GLASS: 1 } };

// ---------------------------------------------------------------------------
describe('BLEND-AUDIT-TEMP: what draw-state ignores', () => {
  it('skips materials with no morphic extras (returns null)', () => {
    const mat = new THREE.MeshStandardMaterial();
    const app = applySource2DrawState(meshWith(mat), mat);
    expect(app).toBeNull();
  });

  it('no-ops on plain opaque morphic materials (restore is null, material untouched)', () => {
    const mat = baseWith(OPAQUE);
    const before = { blending: mat.blending, transparent: mat.transparent };
    const app = applySource2DrawState(meshWith(mat), mat, OPAQUE);
    expect(app).not.toBeNull();
    expect(app!.restore).toBeNull(); // <- the "no-op" signal
    expect(mat.blending).toBe(before.blending);
    expect(mat.transparent).toBe(before.transparent);
  });

  it('excludes glass from the blend rules (routed to transmission instead)', () => {
    const plan = resolveSource2DrawState(GLASS, baseWith(GLASS));
    expect(plan.glass).toBe(true);
    expect(plan.additive).toBe(false);
    expect(plan.translucent).toBe(false);
    expect(plan.isOverlay).toBe(false);
  });

  it('never enables polygonOffset, and only ever sets depthTest=true (both dead/no-op)', () => {
    for (const m of [OPAQUE, ADDITIVE, TRANSLUCENT, GLASS]) {
      const plan = resolveSource2DrawState(m);
      expect(plan.polygonOffset).toBe(false); // drawState.ts:89 hardcoded false
      expect(plan.depthTest).toBe(true); // only ever true == GLTFLoader default
    }
  });

  it('never touches material appearance (no emissive/opacity/sheen in the plan or on apply)', () => {
    const plan = resolveSource2DrawState(ADDITIVE);
    expect('emissive' in plan).toBe(false);
    expect('opacity' in plan).toBe(false);
    expect('sheen' in plan).toBe(false);
    expect('map' in plan).toBe(false);

    const mat = baseWith(ADDITIVE);
    mat.emissive = new THREE.Color(0x123456);
    mat.opacity = 0.7;
    applySource2DrawState(meshWith(mat), mat, ADDITIVE);
    expect(mat.emissive.getHex()).toBe(0x123456); // unchanged
    expect(mat.opacity).toBe(0.7); // unchanged (opacity scaling lives in the builders)
  });

  it('compile pass counts only morphic meshes; non-morphic geometry is skipped', () => {
    const scene = new THREE.Group();
    scene.add(meshWith(new THREE.MeshStandardMaterial())); // no morphic -> skipped
    scene.add(meshWith(baseWith(ADDITIVE))); // morphic additive -> counted
    const { stats, restore } = compileSource2DrawState(scene);
    expect(stats.meshes).toBe(1);
    expect(stats.morphicMaterials).toBe(1);
    expect(stats.additive).toBe(1);
    restore();
  });
});

// ---------------------------------------------------------------------------
describe('BLEND-AUDIT-TEMP: unified clone supersedes the draw-state pass', () => {
  // CORRECTED by this harness: what survives is the MATERIAL SWAP, not restore().
  // restore() is symmetric and reverts mesh.renderOrder too (drawState.ts:165).
  it('renderOrder survives the unified material SWAP; the base mutation stops rendering', () => {
    const base = baseWith(ADDITIVE);
    const mesh = meshWith(base);
    const scene = new THREE.Group();
    scene.add(mesh);

    // 1) Always-on pass mutates the GLTF base material in place + sets mesh order.
    compileSource2DrawState(scene);
    expect(base.blending).toBe(THREE.AdditiveBlending);
    expect(base.transparent).toBe(true);
    expect(base.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);

    // 2) Unified builder clones the base and swaps the clone onto the mesh.
    //    This is the LIVE runtime flow (no restore() while the model is shown).
    const built = buildDeadlockMaterial(base);
    mesh.material = built.material;

    // mesh.renderOrder is untouched by the swap -> it orders the CLONE. (Survives.)
    expect(mesh.renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);
    // The clone is what renders; the draw-state mutation on `base` no longer
    // contributes anything (base is detached from the mesh).
    expect(mesh.material).not.toBe(base);
    expect((mesh.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);

    built.dispose();
  });

  it('the clone decides blending ITSELF (not inherited from the base)', () => {
    // Build from a FRESH base that never went through draw-state (NormalBlending).
    // An AdditiveBlending clone therefore proves deadlockMaterial.ts:327 set it,
    // not a copied-from-base value.
    const fresh = baseWith(ADDITIVE);
    expect(fresh.blending).toBe(THREE.NormalBlending);
    const built = buildDeadlockMaterial(fresh);
    expect((built.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);
    built.dispose();
  });

  it('restore() is a COMPLETE teardown: it reverts the base AND renderOrder', () => {
    const base = baseWith(ADDITIVE);
    const mesh = meshWith(base);
    const scene = new THREE.Group();
    scene.add(mesh);

    const compiled = compileSource2DrawState(scene);
    expect(mesh.renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);

    compiled.restore();
    expect(base.blending).toBe(THREE.NormalBlending); // reverted
    expect(base.transparent).toBe(false); // reverted
    expect(base.depthWrite).toBe(true); // reverted
    expect(mesh.renderOrder).toBe(0); // ALSO reverted -- does NOT survive restore()
  });

  it('the two files agree ONLY via the shared resolveBlendMode', () => {
    // drawState.ts:46 and deadlockMaterial.ts:264 both call resolveBlendMode(morphic).
    // Nothing else couples them: change one mapping and they silently drift.
    for (const [m, expected] of [
      [ADDITIVE, 'additive'],
      [TRANSLUCENT, 'blend_zwrite'],
      [OPAQUE, 'opaque'],
    ] as const) {
      expect(resolveBlendMode(m)).toBe(expected);
      expect(resolveSource2DrawState(m).blendMode).toBe(resolveBlendMode(m));
    }
    // translucent draw-state order constant, asserted so the harness pins both orders.
    expect(resolveSource2DrawState(TRANSLUCENT).renderOrder).toBe(TRANSLUCENT_OVERLAY_RENDER_ORDER);
  });
});
