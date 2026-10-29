// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/RangeSampler.cs.

import { getSubCollection } from '../kv';
import { Vector3, lerpVV, radicalInverse } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

/**
 * Picks a point in a min/max vector range for a particle, configured by m_randomnessParameters: an
 * ordinary draw from the shared table, or with m_bDistributeEvenly a stratified low-discrepancy
 * sequence keyed to the particle's spawn ordinal that takes nothing from the table.
 */
export class RangeSampler {
  private readonly distributeEvenly: boolean;
  private readonly seed: number;

  private constructor(distributeEvenly: boolean, seed: number) {
    this.distributeEvenly = distributeEvenly;
    this.seed = seed;
  }

  static parse(parse: ParticleDefinitionParser): RangeSampler {
    const block = getSubCollection(parse.data, 'm_randomnessParameters');

    if (block === null) {
      return new RangeSampler(false, 0);
    }

    const parameters = parse.nested(block);
    return new RangeSampler(parameters.boolean('m_bDistributeEvenly'), parameters.int32('m_nSeed', -1));
  }

  /** Interpolates per component between `min` and `max` for the particle at collection index `index`. */
  nextVectorBetween(index: number, state: ParticleSystemState, min: Vector3, max: Vector3): Vector3 {
    if (!this.distributeEvenly) {
      return state.random.nextBetweenPerComponentSeededTwice(min, max);
    }

    const start = this.seed < 0 ? (this.seed + state.random.seed) | 0 : this.seed;
    const sample = (start + state.spawnIndex(index)) & 0x7fffffff;

    const fractions = new Vector3(radicalInverse(sample, 2), radicalInverse(sample, 3), radicalInverse(sample, 5));

    return lerpVV(min, max, fractions);
  }
}
