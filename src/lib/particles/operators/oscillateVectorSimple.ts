// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/OscillateVector.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField, isNormalizedField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32, minV, maxV } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { sinPi } from '../utils/particleMath';

export class OscillateVectorSimple extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly rate: Vector3;
  private readonly frequency: Vector3;
  private readonly oscillationMultiplier: number;
  private readonly oscillationOffset: number;
  private readonly offset: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nField', ParticleField.Position);
    this.rate = parse.vector3('m_Rate', Vector3.zero);
    this.frequency = parse.vector3('m_Frequency', Vector3.one);
    this.oscillationMultiplier = parse.float('m_flOscMult', 2);
    this.oscillationOffset = parse.float('m_flOscAdd', 0.5);
    this.offset = parse.boolean('m_bOffset', false);
  }

  get storedFields(): bigint { return fieldMask(this.outputField) | (this.offset ? fieldMask(ParticleField.PositionPrevious) : 0n); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const phase = f32(f32(this.oscillationMultiplier * state.age) + this.oscillationOffset);
    const step = f32(strength * frameTime);
    const delta = new Vector3(sinPi(f32(this.frequency.x * phase)), sinPi(f32(this.frequency.y * phase)), sinPi(f32(this.frequency.z * phase)));
    const value = this.rate.scale(step).mul(delta);
    if (!isVectorField(this.outputField)) {
      return;
    }
    const current = particles.currentSpan;
    const values = current.vectors(this.outputField);
    const previous = this.offset && this.outputField === ParticleField.Position ? current.vectors(ParticleField.PositionPrevious) : null;
    for (let i = 0; i < current.length; i++) {
      const oscillated = readVector(values, i).add(value);
      writeVector(values, i, isNormalizedField(this.outputField) ? minV(maxV(oscillated, Vector3.zero), Vector3.one) : oscillated);
      if (previous !== null) {
        writeVector(previous, i, readVector(previous, i).add(value));
      }
    }
  }
}
