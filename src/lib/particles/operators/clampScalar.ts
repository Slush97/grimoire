// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/ClampScalar.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { floatLerp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';

export class ClampScalar extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly outputMin: NumberProvider;
  private readonly outputMax: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.outputMin = parse.numberProvider('m_flOutputMin', new LiteralNumberProvider(0));
    this.outputMax = parse.numberProvider('m_flOutputMax', new LiteralNumberProvider(1));
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState, strength: number): void {
    if (!isScalarField(this.outputField)) {
      return;
    }
    const current = particles.currentSpan;
    const mins = this.outputMin.fillNew(current, state);
    const maxs = this.outputMax.fillNew(current, state);
    const outputs = current.floats(this.outputField);
    for (let i = 0; i < outputs.length; i++) {
      const clamped = Math.min(Math.max(outputs[i], mins[i]), maxs[i]);
      outputs[i] = strength >= 1 ? clamped : floatLerp(outputs[i], clamped, strength);
    }
  }
}
