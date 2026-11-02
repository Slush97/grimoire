// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/Decay.cs.
//
// This file is the reference pattern for porting a function class:
//   1. Header naming the C# file it was ported from (VRF is MIT; see THIRD_PARTY_NOTICES.md).
//   2. One class per C# class, extending the kind base from ../functions, with VRF's member names
//      camelCased and its statements in the same order.
//   3. Read every authored field in the constructor through the parser with the C# default.
//   4. Override the field masks (storedFields, writtenFields, ...) exactly as the C# does: they decide
//      which attributes the system stores.
//   5. Round single-precision arithmetic with f32 where the C# computes in float.
//   6. Register the class in ../registry.ts.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { ParticleFunctionOperator } from '../functions';
import { f32 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';

/**
 * C_OP_Decay ("Lifespan Decay"): kills a particle once its age reaches its lifetime. With
 * m_bRopeDecay a particle only dies together with the two particles after it.
 */
export class Decay extends ParticleFunctionOperator {
  private readonly ropeDecay: boolean;
  private readonly forcePreserveParticleOrder: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.ropeDecay = parse.boolean('m_bRopeDecay', false);
    this.forcePreserveParticleOrder = parse.boolean('m_bForcePreserveParticleOrder', false);
  }

  get isOrderImportant(): boolean {
    return this.forcePreserveParticleOrder;
  }

  operate(particles: ParticleCollection): void {
    const current = particles.currentSpan;
    const lifetimes = current.readFloats(ParticleField.LifeDuration);

    if (!this.ropeDecay) {
      const creationTimes = current.readFloats(ParticleField.CreationTime);
      const time = current.time;

      for (let i = 0; i < current.length; i++) {
        const lifetime = lifetimes[i];

        if (lifetime <= 0 || lifetime <= f32(time - creationTimes[i])) {
          particles.kill(i);
        }
      }

      return;
    }

    const ages = current.readAges();
    const last = current.length - 1;

    for (let i = 0; i <= last; i++) {
      const next = Math.min(i + 1, last);
      const afterNext = Math.min(i + 2, last);

      if (ages[i] > lifetimes[i] && ages[next] > lifetimes[next] && ages[afterNext] > lifetimes[afterNext]) {
        particles.kill(i);
      }
    }
  }
}
