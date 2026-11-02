// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/LerpEndCapScalar.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, lerp, saturate } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { FLOAT_EPSILON } from '../utils/particleMath';

export class LerpEndCapScalar extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly output: number;
  private readonly lerpTime: number;
  private startAge = -1;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.output = parse.float('m_flOutput', 1);
    this.lerpTime = parse.float('m_flLerpTime', 1);
    parse.addInitialRead(this.outputField);
  }

  reset(): void {
    this.startAge = -1;
  }

  get storedFields(): bigint {
    return fieldMask(this.outputField);
  }

  get initialWrittenFields(): bigint {
    return fieldMask(this.outputField);
  }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState, strength: number): void {
    if (!state.inEndCap) {
      return;
    }
    if (!isScalarField(this.outputField)) {
      return;
    }
    const values = particles.currentSpan.floats(this.outputField);
    const initialValues = particles.initialSpan.floats(this.outputField);
    if (this.startAge < 0) {
      this.startAge = state.age;
      initialValues.set(values);
    }
    const t = saturate(f32(f32(state.age - this.startAge) / f32(this.lerpTime + FLOAT_EPSILON)));
    for (let i = 0; i < values.length; i++) {
      const target = lerp(initialValues[i], this.output, t);
      values[i] = lerp(values[i], target, strength);
    }
  }
}
