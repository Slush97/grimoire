// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/RemapTransformOrientationToRotations.cs.

import { fillVectors } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3 } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { computeOrientation } from '../utils/transformOrientationMath';

export class RemapTransformOrientationToRotations extends ParticleFunctionOperator {
  private readonly transformInput: TransformProvider;
  private readonly rotationOffset: Vector3;
  private readonly useQuat: boolean;
  private readonly writeNormal: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.rotationOffset = parse.vector3('m_vecRotation', Vector3.zero);
    this.useQuat = parse.boolean('m_bUseQuat', false);
    this.writeNormal = parse.boolean('m_bWriteNormal', false);
  }

  get storedFields(): bigint { return this.writeNormal ? fieldMask(ParticleField.Normal) : fieldMask(ParticleField.Pitch) | fieldMask(ParticleField.Yaw) | fieldMask(ParticleField.Roll); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const run = particles.currentSpan;
    const { anglesRadians, forward } = computeOrientation(this.transformInput, state, this.rotationOffset, this.useQuat);
    if (this.writeNormal) {
      fillVectors(run.vectors(ParticleField.Normal), forward);
      return;
    }
    run.floats(ParticleField.Pitch).fill(anglesRadians.x);
    run.floats(ParticleField.Yaw).fill(anglesRadians.y);
    run.floats(ParticleField.Roll).fill(anglesRadians.z);
  }
}
