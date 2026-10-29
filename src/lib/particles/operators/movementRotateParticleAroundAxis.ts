// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/MovementRotateParticleAroundAxis.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, degreesToRadians, f32, transform, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { createFromAxisAngle, vectorLerp } from '../utils/vectorMath';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class MovementRotateParticleAroundAxis extends ParticleFunctionOperator {
  private readonly rotationAxis: VectorProvider;
  private readonly rotationRate: NumberProvider;
  private readonly transformInput: TransformProvider;
  private readonly localSpace: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.rotationAxis = parse.vectorProvider('m_vecRotAxis', new LiteralVectorProvider(Vector3.unitZ));
    this.rotationRate = parse.numberProvider('m_flRotRate', new LiteralNumberProvider(180));
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.localSpace = parse.boolean('m_bLocalSpace', false);
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const angle = f32(degreesToRadians(this.rotationRate.nextNumber(state)) * frameTime);
    let axis = this.rotationAxis.nextVector(state);
    const lengthSquared = axis.lengthSquared();
    axis = lengthSquared > 0 ? axis.div(f32(Math.sqrt(lengthSquared))) : Vector3.unitZ;
    const matrix = this.transformInput.nextTransform(state);
    if (this.localSpace) {
      axis = transformNormal(axis, matrix);
    }
    const center = matrix.translation;
    const rotation = createFromAxisAngle(axis, angle);
    const current = particles.currentSpan;
    const positions = current.vectors(ParticleField.Position);
    const previousPositions = current.vectors(ParticleField.PositionPrevious);
    for (let i = 0; i < current.length; i++) {
      const position = readVector(positions, i);
      const previousPosition = readVector(previousPositions, i);
      const rotated = center.add(transform(position.sub(center), rotation));
      const rotatedPrevious = center.add(transform(previousPosition.sub(center), rotation));
      writeVector(positions, i, vectorLerp(position, rotated, strength));
      writeVector(previousPositions, i, vectorLerp(previousPosition, rotatedPrevious, strength));
    }
  }
}
