// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/LineOfSightTrace.cs.

import type { ParticleCollision } from '../collision';
import { Vector3, f32, safeNormalize } from '../numerics';

export function scaleDistance(collision: ParticleCollision, start: Vector3, end: Vector3, distance: number, maxTraceLength: number, scale: number): number {
  const traceEnd = maxTraceLength !== -1 && distance > maxTraceLength ? start.add(safeNormalize(end).scale(maxTraceLength)) : end;
  const { fraction } = collision.traceRay(start, traceEnd);
  return fraction !== 1 ? f32(distance * f32(fraction * scale)) : distance;
}
