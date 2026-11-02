// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/VelocityRandom.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, safeNormalize, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { RangeSampler } from '../utils/rangeSampler';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class VelocityRandom extends ParticleFunctionInitializer {
  private readonly vectorMin: VectorProvider;
  private readonly vectorMax: VectorProvider;
  private readonly speedMin: NumberProvider;
  private readonly speedMax: NumberProvider;
  private readonly controlPoint: number;
  private readonly ignoreDT: boolean;
  private readonly rangeSampler: RangeSampler;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.vectorMin = parse.vectorProvider('m_LocalCoordinateSystemSpeedMin', new LiteralVectorProvider(Vector3.zero));
    this.vectorMax = parse.vectorProvider('m_LocalCoordinateSystemSpeedMax', new LiteralVectorProvider(Vector3.zero));
    this.speedMin = parse.numberProvider('m_fSpeedMin', new LiteralNumberProvider(0));
    this.speedMax = parse.numberProvider('m_fSpeedMax', new LiteralNumberProvider(0));
    this.controlPoint = parse.controlPoint('m_nControlPointNumber', 0);
    this.ignoreDT = parse.boolean('m_bIgnoreDT', false);
    this.rangeSampler = RangeSampler.parse(parse);
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.PositionPrevious);
  }

  protected initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    const vecMins = this.vectorMin.prepareEvaluated(run, particles.currentSpan, state);
    const vecMaxes = this.vectorMax.prepareEvaluated(run, particles.currentSpan, state);
    const speedMins = this.speedMin.fillNew(run, state);
    const speedMaxes = this.speedMax.fillNew(run, state);
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    const previousPositions = run.vectors(ParticleField.PositionPrevious);
    let sampleIndex = run.start;
    for (let i = 0; i < run.length; i++) {
      if (i % 4 === 0) {
        const block = run.slice(i, Math.min(4, run.length - i));
        this.vectorMin.fillPerBlock(block, 0, state, vecMins.subarray(i * 3));
        this.vectorMax.fillPerBlock(block, 0, state, vecMaxes.subarray(i * 3));
      }
      const vecMin = readVector(vecMins, i);
      const vecMax = readVector(vecMaxes, i);
      let velocity = Vector3.zero;
      if (!vecMin.equals(Vector3.zero) || !vecMax.equals(Vector3.zero)) {
        const localSpeed = this.rangeSampler.nextVectorBetween(sampleIndex++, state, vecMin, vecMax);
        const basis = state.getControlPoint(this.controlPoint).getBasisAtTime(creationTimes[i]);
        velocity = transformNormal(localSpeed, basis);
      }
      const speedmin = speedMins[i];
      const speedmax = speedMaxes[i];
      if (speedmin !== 0 || speedmax !== 0) {
        const direction = safeNormalize(state.random.nextInUnitBall().point);
        velocity = velocity.add(direction.scale(state.random.nextBetween(speedmin, speedmax)));
      }
      writeVector(previousPositions, i, readVector(previousPositions, i).sub(ParticleFunctionInitializer.velocityStep(state, velocity, this.ignoreDT)));
    }
  }
}
