import { describe, expect, it } from 'vitest';
import { ageCurveValue, allSpriteLayers, paramRange, spriteParamsFor, type FxDescriptor } from './fxDescriptor';
const descriptor = (): FxDescriptor => ({
  name: 'sprite', maxParticles: 64, constantRadius: 15, constantColor: [255, 0, 0],
  controlPoints: [{ cp: 2, attachment: 'ability_cast', attachType: 'PATTACH_POINT_FOLLOW', entity: 'self' }],
  emitters: [{ class: 'C_OP_ContinuousEmitter', params: { m_flEmitRate: 2, m_bForceEmitOnFirstUpdate: true } }],
  initializers: [
    { class: 'C_INIT_InitFloat', params: { m_nOutputField: 1, m_InputValue: { pf: 'PF_TYPE_RANDOM_UNIFORM', min: 2, max: 3 } } },
    { class: 'C_INIT_InitFloat', params: { m_InputValue: { min: 4, max: 6 } } },
    { class: 'C_INIT_InitFloat', params: { m_nOutputField: 5, m_InputValue: { min: 20, max: 40 } } },
    { class: 'C_INIT_CreateWithinSphereTransform', params: { m_TransformInput: { m_nControlPoint: 2 } } },
    { class: 'C_INIT_RandomColor', params: { m_ColorMin: [219, 131, 223], m_ColorMax: [193, 75, 207] } },
  ],
  operators: [{ class: 'C_OP_SpinUpdate', params: {} }, { class: 'C_OP_PositionLock', params: {} }],
  renderers: [{ class: 'C_OP_RenderSprites', params: {}, mode: 'sprite', blendMode: 'PARTICLE_OUTPUT_BLEND_MODE_ADD',
    textures: ['materials/particle/noise.vtex', 'materials/particle/ring.vtex'] }], children: [],
});
describe('authored sprite attributes', () => {
  it('uses lifetime field 1, default radius field 0, and authored rate rather than filling the budget', () => {
    const p = spriteParamsFor(descriptor())!;
    expect(p.lifetime).toEqual([2, 3]); expect(p.radius).toEqual([4, 6]); expect(p.emitRate).toBe(2);
    expect(p.emitFirst).toBe(true); expect(p.spawnRadius).toBe(0); expect(p.attachment).toBe('ability_cast');
    expect(p.texture).toBe('materials/particle/ring.vtex'); expect(p.follow).toBe(true);
    expect(p.spin[0]).toBeCloseTo(Math.PI/9); expect(p.spin[1]).toBeCloseTo(2*Math.PI/9);
    expect(p.colorMin[0]).toBeGreaterThan(p.colorMax[0]); expect(p.colorMin[2]).toBeGreaterThan(p.colorMin[1]);
  });
  it('does not invent emission or outward drift for missing operators', () => {
    const d = descriptor(); d.emitters = []; d.operators = []; d.initializers = [];
    const p = spriteParamsFor(d)!;
    expect(p.emitRate).toBe(0); expect(p.gravity).toEqual([0, 0, 0]); expect(p.radius).toEqual([15, 15]);
  });
  it('interpolates normalized-age curves and holds their endpoint rather than forcing a sine fade', () => {
    const curve = { pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED', curve: { m_spline: [
      { x: 0, y: 0.8, m_flSlopeOutgoing: 0 }, { x: 0.5, y: 1.2, m_flSlopeIncoming: 0 },
    ] } };
    expect(ageCurveValue(curve, 0.25)).toBeCloseTo(1);
    expect(ageCurveValue(curve, 0.9)).toBe(1.2);
    expect(ageCurveValue({ pf: 'PF_TYPE_RANDOM_UNIFORM' }, 0.5)).toBe(1);
  });
  it('bounds graphs globally and rejects non-finite parameters', () => {
    const d = descriptor(); d.maxParticles = 256; d.children = Array.from({ length: 16 }, () => ({ ...descriptor(), maxParticles: 256 }));
    expect(allSpriteLayers(d).reduce((sum, layer) => sum + layer.maxParticles, 0)).toBe(512);
    expect(paramRange(NaN, [1, 2])).toEqual([1, 2]); expect(paramRange({ min: 3, max: 2 }, [0, 0])).toEqual([2, 3]);
  });
});
