// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/RemapSpeed.cs.

import { readVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { isAlphaField, fieldMask, isScalarField, applySetMethod } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { saturate, f32, lerp } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { clampedFraction } from '../utils/particleMath';

export class RemapSpeed extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly ignoreDelta: boolean;
  private readonly inputMin: number;
  private readonly inputMax: number;
  private readonly outputMin: number;
  private readonly outputMax: number;
  private readonly setMethod: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.ignoreDelta = parse.boolean('m_bIgnoreDelta', false);
    this.inputMin = Math.max(f32(0.001), parse.float('m_flInputMin', 0.001));
    this.inputMax = Math.max(f32(0.001), parse.float('m_flInputMax', 1));
    this.outputMin = parse.float('m_flOutputMin', 0);
    this.outputMax = parse.float('m_flOutputMax', 1);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    if (isAlphaField(this.outputField)) {
      this.outputMin = saturate(this.outputMin);
      this.outputMax = saturate(this.outputMax);
    }
    ParticleFunctionOperator.addInitialReadOf(parse, this.setMethod, this.outputField);
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const divisor = this.ignoreDelta ? 1 : frameTime;
    if (!isScalarField(this.outputField)) {
      return;
    }
    const current = particles.currentSpan;
    const positions = current.readVectors(ParticleField.Position);
    const previous = current.readVectors(ParticleField.PositionPrevious);
    const output = current.floats(this.outputField);
    const initial = particles.initialSpan.readFloats(this.outputField);
    for (let i = 0; i < output.length; i++) {
      const speed = f32(readVector(positions, i).sub(readVector(previous, i)).length() / divisor);
      const fraction = clampedFraction(speed, this.inputMin, this.inputMax);
      let value = lerp(this.outputMin, this.outputMax, fraction);
      value = applySetMethod(value, initial[i], output[i], state.currentStep, this.setMethod);
      output[i] = lerp(output[i], value, strength);
    }
  }
}
