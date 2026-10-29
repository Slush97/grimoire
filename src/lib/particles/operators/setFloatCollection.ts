// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetFloatCollection.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { fieldMask, isScalarField, applySetMethod, setFloatRange } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, clamp, saturate, lerp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';

export class SetFloatCollection extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly value: NumberProvider;
  private readonly setMethod: number;
  private readonly lerp: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nOutputField', ParticleField.Radius);
    this.value = parse.numberProvider('m_InputValue', new LiteralNumberProvider(0));
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.lerp = parse.numberProvider('m_Lerp', new LiteralNumberProvider(1));
    ParticleFunctionOperator.addInitialReadOf(parse, this.setMethod, this.outputField);
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  restart(state: ParticleSystemState): void { this.value.nextNumber(state); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const input = f32(this.value.nextNumber(state) * strength);
    const blend = saturate(f32(this.lerp.nextNumber(state) * strength));
    const [min, max] = setFloatRange(this.outputField);
    if (!isScalarField(this.outputField)) {
      return;
    }
    const output = particles.currentSpan.floats(this.outputField);
    if (this.setMethod === ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE) {
      const replacements = new Float32Array(4);
      for (let lane = 0; lane < Math.min(4, output.length); lane++) {
        replacements[lane] = clamp(lerp(output[lane], input, blend), min, max);
      }
      for (let i = 0; i < output.length; i++) {
        output[i] = replacements[i & 3];
      }
      return;
    }
    const initial = particles.initialSpan.readFloats(this.outputField);
    for (let i = 0; i < output.length; i++) {
      const current = output[i];
      if (this.setMethod === ParticleSetMethod.PARTICLE_SET_RAMP_CURRENT_VALUE) {
        output[i] = clamp(f32(current + f32(f32(blend * frameTime) * input)), min, max);
        continue;
      }
      const target = applySetMethod(input, initial[i], current, frameTime, this.setMethod);
      output[i] = clamp(lerp(current, target, blend), min, max);
    }
  }
}
