// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/InitialVelocityNoise.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, f32, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { IdentityTransformProvider, type TransformProvider } from '../transformProviders';
import { value3D } from '../utils/noise';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class InitialVelocityNoise extends ParticleFunctionInitializer {
  private readonly outputMin: VectorProvider;
  private readonly outputMax: VectorProvider;
  private readonly noiseScale: NumberProvider;
  private readonly noiseScaleLoc: NumberProvider;
  private readonly offset: NumberProvider;
  private readonly offsetLoc: VectorProvider;
  private readonly absVal: Vector3;
  private readonly absValInv: Vector3;
  private readonly ignoreDt: boolean;
  private readonly transformInput: TransformProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputMin = parse.vectorProvider('m_vecOutputMin', new LiteralVectorProvider(Vector3.zero));
    this.outputMax = parse.vectorProvider('m_vecOutputMax', new LiteralVectorProvider(Vector3.one));
    this.noiseScale = parse.numberProvider('m_flNoiseScale', new LiteralNumberProvider(1));
    this.noiseScaleLoc = parse.numberProvider('m_flNoiseScaleLoc', new LiteralNumberProvider(0.01));
    this.offset = parse.numberProvider('m_flOffset', new LiteralNumberProvider(0));
    this.offsetLoc = parse.vectorProvider('m_vecOffsetLoc', new LiteralVectorProvider(Vector3.zero));
    this.absVal = parse.vector3('m_vecAbsVal', Vector3.zero);
    this.absValInv = parse.vector3('m_vecAbsValInv', Vector3.zero);
    this.ignoreDt = parse.boolean('m_bIgnoreDt', false);
    this.transformInput = parse.transformInput('m_TransformInput', new IdentityTransformProvider());
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.PositionPrevious);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, run, state, false);
  }

  protected initializeBlocks(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, particles.currentSpan, state, true);
  }

  private initializeRun(run: ParticleSpan, evaluated: ParticleSpan, state: ParticleSystemState, blockRun: boolean): void {
    const offsetLocs = this.offsetLoc.prepareEvaluated(run, evaluated, state);
    const mins = this.outputMin.prepareEvaluated(run, evaluated, state);
    const maxs = this.outputMax.prepareEvaluated(run, evaluated, state);
    const offsets = this.offset.fillEvaluated(run, evaluated, state);
    const noiseScales = this.noiseScale.fillEvaluated(run, evaluated, state);
    const noiseScaleLocs = this.noiseScaleLoc.fillEvaluated(run, evaluated, state);
    for (const { offset: blockOffset, block, lane } of run.inputBlocks()) {
      this.offsetLoc.fillPerBlock(block, lane, state, offsetLocs.subarray(blockOffset * 3));
      this.outputMin.fillPerBlock(block, lane, state, mins.subarray(blockOffset * 3));
      this.outputMax.fillPerBlock(block, lane, state, maxs.subarray(blockOffset * 3));
    }
    const positions = run.readVectors(ParticleField.Position);
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    const previousPositions = run.vectors(ParticleField.PositionPrevious);
    const anyInverted = !this.absValInv.equals(Vector3.zero);
    for (let i = 0; i < run.length; i++) {
      const samplePosition = readVector(positions, i).add(readVector(offsetLocs, i)).scale(noiseScaleLocs[i])
        .add(Vector3.splat(f32(f32(creationTimes[i] + offsets[i]) * noiseScales[i])));
      const noise = new Vector3(
        value3D(samplePosition),
        value3D(samplePosition.add(new Vector3(100000.5, 300000.25, 9000001))),
        value3D(samplePosition.add(new Vector3(110000.25, 310000.75, 9100000))),
      );
      const min = readVector(mins, i);
      const max = readVector(maxs, i);
      const velocity = new Vector3(
        InitialVelocityNoise.mapComponent(noise.x, this.absVal.x !== 0, this.absValInv.x !== 0, anyInverted, blockRun, min.x, max.x),
        InitialVelocityNoise.mapComponent(noise.y, this.absVal.y !== 0, this.absValInv.y !== 0, anyInverted, blockRun, min.y, max.y),
        InitialVelocityNoise.mapComponent(noise.z, this.absVal.z !== 0, this.absValInv.z !== 0, anyInverted, blockRun, min.z, max.z),
      );
      const transform = this.transformInput.nextTransformAtTime(state, creationTimes[i]);
      const transformed = transformNormal(velocity, transform);
      writeVector(previousPositions, i, readVector(previousPositions, i).sub(ParticleFunctionInitializer.velocityStep(state, transformed, this.ignoreDt)));
    }
  }

  private static mapComponent(noise: number, absolute: boolean, inverted: boolean, anyInverted: boolean, blockRun: boolean, min: number, max: number): number {
    let value = absolute ? Math.abs(noise) : noise;
    if (anyInverted) {
      if (blockRun) {
        value = inverted ? f32(1 - value) : value;
      } else {
        value = inverted ? f32(1 + value) : -value;
      }
    }
    const absScale = absolute ? 1 : 0.5;
    const span = f32(max - min);
    return f32(f32(f32(f32(value * span) * absScale) + min) + f32(span * f32(1 - absScale)));
  }
}
