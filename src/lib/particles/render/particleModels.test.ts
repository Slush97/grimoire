import { describe, expect, it } from 'vitest';
import { matrixColorCorrect2, matrixColorTint3 } from './modelMaterial';
import { deserializeModelMesh, particleResourceKey, readParticleMaterial, serializeModelMesh } from './particleModels';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('particle models', () => {
  it('round trips a mesh through the bundle encoding', () => {
    const mesh = {
      name: 'models/a.vmdl',
      primitives: [{ positions: new Float32Array([1, 2, 3, -4, 5.5, 6]), normals: null, uvs: new Float32Array([0.25, 0.75, 1, 0]), uvs2: null, colors: null, indices: new Uint32Array([0, 1, 1]) }],
      bounds: { min: [-4, 2, 3] as [number, number, number], max: [1, 5.5, 6] as [number, number, number] },
      flags: 0x400,
      materialGroups: ['default'],
    };
    const decoded = deserializeModelMesh(JSON.parse(JSON.stringify(serializeModelMesh(mesh))));
    expect(Array.from(decoded.primitives[0].positions)).toEqual([1, 2, 3, -4, 5.5, 6]);
    expect(Array.from(decoded.primitives[0].uvs!)).toEqual([0.25, 0.75, 1, 0]);
    expect(Array.from(decoded.primitives[0].indices!)).toEqual([0, 1, 1]);
    expect(decoded.primitives[0].normals).toBeNull();
    expect(decoded.flags).toBe(0x400);
  });

  it('reads a decoded material', () => {
    const material = readParticleMaterial({
      m_materialName: 'models/particle/materials/x.vmat', m_shaderName: 'pbr.vfx',
      m_intParams: [{ m_name: 'F_UNLIT', m_nValue: 1 }], m_floatParams: [{ m_name: 'g_flOpacityScale1', m_flValue: 0.5 }],
      m_vectorParams: [{ m_name: 'g_vTranslucentScrollSpeed0_1', m_value: [0, -2, 0, 0] }],
      m_textureParams: [{ m_name: 'g_tColor', m_pValue: 'materials/particle/x.vtex_c' }], m_intAttributes: [],
    });
    expect(material).toMatchObject({ shader: 'pbr.vfx', intParams: { F_UNLIT: 1 }, floatParams: { g_flOpacityScale1: 0.5 } });
    expect(material.vectorParams.g_vTranslucentScrollSpeed0_1).toEqual([0, -2, 0, 0]);
    expect(material.textureParams.g_tColor).toBe('materials/particle/x.vtex');
    expect(particleResourceKey('Models/A.vmdl_c')).toBe('models/a.vmdl');
  });

  it('builds the identity colour matrices for neutral params', () => {
    matrixColorCorrect2([1, 1, 1], [0.3, 0.5, 0.7]).forEach((value, i) => expect(value).toBeCloseTo(identity[i], 5));
    matrixColorTint3([1, 1, 1], 0.85, 1).forEach((value, i) => expect(value).toBeCloseTo(identity[i], 5));
    expect(matrixColorTint3([0.5, 1, 0.25], 0.85, 2).filter((_, i) => i % 5 === 0)).toEqual([1, 2, 0.5, 1]);
  });

  it('desaturates with a saturation below 1', () => {
    const m = matrixColorCorrect2([1, 0, 1], [1, 1, 1]);
    // Every output channel of a grey matrix reads the same luminance, row-vector convention transposed
    const out = [0, 1, 2].map((c) => 1 * m[c * 4] + 0 * m[c * 4 + 1] + 0 * m[c * 4 + 2]);
    expect(out[0]).toBeCloseTo(out[1], 5);
    expect(out[1]).toBeCloseTo(out[2], 5);
  });
});
