// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ForceGenerators/CurlNoiseForce.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleDirectionNoiseType, ParticleField } from '../enums';
import { ParticleFunctionForceGenerator } from '../functions';
import { Vector3 } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { curl3D, valueVector3, worleyOffset3D } from '../utils/noise';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class CurlNoiseForce extends ParticleFunctionForceGenerator {
  private readonly noiseType: number;
  private readonly noiseFrequency: VectorProvider;
  private readonly noiseScale: VectorProvider;
  private readonly offset: VectorProvider;
  private readonly offsetRate: VectorProvider;
  private readonly worleySeed: NumberProvider;
  private readonly worleyJitter: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.noiseType = parse.enum('m_nNoiseType', ParticleDirectionNoiseType, 0);
    this.noiseFrequency = parse.vectorProvider('m_vecNoiseFreq', new LiteralVectorProvider(Vector3.splat(0.02)));
    this.noiseScale = parse.vectorProvider('m_vecNoiseScale', new LiteralVectorProvider(Vector3.splat(1000)));
    this.offset = parse.vectorProvider('m_vecOffset', new LiteralVectorProvider(Vector3.zero));
    this.offsetRate = parse.vectorProvider('m_vecOffsetRate', new LiteralVectorProvider(Vector3.zero));
    this.worleySeed = parse.numberProvider('m_flWorleySeed', new LiteralNumberProvider(0));
    this.worleyJitter = parse.numberProvider('m_flWorleyJitter', new LiteralNumberProvider(0.875));
  }

  generateForces(particles: ParticleCollection, forces: Float32Array, _frameTime: number, state: ParticleSystemState, strength: number): void {
    const current = particles.currentSpan;
    const positions = current.readVectors(ParticleField.Position);
    const frequencies = this.noiseFrequency.prepare(current, state);
    const scales = this.noiseScale.prepare(current, state);
    const offsets = this.offset.prepare(current, state);
    const offsetRates = this.offsetRate.prepare(current, state);
    const seeds = this.worleySeed.fillNew(current, state);
    const jitters = this.worleyJitter.fillNew(current, state);
    for (const { offset: blockOffset, block, lane } of current.inputBlocks()) {
      this.noiseFrequency.fillPerBlock(block, lane, state, frequencies.subarray(blockOffset * 3));
      this.noiseScale.fillPerBlock(block, lane, state, scales.subarray(blockOffset * 3));
      this.offsetRate.fillPerBlock(block, lane, state, offsetRates.subarray(blockOffset * 3));
      this.offset.fillPerBlock(block, lane, state, offsets.subarray(blockOffset * 3));
    }
    for (let i = 0; i < current.length; i++) {
      const sample = readVector(offsets, i).add(readVector(offsetRates, i).scale(state.age)).add(readVector(positions, i).mul(readVector(frequencies, i)));
      const noise = this.noiseType === ParticleDirectionNoiseType.PARTICLE_DIR_NOISE_CURL
        ? curl3D(sample)
        : this.noiseType === ParticleDirectionNoiseType.PARTICLE_DIR_NOISE_WORLEY_BASIC
          ? worleyOffset3D(sample, jitters[i], seeds[i])
          : valueVector3(sample);
      writeVector(forces, i, readVector(forces, i).add(noise.mul(readVector(scales, i)).scale(strength)));
    }
  }
}
