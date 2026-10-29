import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ParticleSystemSimulation } from '../../../lib/particles/simulation';
import { createParticleDrawLayer } from './particleDrawLayer';

describe('particles in the transmission framebuffer', () => {
  it('draws each primitive with its own exported material path', () => {
    const simulation = new ParticleSystemSimulation({ name: 'own-materials', format: 'vpcf61', data: {
      m_nInitialParticles: 1, m_Renderers: [{ _class: 'C_OP_RenderModels', m_ModelList: [{ m_model: 'models/test.vmdl' }] }],
    } }, { loadSystem: () => null });
    const paths = ['models/a/body.vmat', 'models/b/body.vmat'];
    const requests: string[] = [];
    const layer = createParticleDrawLayer(simulation, { get: () => null }, {
      model: () => ({ name: 'models/test.vmdl', flags: 0, materialGroups: [], bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        primitives: paths.map(material => ({ material, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: null, uvs: null, uvs2: null, colors: null, indices: null })) }),
      material: path => { requests.push(path); return { name: path, shader: 'pbr.vfx', intParams: { F_UNLIT: 1 }, floatParams: {}, vectorParams: {}, textureParams: {}, intAttributes: {} }; },
    });
    simulation.start();
    const camera = new THREE.PerspectiveCamera();
    for (let frame = 1; frame <= 3; frame++) { simulation.update(1 / 60, frame / 60); layer.update(camera, [720, 720], frame / 60); }
    expect(requests).toEqual(paths);
    const draws: THREE.Mesh[] = []; layer.object3d.traverse(object => { if (object instanceof THREE.Mesh) draws.push(object); });
    expect(draws).toHaveLength(2);
    expect(draws.map(draw => draw.name)).toEqual(paths.map(path => `models/test.vmdl [${path}]`));
    expect(simulation.diagnostics.ofKind('warning')).toEqual([]);
    simulation.stop(); layer.dispose();
  });
  it('reports missing model draw materials instead of claiming a rendered model', () => {
    const simulation = new ParticleSystemSimulation({ name: 'missing-materials', format: 'vpcf61', data: {
      m_nInitialParticles: 1,
      m_Renderers: [{ _class: 'C_OP_RenderModels', m_ModelList: [{ m_model: 'models/test.vmdl' }] }],
    } }, { loadSystem: () => null });
    const layer = createParticleDrawLayer(simulation, { get: () => null }, {
      model: () => ({ name: 'models/test.vmdl', flags: 0, materialGroups: [], bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        primitives: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: null, uvs: null, uvs2: null, colors: null, indices: null }] }),
      material: () => null,
    });
    simulation.start();
    const camera = new THREE.PerspectiveCamera();
    for (let frame = 1; frame <= 3; frame++) {
      simulation.update(1 / 60, frame / 60);
      layer.update(camera, [720, 720], frame / 60);
    }
    expect(simulation.diagnostics.ofKind('warning').map(entry => entry.message)).toEqual([
      "Particle model draw 'models/test.vmdl#0' has no material; the draw is omitted.",
    ]);
    const draws: THREE.Mesh[] = [];
    layer.object3d.traverse(object => { if (object instanceof THREE.Mesh) draws.push(object); });
    expect(draws).toHaveLength(0);
    simulation.stop(); layer.dispose();
  });
  it.each([
    ['PARTICLE_DEPTH_FEATHERING_OFF', false, false],
    ['PARTICLE_DEPTH_FEATHERING_ON_OPTIONAL', true, false],
    ['PARTICLE_DEPTH_FEATHERING_ON_REQUIRED', true, true],
  ])('distinguishes required from optional depth for %s', (mode, wants, required) => {
    const simulation = new ParticleSystemSimulation({ name: 'depth', format: 'vpcf61', data: {
      m_Renderers: [{ _class: 'C_OP_RenderSprites', m_nFeatheringMode: mode }],
    } }, { loadSystem: () => null });
    const layer = createParticleDrawLayer(simulation, { get: () => null });
    expect(layer.wantsSceneDepth).toBe(wants);
    expect(layer.requiresSceneDepth).toBe(required);
    layer.dispose();
  });
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
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.forceSinglePass).toBe(true);
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
