import type { MapParticle } from '../../mapParticles';
import { Vector3, roundHalfEven } from '../numerics';
import type { ParticleSystemSimulation } from '../simulation';
import { stringToken } from '../utils/stringToken';

/** Authored world-space targets override editor preview defaults, including CP0. */
export function placeMapParticle(simulation: ParticleSystemSimulation, entity: MapParticle): void {
  const place = (index: number, matrix: number[]) => {
    const point = simulation.getControlPoint(index);
    point.position = new Vector3(matrix[12], matrix[13], matrix[14]);
    const axis = (offset: number) => {
      const vector = new Vector3(matrix[offset], matrix[offset + 1], matrix[offset + 2]);
      return vector.div(vector.length() || 1);
    };
    point.setOrientation(axis(0), axis(4), axis(8));
  };
  place(0, entity.matrix);
  for (const point of entity.controlPoints) place(point.index, point.matrix);
  for (const point of entity.values) simulation.getControlPoint(point.index).position = new Vector3(...point.value);
  const position = simulation.mainControlPoint.position;
  simulation.seedRandom((stringToken(simulation.name) ^ Math.imul(roundHalfEven(position.x), 73856093)
    ^ Math.imul(roundHalfEven(position.y), 19349663) ^ Math.imul(roundHalfEven(position.z), 83492791)) | 0);
}
