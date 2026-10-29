// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/PositionOffset.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Matrix4x4, Vector3, transformNormal } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { RangeSampler } from '../utils/rangeSampler';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

/**
 * C_INIT_PositionOffset: adds a per-component random offset to the position, in a transform's frame
 * with local coordinates, and scaled by the radius when proportional.
 */
export class PositionOffset extends ParticleFunctionInitializer {
  private readonly offsetMin: VectorProvider;
  private readonly offsetMax: VectorProvider;
  private readonly transformInput: TransformProvider;
  private readonly localCoords: boolean;
  private readonly proportional: boolean;
  private readonly rangeSampler: RangeSampler;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.offsetMin = parse.vectorProvider('m_OffsetMin', new LiteralVectorProvider(Vector3.zero));
    this.offsetMax = parse.vectorProvider('m_OffsetMax', new LiteralVectorProvider(Vector3.zero));
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.localCoords = parse.boolean('m_bLocalCoords', false);
    this.proportional = parse.boolean('m_bProportional', false);
    this.rangeSampler = RangeSampler.parse(parse);
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious);
  }

  protected initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, particles, state, false);
  }

  protected initializeBlocks(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, particles, state, true);
  }

  private initializeRun(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState, blockRun: boolean): void {
    const rotation = this.localCoords ? this.transformInput.nextTransform(state) : Matrix4x4.identity();

    // The offsets are evaluated for every live particle, and each particle of the run reads its own value
    const posMins = this.offsetMin.prepareEvaluated(run, particles.currentSpan, state);
    const posMaxs = this.offsetMax.prepareEvaluated(run, particles.currentSpan, state);

    for (const { offset, block, lane } of run.inputBlocks(true)) {
      this.offsetMin.fillPerBlock(block, lane, state, posMins.subarray(offset * 3));
      this.offsetMax.fillPerBlock(block, lane, state, posMaxs.subarray(offset * 3));
    }

    const positions = run.vectors(ParticleField.Position);
    const previousPositions = run.vectors(ParticleField.PositionPrevious);
    const radii = this.proportional ? run.readFloats(ParticleField.Radius) : null;

    for (let n = 0; n < run.length; n++) {
      // The block run walks each block of four from its last particle to its first, which takes
      // both the random draws and the evenly distributed samples in reverse
      const i = blockRun ? n ^ 3 : n;
      const index = run.start + i;
      const sampleIndex = blockRun ? index ^ 3 : index;

      let offset = this.rangeSampler.nextVectorBetween(sampleIndex, state, readVector(posMins, i), readVector(posMaxs, i));

      if (radii !== null) {
        offset = offset.scale(radii[i]);
      }

      if (this.localCoords) {
        offset = transformNormal(offset, rotation);
      }

      writeVector(positions, i, readVector(positions, i).add(offset));
      writeVector(previousPositions, i, readVector(previousPositions, i).add(offset));
    }
  }
}
