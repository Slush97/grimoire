// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/StopAfterDuration.cs.

import { ParticleFunctionPreEmissionOperator } from '../functions';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';

export class StopAfterDuration extends ParticleFunctionPreEmissionOperator {
  private readonly duration: NumberProvider;
  private readonly destroy: boolean;
  private readonly playEndCap: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.duration = parse.numberProvider('m_flDuration', new LiteralNumberProvider(1));
    this.destroy = parse.boolean('m_bDestroyImmediately', false);
    this.playEndCap = parse.boolean('m_bPlayEndCap', true);
  }

  operate(state: ParticleSystemState): void {
    if (state.emissionStopped) {
      return;
    }
    if (state.age > this.duration.nextNumber(state)) {
      state.data?.stopEmission(this.destroy, this.playEndCap);
    }
  }
}
