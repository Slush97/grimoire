import { paramRange, paramScalar, type FxDescriptor } from './fxDescriptor';

type Vec3 = [number, number, number];
/** Literal velocity initializers in a world-origin or default model-origin CP frame.
 * Attached/dynamic frames and vector providers require their own evaluation. */
export function particleWorldVelocity(system: FxDescriptor, random = Math.random): Vec3 {
  const result: Vec3 = [0, 0, 0];
  const vector = (v: unknown): Vec3 | null => v === undefined ? [0, 0, 0]
    : Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))
      ? v.map(n => Math.max(-4096, Math.min(4096, n))) as Vec3 : null;
  for (const node of system.initializers.slice(0, 32)) {
    if (node.class !== 'C_INIT_VelocityRandom' || node.params.m_bIgnoreDT === true) continue;
    const cp = paramScalar(node.params.m_nControlPointNumber, 0);
    if (!system.controlPoints.some(p => p.cp === cp && !p.attachment && (p.attachType === 'PATTACH_WORLDORIGIN' || (cp === 0 && p.attachType === null && p.entity === 'self')))) continue;
    const min = vector(node.params.m_LocalCoordinateSystemSpeedMin), max = vector(node.params.m_LocalCoordinateSystemSpeedMax);
    if (!min || !max) continue;
    const [speedMin] = paramRange(node.params.m_fSpeedMin, [0, 0]);
    const [, speedMax] = paramRange(node.params.m_fSpeedMax, [0, 0]);
    for (let axis = 0; axis < 3; axis++) {
      result[axis] += min[axis]+(max[axis]-min[axis])*random();
      result[axis] += speedMin+(speedMax-speedMin)*random();
    }
  }
  return result;
}
