// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/CreateWithinBox.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, transform } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { RangeSampler } from '../utils/rangeSampler';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

/**
 * C_INIT_CreateWithinBox: places particles at random positions within a box, around a control point
 * where it was at each particle's creation time, optionally in the control point's own axes.
 * m_bUseNewCode is not read, as in VRF.
 */
export class CreateWithinBox extends ParticleFunctionInitializer {
  private readonly min: VectorProvider;
  private readonly max: VectorProvider;
  private readonly controlPointNumber: number;
  private readonly localSpace: boolean;
  private readonly rangeSampler: RangeSampler;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.min = parse.vectorProvider('m_vecMin', new LiteralVectorProvider(Vector3.zero));
    this.max = parse.vectorProvider('m_vecMax', new LiteralVectorProvider(Vector3.zero));
    this.controlPointNumber = parse.controlPoint('m_nControlPointNumber', 0);
    this.localSpace = parse.boolean('m_bLocalSpace', false);
    this.rangeSampler = RangeSampler.parse(parse);
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    const positions = run.vectors(ParticleField.Position);
    const previous = ParticleFunctionInitializer.spawnPreviousPositions(run, state);
    const controlPoint = state.getControlPoint(this.controlPointNumber);

    const [mins, maxs] = run.fillVectorInputs(this.min, this.max, state);

    for (let i = 0; i < run.length; i++) {
      let position = this.rangeSampler.nextVectorBetween(run.start + i, state, readVector(mins, i), readVector(maxs, i));

      position = this.localSpace
        ? transform(position, controlPoint.getBasisAtTime(creationTimes[i]))
        : position.add(controlPoint.getPositionAtTime(creationTimes[i]));

      writeVector(positions, i, position);

      if (previous !== null) {
        writeVector(previous, i, position);
      }
    }
  }
}
