// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/Noise.cs.

import { readVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField, isOrientationField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, degreesToRadians } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { value3D } from '../utils/noise';

export class Noise extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly outputMin: NumberProvider;
  private readonly outputMax: NumberProvider;
  private readonly additive: boolean;
  private readonly noiseScale: number;
  private readonly animationTimeScale: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.outputMin = parse.numberProvider('m_flOutputMin', new LiteralNumberProvider(0));
    this.outputMax = parse.numberProvider('m_flOutputMax', new LiteralNumberProvider(1));
    this.additive = parse.boolean('m_bAdditive', false);
    this.noiseScale = parse.float('m_fl4NoiseScale', f32(0.1));
    this.animationTimeScale = parse.float('m_flNoiseAnimationTimeScale', 0);
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState): void {
    let min = this.outputMin.nextNumber(state);
    let max = this.outputMax.nextNumber(state);
    if (isOrientationField(this.outputField)) {
      min = degreesToRadians(min);
      max = degreesToRadians(max);
    }
    let valueScale = f32(0.5 * f32(max - min));
    let valueBase = f32(min + valueScale);
    if (this.additive) {
      valueScale = f32(valueScale * frameTime);
      valueBase = f32(valueBase * frameTime);
    }
    const timeOffset = f32(this.animationTimeScale * state.age);
    if (!isScalarField(this.outputField)) {
      return;
    }
    const current = particles.currentSpan;
    const positions = current.readVectors(ParticleField.Position);
    const values = current.floats(this.outputField);
    for (let i = 0; i < current.length; i++) {
      const p = readVector(positions, i);
      const noise = value3D(f32(f32(p.x * this.noiseScale) + timeOffset), f32(p.y * this.noiseScale), f32(p.z * this.noiseScale));
      const value = f32(valueBase + f32(valueScale * noise));
      values[i] = this.additive ? f32(values[i] + value) : value;
    }
  }
}
