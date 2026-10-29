// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/InitVec.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { applySetMethodV, fieldMask, isVectorField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, safeNormalize } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class InitVec extends ParticleFunctionInitializer {
  private readonly outputField: number;
  private readonly inputValue: VectorProvider;
  private readonly setMethod: number;
  private readonly normalizedOutput: boolean;
  private readonly writePreviousPosition: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nOutputField', ParticleField.Color);
    this.inputValue = parse.vectorProvider('m_InputValue', new LiteralVectorProvider(Vector3.zero));
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.normalizedOutput = parse.boolean('m_bNormalizedOutput', false);
    this.writePreviousPosition = parse.boolean('m_bWritePreviousPosition', false);
  }

  get writtenFields(): bigint {
    return this.writePreviousPosition && this.outputField === ParticleField.Position
      ? fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious)
      : fieldMask(this.outputField);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const inputs = this.inputValue.fillNew(run, state);
    if (!isVectorField(this.outputField)) {
      return;
    }
    const values = run.vectors(this.outputField);
    const writesPrevious = this.writePreviousPosition && this.outputField === ParticleField.Position;
    const previousPositions = writesPrevious ? run.vectors(ParticleField.PositionPrevious) : null;
    for (let i = 0; i < run.length; i++) {
      const current = readVector(values, i);
      let value = applySetMethodV(readVector(inputs, i), current, current, state.currentStep, this.setMethod);
      if (this.normalizedOutput) {
        value = safeNormalize(value);
      }
      writeVector(values, i, value);
      if (previousPositions !== null) {
        writeVector(previousPositions, i, value);
      }
    }
  }
}
