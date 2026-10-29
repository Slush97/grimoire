// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/RotateVector.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32, lerp, lerpV, safeNormalize, degreesToRadians, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { vectorLerp, createFromAxisAngle } from '../utils/vectorMath';
import { ParticleRandom } from '../utils/random';

export class RotateVector extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly rotAxisMin: Vector3;
  private readonly rotAxisMax: Vector3;
  private readonly rotRateMin: number;
  private readonly rotRateMax: number;
  private readonly perParticleScale: NumberProvider;
  private readonly normalize: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Normal);
    this.rotAxisMin = RotateVector.axis(parse.vector3('m_vecRotAxisMin', Vector3.unitZ));
    this.rotAxisMax = RotateVector.axis(parse.vector3('m_vecRotAxisMax', Vector3.unitZ));
    this.rotRateMin = parse.float('m_flRotRateMin', 180);
    this.rotRateMax = parse.float('m_flRotRateMax', 180);
    this.perParticleScale = parse.numberProvider('m_flScale', new LiteralNumberProvider(1));
    this.normalize = parse.boolean('m_bNormalize', true);
  }
  private static axis(v: Vector3): Vector3 { return v.lengthSquared() === 0 ? Vector3.unitZ : safeNormalize(v); }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const current = particles.currentSpan;
    const scales = this.perParticleScale.fillNew(current, state);
    if (!isVectorField(this.outputField)) {
      return;
    }
    const output = current.vectors(this.outputField);
    const ids = current.readIntegers(ParticleField.ParticleId);
    for (let i = 0; i < current.length; i++) {
      const random = ParticleRandom.forSample((state.random.seed + ids[i]) | 0);
      const axis = safeNormalize(lerpV(this.rotAxisMin, this.rotAxisMax, random));
      const rate = degreesToRadians(lerp(this.rotRateMin, this.rotRateMax, random));
      const value = readVector(output, i);
      let rotated = transformNormal(value, createFromAxisAngle(axis, f32(f32(rate * scales[i]) * frameTime)));
      if (this.normalize) {
        rotated = safeNormalize(rotated);
      }
      writeVector(output, i, vectorLerp(value, rotated, strength));
    }
  }
}
