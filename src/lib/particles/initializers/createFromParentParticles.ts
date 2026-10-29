// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/CreateFromParentParticles.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { f32, clamp, lerpV, toInt } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';
import { remapClamped } from '../utils/particleMath';
import { vectorLerp } from '../utils/vectorMath';

export class CreateFromParentParticles extends ParticleFunctionInitializer {
  private readonly velocityScale: number;
  private readonly increment: number;
  private readonly randomDistribution: boolean;
  private readonly randomSeed: number;
  private readonly subFrame: boolean;
  private readonly setRopeSegmentID: boolean;
  private readonly writeParentIndex: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.velocityScale = parse.float('m_flVelocityScale', 0);
    this.increment = parse.float('m_flIncrement', 1);
    this.randomDistribution = parse.boolean('m_bRandomDistribution', false);
    this.randomSeed = parse.int32('m_nRandomSeed', 0);
    this.subFrame = parse.boolean('m_bSubFrame', true);
    this.setRopeSegmentID = parse.boolean('m_bSetRopeSegmentID', false);
    this.writeParentIndex = parse.behaviorVersion >= 9;
  }
  private currentParentIndex = 0;
  private readonly randomCounter = { value: 0 };

  reset(): void { this.currentParentIndex = 0; this.randomCounter.value = 0; }

  get writtenFields(): bigint { return fieldMask(ParticleField.Position) | fieldMask(ParticleField.LifeDuration) | fieldMask(ParticleField.PositionPrevious) | fieldMask(ParticleField.ParentParticleIndex) | fieldMask(ParticleField.ParentParticleId) | (this.setRopeSegmentID ? fieldMask(ParticleField.RopeSegmentId) : 0n); }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const positions = run.vectors(ParticleField.Position);
    const previous = run.vectors(ParticleField.PositionPrevious);
    const parent = state.parentSystem?.data;
    if (parent === null || parent === undefined) {
      positions.fill(0);
      previous.fill(0);
      return;
    }
    const parents = parent.particles.currentSpan;
    if (parents.length === 0) {
      run.floats(ParticleField.LifeDuration).fill(0);
      positions.fill(0);
      previous.fill(0);
      return;
    }
    const times = run.readFloats(ParticleField.CreationTime);
    const indices = this.writeParentIndex ? run.integers(ParticleField.ParentParticleIndex) : null;
    const ids = this.writeParentIndex ? run.integers(ParticleField.ParentParticleId) : null;
    const ropeIds = this.writeParentIndex && this.setRopeSegmentID ? run.integers(ParticleField.RopeSegmentId) : null;
    const lastIndex = parents.length - 1;
    const parentIds = parents.readIntegers(ParticleField.ParticleId);
    const parentPositions = parents.readVectors(ParticleField.Position);
    const parentPrevious = parents.readVectors(ParticleField.PositionPrevious);
    const fractional = this.increment !== Math.floor(this.increment);
    for (let i = 0; i < run.length; i++) {
      const walk = this.nextParentIndex(lastIndex, state);
      const index = clamp(toInt(Math.floor(walk)), 0, lastIndex);
      if (indices !== null && ids !== null) {
        indices[i] = index;
        ids[i] = parentIds[index];
        if (ropeIds !== null) {
          ropeIds[i] = parentIds[index];
        }
      }
      let position = readVector(parentPositions, index);
      let previousPosition = readVector(parentPrevious, index);
      if (fractional) {
        const next = clamp(toInt(Math.ceil(walk)), 0, lastIndex);
        const blend = f32(walk - Math.floor(walk));
        position = vectorLerp(position, readVector(parentPositions, next), blend);
        previousPosition = vectorLerp(previousPosition, readVector(parentPrevious, next), blend);
      }
      const birth = this.subFrame ? remapClamped(times[i], f32(state.age - state.currentStep), state.age, 0, 1) : 1;
      const spawned = lerpV(previousPosition, position, birth);
      writeVector(positions, i, spawned);
      writeVector(previous, i, lerpV(spawned, previousPosition, this.velocityScale));
    }
  }
  private nextParentIndex(last: number, state: ParticleSystemState): number {
    if (this.randomDistribution) {
      const sample = state.random.nextOrSeeded(this.randomSeed, this.randomCounter);
      this.currentParentIndex = this.increment !== Math.floor(this.increment) ? f32(sample * last) : f32(toInt(f32(sample * (last + 1))));
    }
    else if (this.currentParentIndex > last) {
      this.currentParentIndex = 0;
    }
    const index = this.currentParentIndex;
    this.currentParentIndex = f32(this.currentParentIndex + this.increment);
    return index;
  }
}
