// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/InitFloat.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { applySetMethod, fieldMask, isAngleField, isIntegerField, isScalarField, isVectorField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { degreesToRadians, lerp, roundHalfEven, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';

/** C_INIT_InitFloat: sets a scalar attribute to a value provided by a float input. */
export class InitFloat extends ParticleFunctionInitializer {
  private readonly outputField: number;
  private readonly inputValue: NumberProvider;
  private readonly inputStrength: NumberProvider;
  private readonly setMethod: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nOutputField', ParticleField.Radius);
    this.inputValue = parse.numberProvider('m_InputValue', new LiteralNumberProvider(0));
    this.inputStrength = parse.numberProvider('m_InputStrength', new LiteralNumberProvider(1));
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
  }

  get writtenFields(): bigint {
    return fieldMask(this.outputField);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, state, false);
  }

  protected initializeBlocks(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, state, true);
  }

  private initializeRun(run: ParticleSpan, state: ParticleSystemState, blockRun: boolean): void {
    const values = this.inputValue.fillNew(run, state);
    const strengths = this.inputStrength.fillNew(run, state);

    if (isVectorField(this.outputField)) {
      this.initializeVectorX(run, values, strengths, state);
      return;
    }

    if (!isScalarField(this.outputField)) {
      return;
    }

    // Angles are authored in degrees and stored in radians; the scaling set methods take a unitless multiplier
    const convertAngle =
      isAngleField(this.outputField) &&
      this.setMethod !== ParticleSetMethod.PARTICLE_SET_SCALE_INITIAL_VALUE &&
      this.setMethod !== ParticleSetMethod.PARTICLE_SET_SCALE_CURRENT_VALUE;

    const outputs = run.floats(this.outputField);
    const integers = isIntegerField(this.outputField) ? run.integers(this.outputField) : null;

    for (let i = 0; i < outputs.length; i++) {
      const value = convertAngle ? degreesToRadians(values[i]) : values[i];
      // An integer attribute's current value is its bits read as a float, as the C# reads it
      const current = outputs[i];
      const target = applySetMethod(value, current, current, state.currentStep, this.setMethod);

      // The strength blends the attribute toward what the set method produced; at zero it keeps its value
      const result = lerp(current, target, strengths[i]);

      if (integers === null) {
        outputs[i] = result;
      } else {
        // The block run rounds an integer to the nearest, where the particles before and after it truncate
        integers[i] = blockRun ? toInt(roundHalfEven(result)) : toInt(result);
      }
    }
  }

  /** A vector output field takes the value in its X component alone. */
  private initializeVectorX(run: ParticleSpan, values: Float32Array, strengths: Float32Array, state: ParticleSystemState): void {
    const outputs = run.vectors(this.outputField);

    for (let i = 0; i < run.length; i++) {
      const current = outputs[i * 3];
      const target = applySetMethod(values[i], current, current, state.currentStep, this.setMethod);

      outputs[i * 3] = lerp(current, target, strengths[i]);
    }
  }
}
