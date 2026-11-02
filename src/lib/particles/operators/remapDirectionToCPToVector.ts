// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/RemapDirectionToCPToVector.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, Matrix4x4, saturate, lerpV, safeNormalize, degreesToRadians, transform } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { createFromAxisAngle } from '../utils/vectorMath';

export class RemapDirectionToCPToVector extends ParticleFunctionOperator {
  private readonly cp: number;
  private readonly fieldOutput: number;
  private readonly scale: number;
  private readonly normalize: boolean;
  private readonly fieldStrength: number;
  private readonly rotation: Matrix4x4;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.cp = parse.int32('m_nCP', 0);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Position);
    this.scale = parse.float('m_flScale', 1);
    this.normalize = parse.boolean('m_bNormalize', false);
    this.fieldStrength = parse.particleField('m_nFieldStrength', ParticleField.NoneDisabled);
    this.rotation = createFromAxisAngle(parse.vector3('m_vecOffsetAxis', Vector3.zero), degreesToRadians(parse.float('m_flOffsetRot', 0)));
  }

  get storedFields(): bigint { return fieldMask(this.fieldOutput); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const center = state.getControlPoint(this.cp).position;
    const factor = this.normalize ? this.scale : state.perPreviousSecond(this.scale);
    if (!isVectorField(this.fieldOutput)) {
      return;
    }
    const current = particles.currentSpan;
    const positions = current.readVectors(ParticleField.Position);
    const output = current.vectors(this.fieldOutput);
    const strengths = this.fieldStrength !== ParticleField.NoneDisabled ? current.readFloats(this.fieldStrength) : null;
    for (let i = 0; i < current.length; i++) {
      let direction = transform(readVector(positions, i).sub(center), this.rotation);
      if (this.normalize) {
        direction = safeNormalize(direction);
      }
      let value = direction.scale(factor);
      if (strengths !== null) {
        value = lerpV(readVector(output, i), value, saturate(strengths[i]));
      }
      writeVector(output, i, value);
    }
  }
}
