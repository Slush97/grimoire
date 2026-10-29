import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { canRenderAuthoredShell, citadelOutlineMesh, hasCitadelNprOutline, hideAuthoredShells } from './citadelNprOutline';
import { buildDeadlockMaterial } from './deadlockMaterial';

function material(ints: Record<string, number> = {}) {
  const base = new THREE.MeshStandardMaterial();
  base.userData.morphic = { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1, ...ints } };
  return base;
}

describe('Citadel NPR outline pass', () => {
  it.each(['F_GLASS', 'F_TRANSLUCENT', 'F_ADVANCED_TRANSLUCENCY', 'F_CLOAK', 'F_UNLIT', 'F_DISABLE_NPR_OUTLINE'])('honors the shader exclusion %s', (name) => {
    const base = material({ [name]: 1 });
    expect(hasCitadelNprOutline(base)).toBe(false);
    base.dispose();
  });

  it('hides marked geometry before rendering and accepts only the supported opaque path', () => {
    const base = material();
    const shell = new THREE.Mesh(new THREE.BufferGeometry(), base);
    const mask = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    base.userData.morphic.resolvedTextures = { g_tNprOutlineMask: mask };
    const body = new THREE.Mesh(new THREE.BufferGeometry(), base);
    const scene = new THREE.Group();
    scene.add(shell, body);
    shell.geometry.userData.morphic_shell = { version: 1, role: 'authored_shell' };
    hideAuthoredShells(scene);
    expect(shell.userData.morphic_shell).toEqual({ version: 1, role: 'authored_shell' });
    expect(shell.visible).toBe(false);
    expect(body.visible).toBe(true);
    expect(canRenderAuthoredShell(shell)).toBe(true);
    base.userData.morphic.resolvedTextures = {};
    expect(canRenderAuthoredShell(shell)).toBe(false);
    base.userData.morphic.resolvedTextures.g_tNprOutlineMask = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    expect(canRenderAuthoredShell(shell)).toBe(false);
    base.userData.morphic.resolvedTextures.g_tNprOutlineMask.dispose();
    base.userData.morphic.resolvedTextures.g_tNprOutlineMask = mask;
    for (const name of ['F_JITTER_VERTICES', 'F_ADVANCED_TRANSLUCENCY', 'F_RENDER_BACKFACES', 'F_GLASS']) {
      base.userData.morphic.ints[name] = 1;
      expect(canRenderAuthoredShell(shell)).toBe(false);
      delete base.userData.morphic.ints[name];
    }
    shell.userData.morphic_shell.version = 2;
    expect(canRenderAuthoredShell(shell)).toBe(false);
    shell.userData.morphic_shell = null;
    expect(canRenderAuthoredShell(shell)).toBe(false);
    base.dispose(); mask.dispose(); shell.geometry.dispose(); body.geometry.dispose();
  });

  it('keeps authored hulls out of the glass framebuffer and depth tests their opaque output', () => {
    const base = material();
    const built = buildDeadlockMaterial(base, undefined, null, 'authored', 'authored-shell');
    expect(built.material.side).toBe(THREE.FrontSide);
    expect(built.material.transparent).toBe(true);
    expect(built.material.blending).toBe(THREE.NoBlending);
    expect(built.material.depthTest).toBe(true);
    expect(built.material.depthWrite).toBe(true);
    expect('defines' in built.material && built.material.defines).toMatchObject({ OPAQUE: '' });
    expect(base.transparent).toBe(false);
    expect(base.blending).toBe(THREE.NormalBlending);
    built.dispose(); base.dispose();
  });

  it('allows alpha-tested geometry and leaves the enemy-only solid outline undrawn', () => {
    const cases: Array<Record<string, number>> = [{}, { F_ALPHA_TEST: 1 }];
    for (const ints of cases) {
      const base = material(ints);
      expect(hasCitadelNprOutline(base)).toBe(true);
      base.dispose();
    }
    const solid = material({ F_SOLID_COLOR_OUTLINE: 1 });
    expect(hasCitadelNprOutline(solid)).toBe(false);
    solid.dispose();
  });

  it('shares the live skinned and morphed pose without altering its transform', () => {
    const geometry = new THREE.BoxGeometry();
    const base = material();
    const mesh = new THREE.SkinnedMesh(geometry, base);
    const skeleton = new THREE.Skeleton([new THREE.Bone()]);
    mesh.bind(skeleton);
    mesh.morphTargetInfluences = [0.4];
    mesh.position.set(1, 2, 3);
    mesh.scale.setScalar(0.0254);
    const shell = citadelOutlineMesh(mesh, base);
    mesh.add(shell);
    mesh.updateMatrixWorld(true);
    expect(shell).toBeInstanceOf(THREE.SkinnedMesh);
    if (!(shell instanceof THREE.SkinnedMesh)) throw new Error('Expected skinned outline');
    expect(shell.skeleton).toBe(skeleton);
    expect(shell.geometry).toBe(geometry);
    expect(shell.morphTargetInfluences).toBe(mesh.morphTargetInfluences);
    expect(shell.matrixWorld.elements).toEqual(mesh.matrixWorld.elements);
    expect(shell.bindMatrixInverse.elements).toEqual(mesh.bindMatrixInverse.elements);
    geometry.dispose(); base.dispose(); skeleton.dispose();
  });

  it('builds an owned opaque backface pass with authored thickness', () => {
    const base = material({ g_bOverrideNprOutline: 1 });
    base.userData.morphic.floats = { g_flOverrideNprOutlineThickness: 0.17 };
    const built = buildDeadlockMaterial(base, undefined, null, 'authored', 'outline');
    expect(built.material.side).toBe(THREE.BackSide);
    expect(built.material.transparent).toBe(false);
    expect(built.material.blending).toBe(THREE.NoBlending);
    expect(built.uniforms.uCitadelOutlineThickness.value).toBe(0.17);
    expect(base.side).toBe(THREE.FrontSide);
    built.dispose(); base.dispose();
  });

  it('keeps authored zero framebuffer noise and compiles the sampler only for noise users', () => {
    for (const amount of [0, 0.235]) {
      const base = material({ F_GLASS: 1 });
      base.userData.morphic.floats = { g_flCloakBlurNoiseAmount: amount };
      const built = buildDeadlockMaterial(base);
      expect(built.uniforms.uCitadelGlassNoiseAmount.value).toBe(amount);
      expect('defines' in built.material && built.material.defines && typeof built.material.defines === 'object'
        && 'NPR_GLASS_NOISE' in built.material.defines).toBe(amount > 0);
      built.dispose(); base.dispose();
    }
  });
});
