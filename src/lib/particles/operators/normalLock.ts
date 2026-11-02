// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/NormalLock.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Matrix4x4, f32, transformNormal } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider } from '../transformProviders';
import { vectorLerp } from '../utils/vectorMath';

export class NormalLock extends ParticleFunctionOperator {
  private readonly controlPoint: number;
  private readonly transform: ControlPointTransformProvider;
  private previousTransform = Matrix4x4.identity();
  private hasPrevious = false;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.controlPoint = parse.controlPoint('m_nControlPointNumber', 0);
    this.transform = new ControlPointTransformProvider(this.controlPoint, true);
  }

  reset(): void {
    this.previousTransform = Matrix4x4.identity();
    this.hasPrevious = false;
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.Normal);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState): void {
    const currentTransform = this.transform.nextTransform(state);
    if (!this.hasPrevious) {
      const controlPointState = state.getControlPoint(this.controlPoint);
      this.previousTransform = controlPointState.previousStepTime > 0
        ? Matrix4x4.fromQuaternion(controlPointState.getPreviousRotation())
          .multiply(Matrix4x4.identity().withTranslation(controlPointState.positionPrevious))
        : currentTransform;
      this.hasPrevious = true;
    }
    let delta = Matrix4x4.identity();
    const previousInverse = this.previousTransform.invert();
    if (previousInverse !== null) {
      delta = previousInverse.multiply(currentTransform);
    }
    const current = particles.currentSpan;
    const normals = current.vectors(ParticleField.Normal);
    const ages = current.readAges();
    for (let i = 0; i < current.length; i++) {
      const ratio = f32(Math.min(ages[i], frameTime) / frameTime);
      const normal = readVector(normals, i);
      const rotated = transformNormal(normal, delta);
      writeVector(normals, i, vectorLerp(normal, rotated, ratio));
    }
    this.previousTransform = currentTransform;
  }
}
