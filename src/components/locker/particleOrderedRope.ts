import { ageCurveValue, paramScalar, type FxDescriptor } from './fxDescriptor';

type Vec3 = [number, number, number];
export function ropePositionSource(snapshotCount: number, orderedCount: number) {
  return orderedCount > 1 ? 'ordered' : snapshotCount > 1 ? 'snapshot' : null;
}
const vector = (v: unknown, fallback: Vec3): Vec3 => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite) ? v.slice(0, 3) as Vec3 : fallback;
const scalarAt = (v: unknown, index: number, fallback: number) => {
  const p = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  return p.pf === 'PF_TYPE_PARTICLE_NUMBER_NORMALIZED'
    ? ageCurveValue({ ...p, pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED' }, index, fallback) : paramScalar(v, fallback);
};

/** Ordered, even RingWave initialization in source coordinates. Shared with
 * rope rendering; it does not substitute a torus or an attachment guess. */
export function orderedRopePoints(system: FxDescriptor) {
  const ring = system.initializers.find(n => n.class === 'C_INIT_RingWave');
  const burst = system.emitters.find(n => n.class === 'C_OP_InstantaneousEmitter');
  if (!ring || ring.params.m_bEvenDistribution !== true || !burst || paramScalar(ring.params.m_nControlPointNumber, 0) !== 0) return null;
  const count = Math.floor(Math.min(128, paramScalar(system.maxParticles, 64), paramScalar(burst.params.m_nParticlesToEmit, 0)));
  if (count < 2) return null;
  const perOrbit = Math.max(1, paramScalar(ring.params.m_flParticlesPerOrbit, count));
  const ringRadius = Math.max(0, Math.min(4096, paramScalar(ring.params.m_flInitialRadius, 0)));
  const roll = paramScalar(ring.params.m_flRoll, 0)*Math.PI/180;
  const points = Array.from({ length: count }, (_, i) => {
    const index = i/(count-1), angle = roll+i*2*Math.PI/perOrbit;
    let position: Vec3 = [Math.cos(angle)*ringRadius, Math.sin(angle)*ringRadius, 0];
    let radius = paramScalar(system.constantRadius, 1), alpha = 1;
    for (const node of system.initializers.slice(0, 32)) {
      const p = node.params;
      if (node.class === 'C_INIT_PositionWarpScalar' && paramScalar(p.m_nControlPointNumber, 0) === 0) {
        const lo = vector(p.m_vecWarpMin, [1, 1, 1]), hi = vector(p.m_vecWarpMax, [1, 1, 1]);
        const value = scalarAt(p.m_InputValue, index, 0);
        position = position.map((v, axis) => v*(lo[axis]+(hi[axis]-lo[axis])*value)) as Vec3;
      }
      if (node.class === 'C_INIT_PositionOffset' && p.m_bProportional !== true) {
        const lo = vector(p.m_OffsetMin, [0, 0, 0]), hi = vector(p.m_OffsetMax, lo);
        position = position.map((v, axis) => v+(lo[axis]+hi[axis])/2) as Vec3;
      }
      if (node.class === 'C_INIT_InitFloat') {
        const field = paramScalar(p.m_nOutputField, 3), value = scalarAt(p.m_InputValue, index, field === 7 ? 1 : radius);
        const scaled = p.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE';
        if (field === 3) radius = scaled ? radius*value : value;
        if (field === 7) alpha = scaled ? alpha*value : value;
      }
    }
    return { position, radius: Math.max(0, Math.min(128, radius)), alpha: Math.max(0, Math.min(1, alpha)), scalarUv: i };
  });
  const orbit = system.operators.find(n => n.class === 'C_OP_MovementRotateParticleAroundAxis');
  return { points, orbitRate: paramScalar(orbit?.params.m_flRotRate, 0)*Math.PI/180,
    start: Math.max(0, paramScalar(burst.params.m_flStartTime, 0)) };
}
