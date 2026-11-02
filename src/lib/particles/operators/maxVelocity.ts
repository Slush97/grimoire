// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/MaxVelocity.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32 } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

export class MaxVelocity extends ParticleFunctionOperator {
  private readonly maxVelocityProvider: NumberProvider;
  private readonly minVelocityProvider: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.maxVelocityProvider = parse.numberProvider('m_flMaxVelocity', new LiteralNumberProvider(0));
    this.minVelocityProvider = parse.numberProvider('m_flMinVelocity', new LiteralNumberProvider(0));
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const current = particles.currentSpan;
    const positions = current.vectors(ParticleField.Position);
    const previousPositions = current.vectors(ParticleField.PositionPrevious);
    const steps: Vector3[] = [];
    const maxVelocities = this.maxVelocityProvider.fillNew(current, state);
    const minVelocities = this.minVelocityProvider.fillNew(current, state);
    for (const { offset, block } of current.blocks()) {
      const blockLength = block.length;
      let anyMinimum = false;
      let anyAtRest = false;
      for (let lane = 0; lane < blockLength; lane++) {
        const i = offset + lane;
        steps[lane] = readVector(positions, i).sub(readVector(previousPositions, i));
        anyMinimum ||= minVelocities[i] > 0;
        anyAtRest ||= steps[lane].lengthSquared() <= 0;
      }
      if (anyMinimum && anyAtRest) {
        const kicksX = state.threadRandom.nextBetween(f32(-0.1), f32(0.1));
        const kicksY = state.threadRandom.nextBetween(f32(-0.1), f32(0.1));
        for (let lane = 0; lane < blockLength; lane++) {
          let step = steps[lane];
          if (step.lengthSquared() <= 0) {
            step = step.withX(kicksX[lane]).withY(kicksY[lane]);
          }
          steps[lane] = step.withZ(f32(f32(f32(0.1) - step.x) - step.y));
        }
      }
      for (let lane = 0; lane < blockLength; lane++) {
        const i = offset + lane;
        const step = steps[lane];
        const length = step.length();
        const maxStep = f32(maxVelocities[i] * frameTime);
        const minStep = f32(minVelocities[i] * frameTime);
        let scale = 1;
        if (maxStep < length && length > 0) {
          scale = f32(maxStep / length);
        }
        if (length < minStep) {
          scale = f32(minStep / length);
        }
        writeVector(positions, i, ParticleFunctionOperator.blendByStrengthV(readVector(positions, i), step.scale(scale).add(readVector(previousPositions, i)), strength));
      }
    }
  }
}
