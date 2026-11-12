// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/RemapVelocityToVector.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { safeNormalize } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';

/**
 * Writes each particle's velocity (its change in position over the step) into a vector field: per
 * second and scaled, or with m_bNormalize only the direction, scaled, a particle that has not moved
 * keeping its value. Position and its previous value are rejected as outputs.
 */
export class RemapVelocityToVector extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly scale: number;
  private readonly normalize: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Position);
    this.scale = parse.float('m_flScale', 1);
    this.normalize = parse.boolean('m_bNormalize', false);
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    if (this.outputField === ParticleField.Position || this.outputField === ParticleField.PositionPrevious || !isVectorField(this.outputField)) {
      return;
    }
    // Verlet positions hold the previous step's displacement, so divide by that step's time
    const perSecond = state.perPreviousSecond(this.scale);
    const current = particles.currentSpan;
    const output = current.vectors(this.outputField);
    const positions = current.readVectors(ParticleField.Position);
    const previous = current.readVectors(ParticleField.PositionPrevious);
    for (let i = 0; i < current.length; i++) {
      const velocity = readVector(positions, i).sub(readVector(previous, i));
      if (this.normalize) {
        if (velocity.x !== 0 || velocity.y !== 0 || velocity.z !== 0) writeVector(output, i, safeNormalize(velocity).scale(this.scale));
      } else {
        writeVector(output, i, velocity.scale(perSecond));
      }
    }
  }
}
