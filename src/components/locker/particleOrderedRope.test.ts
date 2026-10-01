import { describe, expect, it } from 'vitest';
import { orderedRopePoints, ropePositionSource } from './particleOrderedRope';
import type { FxDescriptor } from './fxDescriptor';
const system = (): FxDescriptor => ({ name: 'ordered', controlPoints: [], constantRadius: 2, maxParticles: 50,
  emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 20 } }],
  initializers: [{ class: 'C_INIT_RingWave', params: { m_bEvenDistribution: true, m_flInitialRadius: 25, m_flParticlesPerOrbit: 12 } },
    { class: 'C_INIT_PositionOffset', params: { m_OffsetMin: [0, 0, 20], m_OffsetMax: [0, 0, 20] } }],
  operators: [{ class: 'C_OP_MovementRotateParticleAroundAxis', params: { m_flRotRate: 30 } }], renderers: [], children: [] });
describe('ordered authored rope initialization', () => {
  it('selects one position source consistently when a short snapshot coexists with an ordered ring', () => {
    const s = system();
    s.snapshot = {points:Array.from({length:2},()=>({position:[0,0,0],joints:[],weights:[]}))};
    const ordered = orderedRopePoints(s)!;
    expect(ordered.points).toHaveLength(20);
    expect(ropePositionSource(s.snapshot.points.length,ordered.points.length)).toBe('ordered');
    expect(ropePositionSource(s.snapshot.points.length,0)).toBe('snapshot');
    expect(ropePositionSource(0,0)).toBeNull();
  });
  it('preserves emitter count, particle order, authored source plane and world offset', () => {
    const r = orderedRopePoints(system())!;
    expect(r.points).toHaveLength(20);
    expect(r.points[0].position).toEqual([25, 0, 20]);
    expect(r.points[3].position[0]).toBeCloseTo(0);
    expect(r.points[3].position[1]).toBeCloseTo(25);
    expect(r.points[12].position[0]).toBeCloseTo(25);
    expect(r.orbitRate).toBeCloseTo(Math.PI/6);
  });
  it('applies index curves in authored initializer order and bounds oversized pools', () => {
    const s = system(); s.initializers.push({ class: 'C_INIT_PositionWarpScalar', params: { m_vecWarpMax: [2, 2, 2], m_InputValue: {
      pf: 'PF_TYPE_PARTICLE_NUMBER_NORMALIZED', curve: { m_spline: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } } } });
    expect(orderedRopePoints(s)!.points[0].position[2]).toBe(20);
    expect(orderedRopePoints(s)!.points[19].position[2]).toBe(40);
    s.maxParticles = 4096; s.emitters[0].params.m_nParticlesToEmit = 4096;
    expect(orderedRopePoints(s)!.points).toHaveLength(128);
    s.initializers[0].params.m_bEvenDistribution = false;
    expect(orderedRopePoints(s)).toBeNull();
  });
});
