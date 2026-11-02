// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/InitSkinnedPositionFromCPSnapshot.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField, SnapshotIndexType } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Matrix4x4, Vector3, f32, safeNormalize, toInt, transform, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { maxAxisScale } from '../utils/hitBox';
import { HitBoxCache } from '../utils/hitBoxCache';
import { clampLength } from '../utils/quaternionMath';
import { SkinnedSnapshot } from '../utils/skinnedSnapshot';

/**
 * C_INIT_InitSkinnedPositionFromCPSnapshot: places new particles on the points of a skinned control
 * point snapshot, deformed by the current pose of the bones of another control point's model, and
 * records the rest position and bones for the operators that keep them skinned. Without bones the
 * snapshot points are taken as they are. Normals, radii, colour and alpha can be taken along, and
 * particles can leave along their normal or with the velocity of their bones.
 */
export class InitSkinnedPositionFromCPSnapshot extends ParticleFunctionInitializer {
  private readonly snapshot: SkinnedSnapshot;
  private readonly controlPoint: number;
  private readonly random: boolean;
  private readonly randomSeed: number;
  private readonly rigid: boolean;
  private readonly setNormal: boolean;
  private readonly ignoreDt: boolean;
  private readonly minNormalVelocity: number;
  private readonly maxNormalVelocity: number;
  private readonly indexType: number;
  private readonly readIndex: NumberProvider;
  private readonly increment: number;
  private readonly fullLoopIncrement: number;
  private readonly startPoint: number;
  private readonly boneVelocity: number;
  private readonly boneVelocityMax: number;
  private readonly copyColor: boolean;
  private readonly copyAlpha: boolean;
  private readonly setRadius: boolean;

