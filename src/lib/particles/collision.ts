// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/IParticleCollision.cs.

import { Vector3 } from './numerics';

export interface ParticleCollision {
  readonly hasGeometry: boolean;
  traceRay(rayStart: Vector3, rayEnd: Vector3): {
    hit: boolean;
    position: Vector3;
    normal: Vector3;
    fraction: number;
  };
  findRayTraceEnvironment(name: string): number;
  traceEnvironment(environment: number, rayStart: Vector3, direction: Vector3, maxDistance: number): {
    hit: boolean;
    distance: number;
    normal: Vector3;
  };
}
export const NO_COLLISION: ParticleCollision = {
  hasGeometry: false,
  traceRay: (_start, end) => ({ hit: false, position: end, normal: Vector3.zero, fraction: 1 }),
  findRayTraceEnvironment: () => -1,
  traceEnvironment: (_environment, _start, _direction, maxDistance) => ({ hit: false, distance: maxDistance, normal: Vector3.zero }),
};
