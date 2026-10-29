// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/Spin.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { TAU, f32, degreesToRadians } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';

export abstract class GeneralSpin extends ParticleFunctionOperator {
  private readonly spinRateDegrees: number;
  private readonly spinRateMinDegrees: number;
  private readonly spinRateStopTime: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.spinRateDegrees = parse.int32('m_nSpinRateDegrees', 0);
    this.spinRateMinDegrees = parse.int32('m_nSpinRateMinDegrees', 0);
    this.spinRateStopTime = parse.float('m_fSpinRateStopTime', 0);
  }
  protected abstract get spinField(): number;

  get storedFields(): bigint { return this.spinRateDegrees === 0 ? 0n : fieldMask(this.spinField); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const rate = f32(strength * degreesToRadians(f32(this.spinRateDegrees)));
    if (rate === 0) {
      return;
    }
    const previous = state.data?.particles.previousStepSpan;
    const wrap = state.data === null || state.frozen || previous === null || previous === undefined || previous.isEmpty || !(state.age > state.requestedAge && state.requestedAge >= state.stepStartAge);
    let step = f32(Math.abs(f32(rate * TAU)) * frameTime);
    if (this.spinRateStopTime === 0) {
      step = f32(step % TAU);
    }
    if (rate < 0) {
      step = -step;
    }
    const minimum = f32(f32(degreesToRadians(f32(this.spinRateMinDegrees)) * TAU) * frameTime);
    const current = particles.currentSpan;
    const angles = current.floats(this.spinField);
    if (this.spinRateStopTime === 0) {
      const delta = rate >= 0 ? Math.max(step, minimum) : Math.min(step, minimum);
      for (let i = 0; i < angles.length; i++) {
        angles[i] = f32(angles[i] + delta);
      }
    }
    else {
      const lifetimes = current.readFloats(ParticleField.LifeDuration);
      const ages = current.readAges();
      for (let i = 0; i < angles.length; i++) {
        const stopAge = f32(lifetimes[i] * this.spinRateStopTime);
        let delta = f32(1 - f32(ages[i] / stopAge));
        delta = Number.isNaN(delta) ? 0 : Math.max(delta, 0);
        if (stopAge === 0) {
          delta = 0;
        }
        delta = f32(delta * step);
        delta = rate >= 0 ? Math.max(delta, minimum) : Math.min(delta, minimum);
        angles[i] = f32(angles[i] + delta);
      }
    }
    if (wrap) {
      for (let i = 0; i < angles.length; i++) {
        angles[i] = f32(angles[i] % TAU);
      }
    }
  }
}