  private nextIndex = 0;
  private readonly randomCounter = { value: 0 };

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.snapshot = new SkinnedSnapshot(parse);
    this.controlPoint = parse.controlPoint('m_nControlPointNumber', 0);
    this.random = parse.boolean('m_bRandom', false);
    this.randomSeed = parse.int32('m_nRandomSeed', 0);
    this.rigid = parse.boolean('m_bRigid', false);
    this.setNormal = parse.boolean('m_bSetNormal', false);
    this.ignoreDt = parse.boolean('m_bIgnoreDt', false);
    this.minNormalVelocity = parse.float('m_flMinNormalVelocity', 0);
    this.maxNormalVelocity = parse.float('m_flMaxNormalVelocity', 0);
    this.indexType = parse.enum('m_nIndexType', SnapshotIndexType, SnapshotIndexType.SNAPSHOT_INDEX_INCREMENT);
    this.readIndex = parse.numberProvider('m_flReadIndex', new LiteralNumberProvider(0));
    this.increment = parse.float('m_flIncrement', 1);
    this.fullLoopIncrement = parse.int32('m_nFullLoopIncrement', 0);
    this.startPoint = parse.int32('m_nSnapShotStartPoint', 0);
    this.boneVelocity = parse.float('m_flBoneVelocity', 0);
    this.boneVelocityMax = parse.float('m_flBoneVelocityMax', 0);
    this.copyColor = parse.boolean('m_bCopyColor', false);
    this.copyAlpha = parse.boolean('m_bCopyAlpha', false);
    this.setRadius = parse.boolean('m_bSetRadius', false);
  }

  reset(): void {
    this.nextIndex = this.startPoint;
    this.randomCounter.value = 0;
  }

  restart(): void {
    this.reset();
  }

  get writtenFields(): bigint {
    let fields = fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious) | fieldMask(ParticleField.HitboxOffsetPosition)
      | fieldMask(ParticleField.BoneIndices) | fieldMask(ParticleField.BoneWeights);

    fields |= this.setNormal ? fieldMask(ParticleField.Normal) : 0n;
    fields |= this.copyColor ? fieldMask(ParticleField.Color) : 0n;
    fields |= this.copyAlpha ? fieldMask(ParticleField.Alpha) : 0n;
    fields |= this.setRadius ? fieldMask(ParticleField.Radius) : 0n;
    return fields;
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const columns = this.snapshot.resolve(state);

    if (columns === null
      || (this.setNormal && columns.normals === null)
      || (this.copyColor && columns.colors === null)
      || (this.copyAlpha && columns.alphas === null)
      || (this.setRadius && columns.radii === null)) {
      return;
    }

    const readIndices = this.indexType === SnapshotIndexType.SNAPSHOT_INDEX_DIRECT ? this.readIndex.fillNew(run, state) : null;

    const positions = run.vectors(ParticleField.Position);
    const previousPositions = run.vectors(ParticleField.PositionPrevious);
    const boneIndices = run.boneIndices;
    const hitboxOffsets = run.vectors(ParticleField.HitboxOffsetPosition);
    const boneWeights = run.vectors(ParticleField.BoneWeights);
    const colors = this.copyColor ? run.vectors(ParticleField.Color) : null;
    const alphas = this.copyAlpha ? run.floats(ParticleField.Alpha) : null;
    const normals = this.setNormal ? run.vectors(ParticleField.Normal) : null;
    const radii = this.setRadius ? run.floats(ParticleField.Radius) : null;
    const cache = HitBoxCache.refresh(state, this.controlPoint, '', true);

    for (let i = 0; i < run.length; i++) {
      const row = this.selectRow(readIndices, i, state, columns.count);

      if (row < 0 || row >= columns.count) {
        continue;
      }

      if (colors !== null) {
        writeVector(colors, i, columns.color(row));
      }

      if (alphas !== null) {
        alphas[i] = columns.alphas![row];
      }

      const local = columns.position(row);
      const modelObject = cache !== null && cache.count > 0 ? cache.object : null;

      if (cache === null || modelObject === null) {
        writeVector(positions, i, local);
        writeVector(previousPositions, i, local);

        if (normals !== null) {
          writeVector(normals, i, columns.normal(row));
        }

        if (radii !== null) {
          radii[i] = columns.radii![row];
        }

        continue;
      }

      boneIndices[i] = columns.boneIndices(row, modelObject.model, cache.count);
      writeVector(hitboxOffsets, i, local);
      writeVector(boneWeights, i, columns.boneWeights(row));

      const withBoneVelocity = this.boneVelocity !== 0 && cache.previousUpdateTime !== -1;
      const skinned = cache.computeSkinningMatrix(boneIndices[i], readVector(boneWeights, i), withBoneVelocity);
      const skin = skinned?.skin ?? identity;
      const previousSkin = skinned?.previousSkin ?? identity;

      let normalOffset = Vector3.zero;

      if (normals !== null) {
        let normal = columns.normal(row);

        if (!this.rigid) {
          normal = safeNormalize(transformNormal(normal, skin));
        }

        writeVector(normals, i, normal);

        const speed = state.random.nextBetween(this.minNormalVelocity, this.maxNormalVelocity);
        normalOffset = normal.scale(this.ignoreDt ? speed : f32(speed * state.previousStep));
      }

      if (radii !== null) {
        radii[i] = f32(columns.radii![row] * (this.rigid ? 1 : maxAxisScale(skin)));
      }

      if (this.rigid) {
        writeVector(positions, i, Vector3.zero);
        writeVector(previousPositions, i, Vector3.zero);
      } else {
        writeVector(positions, i, transform(local, skin));
        writeVector(previousPositions, i, transform(local.add(normalOffset), skin));
      }

      const interval = f32(cache.updateTime - cache.previousUpdateTime);
      const p = previousSkin.m;

      // The interval is divided by unchecked, so equal update times give an infinite or NaN
      // velocity and a negative interval a reversed one; neither is applied here
      if (withBoneVelocity && interval > 0 && Number.isFinite(f32(f32(p[12] + p[13]) + p[14]))) {
        let velocity = skin.translation.sub(previousSkin.translation).div(interval).scale(this.boneVelocity);

        if (this.boneVelocityMax > 0) {
          velocity = clampLength(velocity, this.boneVelocityMax);
        }

        writeVector(previousPositions, i, readVector(previousPositions, i).sub(ParticleFunctionInitializer.velocityStep(state, velocity, this.ignoreDt)));
      }
    }
  }

  private selectRow(readIndices: Float32Array | null, particleIndex: number, state: ParticleSystemState, count: number): number {
    if (this.indexType === SnapshotIndexType.SNAPSHOT_INDEX_DIRECT) {
      // A negative index wraps to a valid row
      const directIndex = toInt(readIndices![particleIndex]);
      return (directIndex >>> 0) % (count >>> 0);
    }

    if (this.random) {
      return SkinnedSnapshot.randomRow(state, count, this.randomSeed, this.randomCounter);
    }

    const index = SkinnedSnapshot.walkRow(this.nextIndex, count, this.fullLoopIncrement);
    this.nextIndex = (index + toInt(this.increment)) | 0;
    return index;
  }
}

/** What a particle bound to no valid bone is skinned with. */
const identity = Matrix4x4.identity();
