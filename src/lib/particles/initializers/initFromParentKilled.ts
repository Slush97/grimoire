// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/InitFromParentKilled.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField, isScalarField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';

export class InitFromParentKilled extends ParticleFunctionInitializer {
  private readonly attributeToCopy: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.attributeToCopy = parse.particleField('m_nAttributeToCopy', -1);
  }

  private get copiesAttribute(): boolean { return this.attributeToCopy >= 0 && this.attributeToCopy !== ParticleField.NoneDisabled; }

  get writtenFields(): bigint { return this.copiesAttribute ? fieldMask(this.attributeToCopy) : 0n; }
  shouldRun(state: ParticleSystemState): boolean { return state.emitterEventParticles !== null; }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const indices = state.emitterEventParticles;
    const parent = state.parentSystem?.data;
    if (!this.copiesAttribute || !ParticleFunctionInitializer.isUnwritten(state, this.attributeToCopy) || indices === null || indices.length === 0 || parent === null || parent === undefined) {
      return;
    }
    const parents = parent.particles.currentSpan;
    const vectors = isVectorField(this.attributeToCopy) ? run.vectors(this.attributeToCopy) : null;
    const scalars = isScalarField(this.attributeToCopy) ? run.floats(this.attributeToCopy) : null;
    const parentVectors = vectors !== null ? parents.readVectors(this.attributeToCopy) : null;
    const parentScalars = scalars !== null ? parents.readFloats(this.attributeToCopy) : null;
    let next = 0;
    for (let i = 0; i < run.length; i++) {
      const source = indices[next];
      next = next + 1 < indices.length ? next + 1 : 0;
      if (vectors !== null && parentVectors !== null) {
        writeVector(vectors, i, readVector(parentVectors, source));
      }
      else if (scalars !== null && parentScalars !== null) {
        scalars[i] = parentScalars[source];
      }
    }
  }
}
