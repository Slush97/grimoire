// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/EndCapTimedDecay.cs.

import type { ParticleCollection } from '../collection';
import { ParticleFunctionOperator } from '../functions';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

export class EndCapTimedDecay extends ParticleFunctionOperator {
  private readonly decayTime: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.decayTime = parse.numberProvider('m_flDecayTime', new LiteralNumberProvider(0));
  }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    if (!state.inEndCap) {
      return;
    }
    if (state.endCapAge <= this.decayTime.nextNumber(state)) {
      return;
    }
    const current = particles.currentSpan;
    for (let i = 0; i < current.length; i++) {
      particles.kill(i);
    }
  }
}
