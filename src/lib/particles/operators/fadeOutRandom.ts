// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/FadeOutRandom.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, saturate } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { FLOAT_EPSILON, normalizedAge } from '../utils/particleMath';
import { smoothstep } from '../numerics';
import { powQuarterSteps } from '../utils/particleMath';

export class FadeOutRandom extends ParticleFunctionOperator {
  private readonly fadeTimeMin: number;
  private readonly fadeTimeMax: number;
  private readonly randomExponent: number;
  private readonly proportional: boolean;
  private readonly easeInAndOut: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.fadeTimeMin = parse.float('m_flFadeOutTimeMin', 0.25);
    this.fadeTimeMax = parse.float('m_flFadeOutTimeMax', 0.25);
    this.randomExponent = parse.float('m_flFadeOutTimeExp', 1);
    this.proportional = parse.boolean('m_bProportional', true);
    if (this.fadeTimeMin !== this.fadeTimeMax && this.fadeTimeMin === 0) {
      this.fadeTimeMin = FLOAT_EPSILON;
      this.fadeTimeMax = FLOAT_EPSILON;
    }
    this.easeInAndOut = parse.boolean('m_bEaseInAndOut', true);
    parse.addInitialRead(ParticleField.Alpha);
  }

  get storedFields(): bigint { return fieldMask(ParticleField.Alpha); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const current = particles.currentSpan;
    const ages = current.readAges();
    const fadeTimes = new Float32Array(current.length);
    if (this.fadeTimeMin === this.fadeTimeMax) {
      fadeTimes.fill(this.fadeTimeMin);
    }
    else {
      const ids = current.readIntegers(ParticleField.ParticleId);
      for (let i = 0; i < fadeTimes.length; i++) {
        const draw = powQuarterSteps(state.random.forParticle(ids[i]), this.randomExponent);
        fadeTimes[i] = f32(f32(draw * f32(this.fadeTimeMax - this.fadeTimeMin)) + this.fadeTimeMin);
      }
    }
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const alphas = current.floats(ParticleField.Alpha);
    const initial = particles.initialSpan.readFloats(ParticleField.Alpha);
    for (let i = 0; i < alphas.length; i++) {
      const left = this.proportional ? f32(1 - normalizedAge(ages[i], lifetimes[i])) : f32(lifetimes[i] - ages[i]);
      if (!(left < fadeTimes[i])) {
        continue;
      }
      const elapsed = saturate(f32(1 - f32(left / fadeTimes[i])));
      if (!this.easeInAndOut) {
        alphas[i] = f32(f32(1 - elapsed) * initial[i]);
        continue;
      }
      const eased = smoothstep(0, 1, elapsed);
      alphas[i] = Math.max(0, f32(f32(1 - eased) * initial[i]));
    }
  }
}
