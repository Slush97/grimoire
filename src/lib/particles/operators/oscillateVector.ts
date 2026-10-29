// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/OscillateVector.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField, isNormalizedField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32, saturate } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { sinPi, normalizedAge } from '../utils/particleMath';

export class OscillateVector extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly rateMin: Vector3;
  private readonly rateMax: Vector3;
  private readonly frequencyMin: Vector3;
  private readonly frequencyMax: Vector3;
  private readonly oscillationMultiplier: NumberProvider;
  private readonly oscillationOffset: NumberProvider;
  private readonly rateScale: NumberProvider;
  private readonly proportional: boolean;
  private readonly proportionalOp: boolean;
  private readonly startTimeMin: number;
  private readonly startTimeMax: number;
  private readonly endTimeMin: number;
  private readonly endTimeMax: number;
  private readonly offset: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nField', ParticleField.Position);
    this.rateMin = parse.vector3('m_RateMin', Vector3.zero);
    this.rateMax = parse.vector3('m_RateMax', Vector3.zero);
    this.frequencyMin = parse.vector3('m_FrequencyMin', Vector3.one);
    this.frequencyMax = parse.vector3('m_FrequencyMax', Vector3.one);
    this.oscillationMultiplier = parse.numberProvider('m_flOscMult', new LiteralNumberProvider(2));
    this.oscillationOffset = parse.numberProvider('m_flOscAdd', new LiteralNumberProvider(0.5));
    this.rateScale = parse.numberProvider('m_flRateScale', new LiteralNumberProvider(1));
    this.proportional = parse.boolean('m_bProportional', true);
    this.proportionalOp = parse.boolean('m_bProportionalOp', true);
    this.startTimeMin = parse.float('m_flStartTime_min', 0);
    this.startTimeMax = parse.float('m_flStartTime_max', 0);
    this.endTimeMin = parse.float('m_flEndTime_min', 1);
    this.endTimeMax = parse.float('m_flEndTime_max', 1);
    this.offset = parse.boolean('m_bOffset', false);
  }

  get storedFields(): bigint { return fieldMask(this.outputField) | fieldMask(ParticleField.PositionPrevious); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const step = f32(strength * frameTime);
    if (!isVectorField(this.outputField)) {
      return;
    }
    const current = particles.currentSpan;
    const values = current.vectors(this.outputField);
    const previous = this.offset && this.outputField === ParticleField.Position ? current.vectors(ParticleField.PositionPrevious) : null;
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const ids = current.readIntegers(ParticleField.ParticleId);
    const ages = current.readAges();
    const multipliers = this.oscillationMultiplier.fillNew(current, state);
    const offsets = this.oscillationOffset.fillNew(current, state);
    const scales = this.rateScale.fillNew(current, state);
    for (let i = 0; i < current.length; i++) {
      if (lifetimes[i] <= 0) {
        continue;
      }
      const id = ids[i];
      const start = state.random.forParticleBetween(id, 11, this.startTimeMin, this.startTimeMax);
      const end = state.random.forParticleBetween(id, 12, this.endTimeMin, this.endTimeMax);
      const age = normalizedAge(ages[i], lifetimes[i]);
      const windowTime = this.proportionalOp ? age : ages[i];
      if (windowTime < start || windowTime >= end) {
        continue;
      }
      const rate = new Vector3(state.random.forParticleBetween(id, 3, this.rateMin.x, this.rateMax.x), state.random.forParticleBetween(id, 7, this.rateMin.y, this.rateMax.y), state.random.forParticleBetween(id, 9, this.rateMin.z, this.rateMax.z));
      const frequency = new Vector3(state.random.forParticleBetween(id, 8, this.frequencyMin.x, this.frequencyMax.x), state.random.forParticleBetween(id, 12, this.frequencyMin.y, this.frequencyMax.y), state.random.forParticleBetween(id, 15, this.frequencyMin.z, this.frequencyMax.z));
      const phase = this.proportional ? frequency.scale(age).scale(multipliers[i]).add(Vector3.splat(offsets[i])) : frequency.scale(f32(f32(multipliers[i] * state.age) + offsets[i]));
      const delta = new Vector3(sinPi(phase.x), sinPi(phase.y), sinPi(phase.z));
      const value = rate.scale(f32(step * scales[i])).mul(delta);
      const oscillated = readVector(values, i).add(value);
      writeVector(values, i, isNormalizedField(this.outputField) ? new Vector3(saturate(oscillated.x), saturate(oscillated.y), saturate(oscillated.z)) : oscillated);
      if (previous !== null) {
        writeVector(previous, i, readVector(previous, i).add(value));
      }
    }
  }
}
