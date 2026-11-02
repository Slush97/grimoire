// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetToCP.cs.

import { fillVectors } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3 } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { transformQuaternion } from '../utils/vectorMath';

export class SetToCP extends ParticleFunctionOperator {
  private readonly controlPoint: number;
  private readonly offset: Vector3;
  private readonly offsetLocal: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.controlPoint = parse.int32('m_nControlPointNumber', 0);
    this.offset = parse.vector3('m_vecOffset', Vector3.zero);
    this.offsetLocal = parse.boolean('m_bOffsetLocal', false);
  }

  get storedFields(): bigint { return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const cp = state.getControlPoint(this.controlPoint);
    const position = this.offsetLocal ? cp.position.add(transformQuaternion(this.offset, cp.getRotation())) : cp.position.add(this.offset);
    const current = particles.currentSpan;
    fillVectors(current.vectors(ParticleField.Position), position);
    fillVectors(current.vectors(ParticleField.PositionPrevious), position);
  }
}
