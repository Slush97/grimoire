// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetFloat.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { applySetMethodColumn, clampColumn, fieldMask, isAngleField, isScalarField, readsInitialValue, setFloatRange } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { degreesToRadians, f32, floatLerp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

/**
 * C_OP_SetFloat: sets a scalar attribute to a per-particle value, with a lerp factor blending from
 * the current value toward the target each step.
 */
export class SetFloat extends ParticleFunctionOperator {
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

  get storedFields(): bigint {
    return fieldMask(this.outputField);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const [min, max] = setFloatRange(this.outputField);
    const current = particles.currentSpan;

    if (!isScalarField(this.outputField)) {
      return;
    }

    const output = current.floats(this.outputField);
    const initial = particles.initialSpan.readFloats(this.outputField);

    // Angles are authored in degrees and stored in radians; the scaling set methods take a unitless multiplier
    const toRadians =
      isAngleField(this.outputField) &&
      this.setMethod !== ParticleSetMethod.PARTICLE_SET_SCALE_INITIAL_VALUE &&
      this.setMethod !== ParticleSetMethod.PARTICLE_SET_SCALE_CURRENT_VALUE;

    // Each input is evaluated for every particle before the next; the lerp comes first, which decides the order of their draws
    const lerps = this.lerp.fillNew(current, state);
    const values = this.value.fillNew(current, state);

    if (toRadians) {
      for (let i = 0; i < values.length; i++) {
        values[i] = degreesToRadians(values[i]);
      }
    }

    clampColumn(lerps, 0, 1);

    // A ramp takes the strength into its rate instead of blending toward the result
    if (this.setMethod === ParticleSetMethod.PARTICLE_SET_RAMP_CURRENT_VALUE) {
      const rate = f32(strength * frameTime);

      for (let i = 0; i < output.length; i++) {
        lerps[i] = lerps[i] * rate;
        output[i] = f32(lerps[i] * values[i]) + output[i];
      }

      clampColumn(output, min, max);
      return;
    }

    applySetMethodColumn(values, initial, output, state.currentStep, this.setMethod);

    for (let i = 0; i < values.length; i++) {
      values[i] = floatLerp(output[i], values[i], lerps[i]);
    }

    clampColumn(values, min, max);

    if (strength >= 1) {
      output.set(values);
      return;
    }

    // Strength lerps from the spawn initial for the two initial-value set methods
    const strengthBase = readsInitialValue(this.setMethod) ? initial : output;

    for (let i = 0; i < output.length; i++) {
      output[i] = floatLerp(strengthBase[i], values[i], strength);
    }
  }
}
