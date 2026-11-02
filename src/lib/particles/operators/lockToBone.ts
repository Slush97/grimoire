// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/LockToBone.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Quaternion, Vector3, degreesToRadians, distanceSquared, eulerAnglesToQuaternion, f32, lerpV, minF } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import type { HitBox } from '../utils/hitBox';
import { HitBoxCache } from '../utils/hitBoxCache';
import { NO_FADE_END } from '../utils/particleMath';
import { quaternionInverse } from '../utils/quaternionMath';
import { modelInputControlPoint } from '../utils/skinnedSnapshot';
import { quaternionMultiply, quaternionToEulerAngles, transformQuaternion } from '../utils/vectorMath';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

const RotationLockType = {
  PARTICLE_ROTATION_LOCK_NONE: 0,
  PARTICLE_ROTATION_LOCK_ROTATIONS: 1,
  PARTICLE_ROTATION_LOCK_NORMAL: 2,
} as const;

/**
 * C_OP_LockToBone: keeps particles on the hitboxes, or bones, of the model its model input reads.
 * The box and the place in it recorded at creation are turned back into a position every step,
 * which the particle either snaps to or follows the box's motion toward, fading out over its life.
 * The rotation of the box can be passed on to the particle's normal or rotation angles.
 */
export class LockToBone extends ParticleFunctionOperator {
  private readonly modelControlPoint: number;
  private readonly transformInput: TransformProvider;
  private readonly lifeTimeFadeStart: number;
  private readonly lifeTimeFadeEnd: number;
  private readonly jumpThreshold: number;
  private readonly prevPosScale: number;
  private readonly hitboxSetName: string;
  private readonly rigid: boolean;
  private readonly useBones: boolean;
  private readonly fieldOutput: number;
  private readonly fieldOutputPrev: number;
  private readonly rotationSetType: number;
  private readonly rigidRotationLock: boolean;
  private readonly rotation: VectorProvider;
  private readonly rotationLerp: NumberProvider;
  private readonly storedFieldsValue: bigint;

