// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/PositionLock.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { FLOAT_MAX, Matrix4x4, Vector3, distance, f32, lerp, transform } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { bias as biasCurve, clampToUnit, truncateToQuarterSteps } from '../utils/particleMath';
import type { ThreadRandom } from '../utils/random';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

/**
 * C_OP_PositionLock ("Movement Lock to Control Point"): particles inherit the movement, and
 * optionally the rotation, of a transform input.
 */
export class PositionLock extends ParticleFunctionOperator {
  private readonly transformInput: TransformProvider;
  private readonly startTimeMin: number;
  private readonly startTimeMax: number;
  private readonly startTimeExp: number;
  private readonly endTimeMin: number;
  private readonly endTimeMax: number;
  private readonly endTimeExp: number;
  private readonly fadeRange: number;
  private readonly rangeBias: NumberProvider;
  private readonly instantJumpThreshold: number;
  private readonly prevPosScale: number;
  private readonly lockRotation: boolean;
  private readonly componentScale: VectorProvider;
  private readonly outputField: number;
  private readonly outputFieldPrev: number;

  private previousTransformPosition = Vector3.splat(FLOAT_MAX);
  private previousTransform = Matrix4x4.identity();

  reset(): void {
    this.previousTransformPosition = Vector3.splat(FLOAT_MAX);
    this.previousTransform = Matrix4x4.identity();
  }

  restart(): void {
    this.reset();
  }

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.startTimeMin = parse.float('m_flStartTime_min', 1);
    this.startTimeMax = parse.float('m_flStartTime_max', 1);
    this.startTimeExp = truncateToQuarterSteps(parse.float('m_flStartTime_exp', 1));
    this.endTimeMin = parse.float('m_flEndTime_min', 1);
    this.endTimeMax = parse.float('m_flEndTime_max', 1);
    this.endTimeExp = truncateToQuarterSteps(parse.float('m_flEndTime_exp', 1));
    this.fadeRange = parse.float('m_flRange', 0);
    this.rangeBias = parse.numberProvider('m_flRangeBias', new LiteralNumberProvider(0.2));

