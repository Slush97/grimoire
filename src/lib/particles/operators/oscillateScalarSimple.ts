// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/OscillateScalar.cs
// (OscillateScalarSimple).

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { clampColumn, fieldMask, isScalarField, setFloatRange } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32 } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { sinPi } from '../utils/particleMath';

export class OscillateScalarSimple extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly rate: number;
  private readonly frequency: number;
  private readonly oscillationMultiplier: number;
  private readonly oscillationOffset: number;
  private readonly clamp: [number, number];

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nField', ParticleField.Alpha);
    this.rate = parse.float('m_Rate', 0);
    this.frequency = parse.float('m_Frequency', 1);
    this.oscillationMultiplier = parse.float('m_flOscMult', 2);
    this.oscillationOffset = parse.float('m_flOscAdd', 0.5);
    this.clamp = setFloatRange(this.outputField);
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    // The frequency scales the whole phase, offset included, and the phase runs off the system clock,
    // so every particle takes the same delta
    const delta = sinPi(f32(this.frequency * f32(f32(this.oscillationMultiplier * state.age) + this.oscillationOffset)));
    const value = f32(delta * f32(this.rate * f32(strength * frameTime)));
    if (!isScalarField(this.outputField)) {
      return;
    }
    const values = particles.currentSpan.floats(this.outputField);
    for (let i = 0; i < values.length; i++) values[i] += value;
    clampColumn(values, this.clamp[0], this.clamp[1]);
  }
}
