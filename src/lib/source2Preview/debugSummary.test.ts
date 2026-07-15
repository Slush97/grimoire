import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MorphicExtras } from '../source2NprMaterial';
import { compileSource2DrawState } from './compileScene';
import { summarizeSource2Scene } from './debugSummary';

function meshNamed(name: string, morphic: MorphicExtras | null): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  if (morphic) material.userData = { morphic };
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = name;
  return mesh;
}

function scene(): THREE.Scene {
  const s = new THREE.Scene();
  s.add(meshNamed('body', { shader: 'pbr.vfx', blend_mode: 'opaque' }));
  s.add(
    meshNamed('arm_glow', {
      shader: 'pbr.vfx',
      blend_mode: 'additive',
      ints: { F_SELF_ILLUM: 1 },
      floats: { g_flSelfIllumScale1: 1.5 },
    })
  );
  s.add(meshNamed('goo', { shader: 'pbr.vfx', blend_mode: 'blend' }));
  s.add(meshNamed('plain', null));
  return s;
}

describe('summarizeSource2Scene', () => {
  it('counts materials, morphic materials, and blend-mode distribution', () => {
    const summary = summarizeSource2Scene(scene());
    expect(summary.materialCount).toBe(4);
    expect(summary.morphicMaterialCount).toBe(3);
    expect(summary.additiveMaterialCount).toBe(1);
    expect(summary.translucentMaterialCount).toBe(1);
    expect(summary.selfIllumMaterialCount).toBe(1);
    expect(summary.blendModeDistribution.additive).toBe(1);
    expect(summary.blendModeDistribution.blend).toBe(1);
    expect(summary.blendModeDistribution.opaque).toBe(1);
  });

  it('reports overlay mesh names and the applied renderOrder distribution', () => {
    const s = scene();
    compileSource2DrawState(s); // apply draw state first, then inspect orders
    const summary = summarizeSource2Scene(s);
    expect(summary.overlayMeshNames).toContain('arm_glow');
    expect(summary.overlayMeshNames).toContain('goo');
    expect(summary.overlayMeshNames).not.toContain('body');
    // body + plain stay at 0; the two overlays move to 8 / 10.
    expect(summary.renderOrderDistribution[0]).toBe(2);
    expect(summary.renderOrderDistribution[10]).toBe(1);
    expect(summary.renderOrderDistribution[8]).toBe(1);
  });
});