    // Squared once at load, so the per-frame test can compare against a squared delta
    const threshold = parse.float('m_flJumpThreshold', 512);
    this.instantJumpThreshold = f32(threshold * threshold);
    this.prevPosScale = parse.float('m_flPrevPosScale', 1);
    this.lockRotation = parse.boolean('m_bLockRot', false);
    this.componentScale = parse.vectorProvider('m_vecScale', new LiteralVectorProvider(Vector3.one));
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Position);
    this.outputFieldPrev = parse.particleField('m_nFieldOutputPrev', ParticleField.PositionPrevious);
  }

  get storedFields(): bigint {
    return fieldMask(this.outputField) | fieldMask(this.outputFieldPrev);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    // Compute the transform delta once per frame; per particle, only the first would see it move
    const currentTransform = this.transformInput.nextTransform(state);
    const transformPosition = currentTransform.translation;
    const scale = this.componentScale.nextVector(state);

    if (this.previousTransformPosition.x === FLOAT_MAX) {
      this.previousTransform = this.transformInput.nextTransformAtTime(state, state.stepStartAge);
      this.previousTransformPosition = this.previousTransform.translation;
    }

    const delta = transformPosition.sub(this.previousTransformPosition);

    // When locking rotation, particles are moved by the change in the transform (current * inverse(previous))
    let rotationLock = Matrix4x4.identity();

    if (this.lockRotation) {
      const previousInverse = this.previousTransform.invert();

      if (previousInverse !== null) {
        rotationLock = previousInverse.multiply(currentTransform);
      }
    }

    this.previousTransformPosition = transformPosition;
    this.previousTransform = currentTransform;

    // A jump beyond the threshold teleports particles with the transform at full strength
    const instantJump = this.instantJumpThreshold !== 0 && delta.lengthSquared() > this.instantJumpThreshold;

    // A start fadeout of 1 (the default) means the lock never fades and is applied every frame
    const alwaysLocked = this.startTimeMin >= 1;

    // The range bias is a collection-scope input, evaluated once for the whole frame
    const rangeBias = this.rangeBias.nextNumber(state);

    if (!isVectorField(this.outputField)) {
      return;
    }

    const current = particles.currentSpan;
    const ages = current.readAges();
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const positions = current.vectors(this.outputField);
    const movesPrevious = this.prevPosScale !== 0 && isVectorField(this.outputFieldPrev);
    const previousPositions = movesPrevious ? current.vectors(this.outputFieldPrev) : null;

    const windows = alwaysLocked ? null : this.fillWindows(state.threadRandom, ages, lifetimes, instantJump);
    const rotatesWholeBlocks = this.fadeRange !== 0 && this.lockRotation;

    for (let i = 0; i < current.length; i++) {
      let window = 1;

      if (windows !== null) {
        window = windows[i];

        if (isUnlocked(windows, i, rotatesWholeBlocks)) {
          continue;
        }
      }

      const currentPosition = readVector(positions, i);

      const creationFraction = f32(Math.min(ages[i], frameTime) / frameTime);

      let move = delta.scale(f32(f32(strength * creationFraction) * window));
      let rotationWeight = alwaysLocked ? strength : window;

      if (this.fadeRange !== 0) {
        // Distance is measured against the position the particle is about to occupy
        const probe = alwaysLocked ? move : move.mul(scale);
        const fadeDistance = distance(transformPosition, currentPosition.add(probe));
        const fade = biasCurve(Math.min(1, f32(fadeDistance / this.fadeRange)), rangeBias);

        move = move.scale(f32(1 - fade));
        rotationWeight = f32(1 - f32(fade * rotationWeight));
      }

      if (this.lockRotation) {
        // Move both positions by the transform delta so particles follow the control point's rotation
        const weight = scale.scale(f32(rotationWeight * creationFraction));

        writeVector(positions, i, currentPosition.add(transform(currentPosition, rotationLock).sub(currentPosition).mul(weight)));

        if (previousPositions !== null) {
          const currentPrevious = readVector(previousPositions, i);
          writeVector(
            previousPositions,
            i,
            currentPrevious.add(transform(currentPrevious, rotationLock).sub(currentPrevious).mul(weight).scale(this.prevPosScale)),
          );
        }
      } else {
        // Translate the particle with the transform, preserving its offset from it
        const scaledMove = move.mul(scale);

        writeVector(positions, i, currentPosition.add(scaledMove));

        if (previousPositions !== null) {
          writeVector(previousPositions, i, readVector(previousPositions, i).add(scaledMove.scale(this.prevPosScale)));
        }
      }
    }
  }

  /**
   * How strongly each particle is still locked, 1 before its unlock window and 0 after it. The window
   * is redrawn every step from the thread generator, one pair per block of four particles.
   */
  private fillWindows(generator: ThreadRandom, ages: Float32Array, lifetimes: Float32Array, instantJump: boolean): Float32Array {
    const windows = new Float32Array(ages.length);

    for (let blockStart = 0; blockStart < windows.length; blockStart += 4) {
      const startDraws = generator.next();
      const endDraws = generator.next();
      const blockEnd = Math.min(blockStart + 4, windows.length);

      for (let i = blockStart; i < blockEnd; i++) {
        const lane = i - blockStart;
        const startTime = lerp(this.startTimeMin, this.startTimeMax, f32(Math.pow(startDraws[lane], this.startTimeExp)));
        const endTime = lerp(this.endTimeMin, this.endTimeMax, f32(Math.pow(endDraws[lane], this.endTimeExp)));

        const lifeFraction = clampToUnit(f32(ages[i] / lifetimes[i]));
        windows[i] = instantJump ? 1 : f32(1 - clampToUnit(f32(f32(lifeFraction - startTime) / f32(endTime - startTime))));
      }
    }

    return windows;
  }
}

/** Whether the particle's window has closed; with `rotatesWholeBlocks` it stays while another of its block is locked. */
function isUnlocked(windows: Float32Array, index: number, rotatesWholeBlocks: boolean): boolean {
  if (windows[index] > 0) {
    return false;
  }

  if (!rotatesWholeBlocks) {
    return true;
  }

  const blockStart = index & ~3;
  const blockEnd = Math.min(blockStart + 4, windows.length);

  for (let i = blockStart; i < blockEnd; i++) {
    if (windows[i] > 0) {
      return false;
    }
  }

  return true;
}
