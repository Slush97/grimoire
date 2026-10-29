// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/LerpScalar.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, saturate, lerp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { FLOAT_EPSILON } from '../utils/particleMath';

export class LerpScalar extends ParticleFunctionOperator {
  private readonly fieldOutput: number;
  private readonly output: NumberProvider;
  private readonly startTime: number;
  private readonly endTime: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.output = parse.numberProvider('m_flOutput', new LiteralNumberProvider(1));
    this.startTime = parse.float('m_flStartTime', 0);
    this.endTime = parse.float('m_flEndTime', 1);
    parse.addInitialRead(this.fieldOutput);
  }

  get storedFields(): bigint { return fieldMask(this.fieldOutput); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState, strength: number): void {
    if (!isScalarField(this.fieldOutput)) {
      return;
    }
    const current = particles.currentSpan;
    const values = current.floats(this.fieldOutput);
    const initials = particles.initialSpan.readFloats(this.fieldOutput);
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const ages = current.readAges();
    const targets = this.output.fillNew(current, state);
    let inWindow = 0;
    for (let i = 0; i < values.length; i++) {
      const time = f32(ages[i] / f32(lifetimes[i] + FLOAT_EPSILON));
      if (!(time >= this.startTime && time <= this.endTime)) {
        continue;
      }
      const target = targets[inWindow++];
      const initial = initials[i];
      const result = this.startTime === this.endTime ? (f32(time - this.endTime) < 0 ? initial : target) : lerp(initial, target, saturate(f32(f32(time - this.startTime) / f32(this.endTime - this.startTime))));
      values[i] = lerp(values[i], result, strength);
    }
  }
}
