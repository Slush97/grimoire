import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ParticleSystemSimulation } from '../../../lib/particles/simulation';
import { createParticleDrawLayer } from './particleDrawLayer';

describe('particles in the transmission framebuffer', () => {
  it.each([false, true])('preserves renderer blend and depth state beforeTransmission=%s', (beforeTransmission) => {
    const simulation = new ParticleSystemSimulation({ name: 'particles/test.vpcf_c', format: null, data: {
      m_Renderers: [
        { _class: 'C_OP_RenderSprites', m_nOutputBlendMode: 'PARTICLE_OUTPUT_BLEND_MODE_ADD' },
        { _class: 'C_OP_RenderSprites', m_nOutputBlendMode: 'PARTICLE_OUTPUT_BLEND_MODE_ALPHA' },
        { _class: 'C_OP_RenderRopes', m_bDrawAsOpaque: true },
      ],
    } }, { loadSystem: () => null });
    const layer = createParticleDrawLayer(simulation, { get: () => null }, undefined, beforeTransmission);
    const draws: THREE.Mesh[] = [];
    layer.object3d.traverse((object) => { if (object instanceof THREE.Mesh) draws.push(object); });
    expect(draws).toHaveLength(3);
    for (const mesh of draws.slice(0, 2)) {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      expect(material.transparent).toBe(!beforeTransmission);
      expect(material.blending).toBe(THREE.CustomBlending);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
    }
    const opaque = draws[2].material;
    if (Array.isArray(opaque)) throw new Error('Expected one rope material');
    expect(opaque.transparent).toBe(false);
    expect(opaque.depthWrite).toBe(true);
    expect(opaque.blending).toBe(THREE.NoBlending);
    expect(draws.map((draw) => draw.renderOrder)).toEqual(beforeTransmission ? [11, 12, 13] : [1, 2, 3]);
    layer.dispose();
  });
});
