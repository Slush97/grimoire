// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetVec.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { applySetMethodV, fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32, maxV, minV, safeNormalize, saturate } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { vectorLerp } from '../utils/vectorMath';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class SetVec extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly value: VectorProvider;
  private readonly setMethod: number;
  private readonly lerp: NumberProvider;
  private readonly normalizedOutput: boolean;
  private readonly clampsToUnit: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nOutputField', ParticleField.Color);
    this.value = parse.vectorProvider('m_InputValue', new LiteralVectorProvider(Vector3.zero));
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.lerp = parse.numberProvider('m_Lerp', new LiteralNumberProvider(1));
    this.normalizedOutput = parse.boolean('m_bNormalizedOutput', false);
    this.clampsToUnit = this.outputField === ParticleField.Color || this.outputField === ParticleField.GlowRgb;
    ParticleFunctionOperator.addInitialReadOf(parse, this.setMethod, this.outputField);
  }

  get storedFields(): bigint {
    return fieldMask(this.outputField);
  }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState, strength: number): void {
    const current = particles.currentSpan;
    const values = this.value.prepare(current, state);
    const lerps = this.lerp.fillNew(current, state);
    for (const { offset, block, lane } of current.inputBlocks()) {
      this.value.fillPerBlock(block, lane, state, values.subarray(offset * 3));
    }
    if (!isVectorField(this.outputField)) {
      return;
    }
    const output = current.vectors(this.outputField);
    const initial = particles.initialSpan.readVectors(this.outputField);
    const deltaTime = state.currentStep;
    for (let i = 0; i < current.length; i++) {
      const lerpAmount = saturate(f32(lerps[i] * strength));
      const currentValue = readVector(output, i);
      let target = applySetMethodV(readVector(values, i), readVector(initial, i), currentValue, deltaTime, this.setMethod);
      if (this.clampsToUnit) {
        target = minV(maxV(target, Vector3.zero), Vector3.one);
      }
      let result = vectorLerp(currentValue, target, lerpAmount);
      if (this.normalizedOutput && !result.equals(Vector3.zero)) {
        result = safeNormalize(result);
      }
      writeVector(output, i, result);
    }
  }
}
