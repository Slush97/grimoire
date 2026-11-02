// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/AlphaDecay.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { ParticleFunctionOperator } from '../functions';
import { f32 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import { FLOAT_EPSILON } from '../utils/particleMath';

/** C_OP_AlphaDecay: kills a particle once its alpha times its alternate alpha falls to or below a minimum. */
export class AlphaDecay extends ParticleFunctionOperator {
  private readonly minAlpha: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.minAlpha = Math.max(0, parse.float('m_flMinAlpha', 0));
  }

  operate(particles: ParticleCollection): void {
    const threshold = f32(this.minAlpha + FLOAT_EPSILON);

    const current = particles.currentSpan;
    const alphas = current.readFloats(ParticleField.Alpha);
    const alternates = current.readFloats(ParticleField.AlphaAlternate);

    for (let i = 0; i < current.length; i++) {
      if (f32(alphas[i] * alternates[i]) <= threshold) {
        particles.kill(i);
      }
    }
  }
}
