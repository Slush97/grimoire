// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/InheritVelocity.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';

export class InheritVelocity extends ParticleFunctionInitializer {
  private readonly controlPointNumber: number;
  private readonly velocityScale: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.controlPointNumber = parse.controlPoint('m_nControlPointNumber', 0);
    this.velocityScale = parse.float('m_flVelocityScale', 1);
  }

  get writtenFields(): bigint { return fieldMask(ParticleField.PositionPrevious); }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const frameTime = state.currentStep;
    if (frameTime <= 0) {
      return;
    }
    const step = state.getControlPoint(this.controlPointNumber).stepDelta.scale(state.previousStep).div(frameTime);
    if (step.length() >= 100) {
      return;
    }
    const previous = run.vectors(ParticleField.PositionPrevious);
    const scaledStep = step.scale(this.velocityScale);
    for (let i = 0; i < run.length; i++) {
      writeVector(previous, i, readVector(previous, i).sub(scaledStep));
    }
  }
}
