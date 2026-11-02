// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/VectorNoise.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { value3D } from '../utils/noise';

export class VectorNoise extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly outputMin: Vector3;
  private readonly outputMax: Vector3;
  private readonly noiseScale: number;
  private readonly noiseAnimationTimeScale: number;
  private readonly additive: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Color);
    this.outputMin = parse.vector3('m_vecOutputMin', Vector3.zero);
    this.outputMax = parse.vector3('m_vecOutputMax', Vector3.one);
    this.noiseScale = parse.float('m_fl4NoiseScale', f32(0.1));
    this.noiseAnimationTimeScale = parse.float('m_flNoiseAnimationTimeScale', 0);
    this.additive = parse.boolean('m_bAdditive', false);
  }

  get storedFields(): bigint {
    return this.additive && this.outputField === ParticleField.Position
      ? fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious)
      : fieldMask(this.outputField);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    const valueScale = this.outputMax.sub(this.outputMin).scale(0.5);
    const valueBase = valueScale.add(this.outputMin);
    const timeOffset = f32(this.noiseAnimationTimeScale * state.age);
    if (!isVectorField(this.outputField)) {
      return;
    }
    const current = particles.currentSpan;
    const output = current.vectors(this.outputField);
    const positions = current.readVectors(ParticleField.Position);
    const movesPrevious = this.additive && this.outputField === ParticleField.Position;
    const previousPositions = movesPrevious ? current.vectors(ParticleField.PositionPrevious) : null;
    const step = f32(frameTime * strength);
    for (let i = 0; i < current.length; i++) {
      let first = readVector(positions, i).scale(this.noiseScale);
      first = first.withX(f32(first.x + timeOffset));
      const second = first.add(new Vector3(100000.5, 300000.25, 9000001));
      const third = second.add(new Vector3(110000.25, 310000.75, 9100000));
      const noise = new Vector3(value3D(first), value3D(second), value3D(third));
      let value = noise.mul(valueScale).add(valueBase);
      if (!this.additive) {
        writeVector(output, i, value);
        continue;
      }
      value = value.scale(step);
      writeVector(output, i, readVector(output, i).add(value));
      if (previousPositions !== null) {
        writeVector(previousPositions, i, readVector(previousPositions, i).add(value));
      }
    }
  }
}
