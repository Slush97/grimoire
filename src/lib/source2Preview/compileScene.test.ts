import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MorphicExtras } from '../source2NprMaterial';
import { compileSource2DrawState } from './compileScene';
import { ADDITIVE_OVERLAY_RENDER_ORDER, TRANSLUCENT_OVERLAY_RENDER_ORDER } from './types';

function meshNamed(name: string, morphic: MorphicExtras | null): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  if (morphic) material.userData = { morphic };
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = name;
  return mesh;
}

function sampleScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(meshNamed('body', { shader: 'pbr.vfx', blend_mode: 'opaque' }));
  scene.add(meshNamed('inferno_armglow', { shader: 'pbr.vfx', blend_mode: 'additive' }));
  scene.add(meshNamed('ghost_glow', { shader: 'pbr.vfx', ints: { F_ADDITIVE_BLEND: 1 } }));
  scene.add(meshNamed('goo', { shader: 'pbr.vfx', blend_mode: 'blend_zwrite' }));
  scene.add(meshNamed('cape', { shader: 'pbr.vfx', ints: { F_RENDER_BACKFACES: 1 } }));
  scene.add(meshNamed('plain', null)); // a non-morphic mesh is ignored
  return scene;
}

describe('compileSource2DrawState', () => {
  it('applies draw state across the scene and tallies stats', () => {
    const scene = sampleScene();
    const { stats } = compileSource2DrawState(scene);
    expect(stats.morphicMaterials).toBe(5);
    expect(stats.additive).toBe(2); // inferno_armglow + ghost_glow
    expect(stats.translucent).toBe(1); // goo
    expect(stats.backfaces).toBe(1); // cape
  });

  it('pushes additive overlays to a late renderOrder, leaves the body opaque', () => {
    const scene = sampleScene();
    compileSource2DrawState(scene);
    const byName = (n: string) => scene.children.find((c) => c.name === n) as THREE.Mesh;
    expect(byName('inferno_armglow').renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);
    expect(byName('ghost_glow').renderOrder).toBe(ADDITIVE_OVERLAY_RENDER_ORDER);
    expect(byName('goo').renderOrder).toBe(TRANSLUCENT_OVERLAY_RENDER_ORDER);
    expect(byName('body').renderOrder).toBe(0);

    const glow = byName('inferno_armglow').material as THREE.MeshStandardMaterial;
    expect(glow.blending).toBe(THREE.AdditiveBlending);
    expect(glow.depthWrite).toBe(false);
    expect(glow.transparent).toBe(true);

    const body = byName('body').material as THREE.MeshStandardMaterial;
    expect(body.transparent).toBe(false);
    expect(body.blending).toBe(THREE.NormalBlending);
  });

  it('restore reverts the whole scene to its original draw state', () => {
    const scene = sampleScene();
    const { restore } = compileSource2DrawState(scene);
    restore();
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      expect(mesh.renderOrder).toBe(0);
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (mat) {
        expect(mat.blending).toBe(THREE.NormalBlending);
        expect(mat.transparent).toBe(false);
        expect(mat.depthWrite).toBe(true);
      }
    }
  });

  it('is a no-op on a scene with no morphic materials', () => {
    const scene = new THREE.Scene();
    scene.add(meshNamed('plain', null));
    const { stats } = compileSource2DrawState(scene);
    expect(stats.morphicMaterials).toBe(0);
    expect(stats.meshes).toBe(0);
  });
});
