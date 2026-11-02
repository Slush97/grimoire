// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/RandomYawFlip.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { PI, f32 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';

/** C_INIT_RandomYawFlip: flips the yaw by half a turn at random, folded into one half turn first. */
export class RandomYawFlip extends ParticleFunctionInitializer {
  private readonly percent: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.percent = parse.float('m_flPercent', 0.5);
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.Yaw);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const yaws = run.floats(ParticleField.Yaw);

    for (let i = 0; i < yaws.length; i++) {
      if (state.random.next() < this.percent) {
        yaws[i] = f32(f32(yaws[i] % PI) + PI);
      }
    }
  }
}
