// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/OrientTo2dDirection.cs.

import { readVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, lerp, degreesToRadians } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { type VectorProvider } from '../vectorProviders';
import { heading } from '../utils/particleMath';
import { ParticleVelocityVectorProvider } from '../vectorProviders';

export class OrientTo2dDirection extends ParticleFunctionOperator {
  private readonly input: VectorProvider;
  private readonly rotationOffset: number;
  private readonly spinStrength: number;
  private readonly fieldOutput: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.input = parse.vectorProvider('m_vecInput', new ParticleVelocityVectorProvider());
    this.rotationOffset = degreesToRadians(parse.float('m_flRotOffset', 0));
    this.spinStrength = parse.float('m_flSpinStrength', 1);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Roll);
  }

  get storedFields(): bigint { return fieldMask(this.fieldOutput); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const current = particles.currentSpan;
    const directions = this.input.fillNew(current, state);
    if (!isScalarField(this.fieldOutput)) {
      return;
    }
    const values = current.floats(this.fieldOutput);
    for (let i = 0; i < values.length; i++) {
      const direction = readVector(directions, i);
      if (direction.x === 0 && direction.y === 0) {
        continue;
      }
      const target = f32(heading(direction) + this.rotationOffset);
      values[i] = lerp(values[i], target, this.spinStrength);
    }
  }
}
