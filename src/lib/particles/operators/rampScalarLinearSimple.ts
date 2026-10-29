// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/RampScalarLinearSimple.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField, setFloatRange } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { clamp, f32 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

/** C_OP_RampScalarLinearSimple: ramps a scalar attribute at a constant rate within a normalized-age window. */
export class RampScalarLinearSimple extends ParticleFunctionOperator {
  private readonly rate: number;
  private readonly startTime: number;
  private readonly endTime: number;
  private readonly outputField: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.rate = parse.float('m_Rate', 0);
    this.startTime = parse.float('m_flStartTime', 0);
    this.endTime = parse.float('m_flEndTime', 1);
    this.outputField = parse.particleField('m_nField', ParticleField.Radius);
  }

  get storedFields(): bigint {
    return fieldMask(this.outputField);
  }

  operate(particles: ParticleCollection, frameTime: number, _state: ParticleSystemState, strength: number): void {
    const step = f32(this.rate * f32(strength * frameTime));
    const [min, max] = setFloatRange(this.outputField);

    if (!isScalarField(this.outputField)) {
      return;
    }

    const current = particles.currentSpan;
    const ages = current.readAges();
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const output = current.floats(this.outputField);

    for (let i = 0; i < output.length; i++) {
      const lifetime = lifetimes[i];

      // The start/end window is in normalized age, like FadeInSimple
      const normalizedAge = f32(ages[i] / lifetime);
      const ramping = lifetime > 0 && this.startTime <= normalizedAge && normalizedAge < this.endTime;

      if (ramping) {
        output[i] = clamp(f32(output[i] + step), min, max);
      }
    }
  }
}
