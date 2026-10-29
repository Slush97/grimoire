// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/SequenceLifeTime.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { f32, toInt } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';

export class SequenceLifeTime extends ParticleFunctionInitializer {
  private readonly frameRate: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.frameRate = parse.float('m_flFramerate', 30);
  }

  get writtenFields(): bigint { return fieldMask(ParticleField.LifeDuration); }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const durations = state.sequenceDurations;
    if (this.frameRate === 0 || durations === null) {
      return;
    }
    const sequences = run.readFloats(ParticleField.SequenceNumber);
    const lifetimes = run.floats(ParticleField.LifeDuration);
    for (let i = 0; i < lifetimes.length; i++) {
      const sequence = Number.isNaN(sequences[i]) ? -1 : toInt(sequences[i]);
      const time = sequence >= 0 && sequence < durations.length ? durations[sequence] : 0;
      lifetimes[i] = time !== 0 ? f32(time / this.frameRate) : 1;
    }
  }
}