  private boxRotations: Quaternion[] = [];

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.modelControlPoint = modelInputControlPoint(parse);
    this.transformInput = parse.transformInput('m_transformInput', new ControlPointTransformProvider());
    this.lifeTimeFadeStart = parse.float('m_flLifeTimeFadeStart', 0);
    this.lifeTimeFadeEnd = parse.float('m_flLifeTimeFadeEnd', 0);
    const jumpThreshold = parse.float('m_flJumpThreshold', 100);
    this.jumpThreshold = f32(jumpThreshold * jumpThreshold);
    this.prevPosScale = parse.float('m_flPrevPosScale', 1);
    this.hitboxSetName = parse.string('m_HitboxSetName', 'default');
    this.rigid = parse.boolean('m_bRigid', false);
    this.useBones = parse.boolean('m_bUseBones', false);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Position);
    this.fieldOutputPrev = parse.particleField('m_nFieldOutputPrev', ParticleField.PositionPrevious);
    this.rotationSetType = parse.enum('m_nRotationSetType', RotationLockType, RotationLockType.PARTICLE_ROTATION_LOCK_NONE);
    this.rigidRotationLock = parse.boolean('m_bRigidRotationLock', false);
    this.rotation = parse.vectorProvider('m_vecRotation', new LiteralVectorProvider(Vector3.zero));
    this.rotationLerp = parse.numberProvider('m_flRotLerp', new LiteralNumberProvider(1));

    let stored = fieldMask(this.fieldOutput);

    if (this.fieldOutputPrev !== ParticleField.NoneDisabled) {
      stored |= fieldMask(this.fieldOutputPrev);
    }

    if (this.rotationSetType === RotationLockType.PARTICLE_ROTATION_LOCK_ROTATIONS) {
      stored |= fieldMask(ParticleField.Yaw) | fieldMask(ParticleField.Pitch) | fieldMask(ParticleField.Roll);
    } else if (this.rotationSetType === RotationLockType.PARTICLE_ROTATION_LOCK_NORMAL) {
      stored |= fieldMask(ParticleField.Normal);
    }

    this.storedFieldsValue = stored;
  }

  get storedFields(): bigint {
    return this.storedFieldsValue;
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void {
    // The cache never holds boxes from a snapshot, whose hitbox index table would remap the hitbox
    // indices and move nothing that step
    if (frameTime <= 0 || this.modelControlPoint < 0) {
      return;
    }

    const cache = HitBoxCache.refresh(state, this.modelControlPoint, this.hitboxSetName, this.useBones);

    if (cache === null || !cache.isStable) {
      return;
    }

    const current = cache.currentBoxes;
    const previous = cache.previousBoxes;

    const position = this.transformInput.nextTransform(state).translation;
    const previousPosition = this.transformInput.nextTransformAtTime(state, state.stepStartAge).translation;
    const jumped = distanceSquared(position, previousPosition) > this.jumpThreshold;

    const fadeEnd = this.lifeTimeFadeEnd > 0 ? this.lifeTimeFadeEnd : NO_FADE_END;
    const inverseFade = this.lifeTimeFadeEnd > this.lifeTimeFadeStart ? f32(1 / f32(this.lifeTimeFadeEnd - this.lifeTimeFadeStart)) : 0;
    const prevScale = jumped ? 1 : this.prevPosScale;
    const writePrevious = prevScale !== 0 && isVectorField(this.fieldOutputPrev);
    const lockRotation = this.rotationSetType !== RotationLockType.PARTICLE_ROTATION_LOCK_NONE;

    if (lockRotation) {
      this.buildBoxRotations(current, previous);
    }

    const particleSpan = particles.currentSpan;
    const ages = particleSpan.readAges();
    const hitboxIndices = particleSpan.readIntegers(ParticleField.HitboxIndex);
    const hitboxOffsets = particleSpan.readVectors(ParticleField.HitboxOffsetPosition);

    const writeOutput = isVectorField(this.fieldOutput);
    const outputs = writeOutput ? particleSpan.vectors(this.fieldOutput) : null;
    const previousOutputs = writePrevious ? particleSpan.vectors(this.fieldOutputPrev) : null;

    const lockNormal = this.rotationSetType === RotationLockType.PARTICLE_ROTATION_LOCK_NORMAL;
    const normals = lockRotation && lockNormal ? particleSpan.vectors(ParticleField.Normal) : null;
    const yaws = lockRotation && !lockNormal ? particleSpan.floats(ParticleField.Yaw) : null;
    const pitches = lockRotation && !lockNormal ? particleSpan.floats(ParticleField.Pitch) : null;
    const rolls = lockRotation && !lockNormal ? particleSpan.floats(ParticleField.Roll) : null;

    const rotationAngles = this.rotation.prepare(particleSpan, state);
    const rotationLerps = this.rotationLerp.fillNew(particleSpan, state);
    let nextRotationBlock = 0;

    // The rotation lerp is read one block of four at a time by the blocks that lock a rotation, so
    // the nth such block reads the values of the nth block
    let lerpBlockStart = -4;

    // Locking stops for every later particle of the step once a block of four has none to lock, because that block
    // is skipped without advancing the streams; every particle is considered here
    for (let i = 0; i < particleSpan.length; i++) {
      const age = ages[i];
      const index = hitboxIndices[i];

      // Skipped particles that share a block of four with a locked one still have their normal or rotation
      // lerped toward the rotation of the last cached hitbox; they are left untouched here
      if ((age >= fadeEnd && !jumped) || index < 0 || index >= current.length) {
        continue;
      }

      const stepFraction = f32(minF(age, frameTime) / frameTime);
      const fraction = readAt(hitboxOffsets, i);
      const target = current[index].pointAt(fraction);
      const weight = f32(f32(1 - f32(f32(age - this.lifeTimeFadeStart) * inverseFade)) * strength);

      if (this.rigid) {
        if (outputs !== null) {
          writeAt(outputs, i, target);
        }

        if (previousOutputs !== null) {
          writeAt(previousOutputs, i, target);
        }
      } else {
        let delta = target.sub(previous[index].pointAt(fraction)).scale(stepFraction);

        if (this.lifeTimeFadeStart < age && !jumped) {
          delta = delta.scale(weight);
        }

        if (outputs !== null) {
          writeAt(outputs, i, readAt(outputs, i).add(delta));
        }

        if (previousOutputs !== null) {
          writeAt(previousOutputs, i, readAt(previousOutputs, i).add(delta.scale(prevScale)));
        }
      }

      if (!lockRotation) {
        continue;
      }

      let boxRotation = this.boxRotations[index];
      let rotationWeight = stepFraction;

      if (!this.rigid) {
        rotationWeight = f32(rotationWeight * weight);
      }

      if (this.rigidRotationLock) {
        // A per-block rotation draws only for the blocks of four that have a particle on a hitbox
        if (i >= nextRotationBlock) {
          const { offset, block } = particleSpan.blockAt(i);
          this.rotation.fillPerBlock(block, block.start & 3, state, rotationAngles.subarray(offset * 3));
          nextRotationBlock = offset + block.length;
          lerpBlockStart += 4;
        }

        const angles = readAt(rotationAngles, i);
        boxRotation = quaternionMultiply(boxRotation, eulerAnglesToQuaternion(new Vector3(angles.y, angles.z, angles.x)));
        rotationWeight = rotationLerps[lerpBlockStart + ((particleSpan.start + i) & 3)];
      }

      if (lockNormal) {
        this.lockNormal(normals!, i, boxRotation, rotationWeight);
      } else {
        lockRotationAngles(yaws!, pitches!, rolls!, i, boxRotation, rotationWeight);
      }
    }
  }

  private buildBoxRotations(current: readonly HitBox[], previous: readonly HitBox[]): void {
    if (this.boxRotations.length < current.length) {
      this.boxRotations = new Array<Quaternion>(current.length).fill(Quaternion.identity);
    }

    for (let i = 0; i < current.length; i++) {
      this.boxRotations[i] = this.rigidRotationLock
        ? current[i].orientation
        : quaternionMultiply(current[i].orientation, quaternionInverse(previous[i].orientation));
    }
  }

  private lockNormal(normals: Float32Array, i: number, boxRotation: Quaternion, weight: number): void {
    const normal = readAt(normals, i);
    const target = this.rigidRotationLock ? transformQuaternion(Vector3.unitX, boxRotation) : transformQuaternion(normal, boxRotation);
    writeAt(normals, i, lerpV(normal, target, weight));
  }
}

function lockRotationAngles(yaws: Float32Array, pitches: Float32Array, rolls: Float32Array, i: number, boxRotation: Quaternion, weight: number): void {
  const degrees = quaternionToEulerAngles(boxRotation);
  const pitchYawRoll = new Vector3(degreesToRadians(degrees.x), degreesToRadians(degrees.y), degreesToRadians(degrees.z));
  const targetRotation = new Vector3(pitchYawRoll.y, pitchYawRoll.x, pitchYawRoll.z);
  const newRotation = lerpV(new Vector3(yaws[i], pitches[i], rolls[i]), targetRotation, weight);
  yaws[i] = newRotation.x;
  pitches[i] = newRotation.y;
  rolls[i] = newRotation.z;
}

function readAt(column: Float32Array, i: number): Vector3 {
  return new Vector3(column[i * 3], column[i * 3 + 1], column[i * 3 + 2]);
}

function writeAt(column: Float32Array, i: number, value: Vector3): void {
  column[i * 3] = value.x;
  column[i * 3 + 1] = value.y;
  column[i * 3 + 2] = value.z;
}
