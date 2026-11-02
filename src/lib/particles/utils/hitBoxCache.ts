// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/HitBoxCache.cs and
// ValveResourceFormat/Particles/Utils/HitBoxSampling.cs.
//
// The hitboxes, or the bones, of the model a control point carries, refreshed at most once per
// system time and keeping the boxes of the refresh before, so functions can tell how the model
// moved. Each system holds one per control point, and the first function to read it at a given
// time decides whether it holds hitboxes or bones and which hitbox set. Without hitboxes, a system
// that falls back to render bounds reads one box around the model's bounds, or an empty box at the
// world origin when the control point carries no model.

import { ClosestPointTestType } from '../enums';
import { HitboxShape, type ParticleHitbox, type ParticleModel, type ParticleModelObject } from '../model';
import {
  FLOAT_MAX,
  FLOAT_MIN,
  Matrix4x4,
  Vector3,
  distance,
  distanceSquared,
  dot,
  f32,
  lerpV,
  lerpVV,
  maxV,
  minV,
  radicalInverse,
  saturate,
} from '../numerics';
import { MAX_CONTROL_POINT, type ParticleSystemState } from '../state';
import { HitBox, addMatrices, scaleMatrix } from './hitBox';
import { PACKED_BONE_COUNT, PACKED_BONE_NONE, getPackedBone } from './packedBones';
import { FLOAT_EPSILON } from './particleMath';

const DEFAULT_HITBOX_SET = 'default';
const BONE_BOX_EXTENT = 8;

/** How `HitBoxCache.randomPoint` picks a point (HitBoxSampling). */
export interface HitBoxSampling {
  /** How many candidates past the first to draw. */
  tries: number;
  /** The only box to pick, or -1 for any. */
  desiredHitbox: number;
  /** The part of each box's extent to pick from, centred on the box, per axis. */
  scale: Vector3;
  /** The direction from the origin candidates are scored along. */
  directionBias: Vector3;
  /** Below 1, pushes the point onto a face, keeping this fraction of the scaled extent. */
  shellSize: number;
  /** Spread the positions within a box along a Halton sequence instead of at random. */
  evenDistribution: boolean;
  /** Pick boxes in proportion to their volume. */
  weightByVolume: boolean;
}

export class HitBoxCache {
  private current: HitBox[] = [];
  private previous: HitBox[] = [];
  private pose: Matrix4x4[] = [];

  private inverseBindPoseModel: ParticleModel | null = null;
  private inverseBindPoseValue: readonly Matrix4x4[] = [];

  private boundsTime = Number.NaN;
  private bounds = { min: Vector3.zero, max: Vector3.zero };

  /** How many boxes the last refresh found. */
  count = 0;

  /** How many boxes the refresh before found. */
  previousCount = 0;

  /** The system time of the last refresh, or -1 before the first. */
  updateTime = -1;

  /** The system time of the refresh before, or -1 when there was none. */
  previousUpdateTime = -1;

  /** The sum of every box's volume. */
  totalVolume = 0;

  /** The object the boxes were read from, or null when the control point carries none. */
  object: ParticleModelObject | null = null;

  /** Whether the last refresh found no hitboxes and holds the one box around the render bounds instead. */
  isRenderBoundsFallback = false;

  /** The boxes of the last refresh. */
  get currentBoxes(): readonly HitBox[] {
    return this.current.slice(0, this.count);
  }

  /** The boxes of the refresh before. */
  get previousBoxes(): readonly HitBox[] {
    return this.previous.slice(0, this.previousCount);
  }

  /** Whether there are boxes and the refresh before found as many, so the two can be paired. */
  get isStable(): boolean {
    return this.count !== 0 && this.count === this.previousCount;
  }

  /**
   * Refreshes the cache of control point `cp` unless it was already refreshed at the system's
   * current time, and returns it. Null for a control point outside the valid range.
   */
  static refresh(systemState: ParticleSystemState, cp: number, hitboxSetName: string, useBones: boolean, computeVolumes = false): HitBoxCache | null {
    if (cp < 0 || cp > MAX_CONTROL_POINT) {
      return null;
    }

    const controlPoint = systemState.getControlPoint(cp);
    const cache = controlPoint.hitBoxes;

    if (cache.updateTime !== systemState.age) {
      cache.update(systemState, controlPoint.resolveModelObject(), hitboxSetName, useBones, computeVolumes);
    }

    return cache;
  }

  private update(systemState: ParticleSystemState, modelObject: ParticleModelObject | null, hitboxSetName: string, useBones: boolean, computeVolumes: boolean): void {
    this.previousCount = this.count;
    this.previousUpdateTime = this.updateTime;
    this.updateTime = systemState.age;
    this.totalVolume = 0;
    [this.current, this.previous] = [this.previous, this.current];
    this.object = modelObject;
    this.isRenderBoundsFallback = false;
    this.count = 0;

    if (useBones) {
      if (modelObject !== null) {
        this.readBones(modelObject);
      }

      return;
    }

    if (modelObject !== null) {
      this.readHitBoxes(modelObject, hitboxSetName, computeVolumes);
    }

    // Falling back to boxes built from the control point's snapshot (m_bShouldHitboxesFallbackToSnapshot) is not modelled
    if (this.count === 0 && systemState.data?.hitboxesFallBackToRenderBounds === true) {
      const transform = modelObject === null ? Matrix4x4.identity() : modelObject.transform;
      const modelBounds = modelObject === null ? { min: Vector3.zero, max: Vector3.zero } : modelObject.model.bounds;
      const volume = computeVolumes ? volumeOf(modelBounds.max.sub(modelBounds.min)) : 1;

      this.current[0] = HitBox.fromTransform(transform, modelBounds.min, modelBounds.max, volume);
      this.count = 1;
      this.totalVolume = volume;
      this.isRenderBoundsFallback = true;
    }
  }

  private readBones(modelObject: ParticleModelObject): void {
    const bones = modelObject.model.skeleton.bones;
    const transform = modelObject.transform;
    const extent = Vector3.splat(BONE_BOX_EXTENT);

    if (bones.length === 0) {
      this.current[0] = HitBox.fromTransform(transform, extent.negate(), extent, 1);
      this.count = 1;
      this.totalVolume = 1;
      return;
    }

    const boneTransforms = this.posed(modelObject);

    for (let i = 0; i < bones.length; i++) {
      this.current[i] = HitBox.fromTransform(boneTransforms[i].multiply(transform), extent.negate(), extent, 1);
    }

    this.count = bones.length;
    this.totalVolume = this.count;
  }

  private readHitBoxes(modelObject: ParticleModelObject, hitboxSetName: string, computeVolumes: boolean): void {
    const model = modelObject.model;
    const hitboxes = findHitboxSet(model, hitboxSetName);

    if (hitboxes === null || hitboxes.length === 0) {
      return;
    }

    const skeleton = model.skeleton;
    const transform = modelObject.transform;
    const boneTransforms = skeleton.bones.length > 0 ? this.posed(modelObject) : [];
    let totalVolume = this.totalVolume;

    for (let i = 0; i < hitboxes.length; i++) {
      const hitbox = hitboxes[i];
      const bone = skeleton.getBoneIndex(hitbox.boneName);
      const world = bone >= 0 && bone < boneTransforms.length ? boneTransforms[bone].multiply(transform) : transform;
      const { mins, maxs } = shapeBounds(hitbox);
      const volume = computeVolumes ? volumeOf(maxs.sub(mins)) : 1;

      this.current[i] = HitBox.fromTransform(world, mins, maxs, volume);
      totalVolume = f32(totalVolume + volume);
    }

    this.totalVolume = totalVolume;
    this.count = hitboxes.length;
  }

  private posed(modelObject: ParticleModelObject): Matrix4x4[] {
    const boneCount = modelObject.model.skeleton.bones.length;

    if (this.pose.length !== boneCount) {
      this.pose = new Array<Matrix4x4>(boneCount).fill(Matrix4x4.identity());
    }

    modelObject.getBonePose(this.pose);
    return this.pose;
  }

  /**
   * Picks a random point inside the boxes. Each of the tries plus one candidates draws a box and a
   * position in it, and with more than one try the candidate furthest along the direction bias
   * from `origin`, give or take a random amount, wins. Without boxes the point is `origin` in box 0.
   */
  randomPoint(systemState: ParticleSystemState, origin: Vector3, sampling: HitBoxSampling, haltonIndex: { value: number }): { position: Vector3; fraction: Vector3; index: number } {
    if (this.count === 0) {
      return { position: origin, fraction: Vector3.zero, index: 0 };
    }

    const random = systemState.random;
    const { low, high } = HitBox.scaledFractions(sampling.scale);
    const bias = sampling.directionBias;
    let tries = sampling.tries;

    if (HitBoxCache.hasDirectionBias(bias)) {
      tries = Math.max(tries, 5);
    }

    const first = sampling.desiredHitbox >= 0 ? Math.min(sampling.desiredHitbox, this.count - 1) : 0;
    const range = sampling.desiredHitbox >= 0 ? 1 : this.count;

    let best = f32(-1e20);
    let result = { position: origin, fraction: Vector3.zero, index: 0 };

    for (let candidate = 0; candidate <= Math.max(tries, 0); candidate++) {
      let index = first + Math.trunc(f32(range * random.next()));

      if (sampling.weightByVolume) {
        index = this.pickByVolume(f32(random.next() * this.totalVolume));
      }

      let fraction: Vector3;

      if (sampling.evenDistribution) {
        const sample = (random.seed + haltonIndex.value++) & 0x7fffffff;
        const halton = new Vector3(radicalInverse(sample, 2), radicalInverse(sample, 3), radicalInverse(sample, 5));
        fraction = lerpVV(low, high, halton);
      } else {
        fraction = random.nextBetweenPerComponentSeededTwice(low, high);
      }

      if (sampling.shellSize !== 1) {
        const axis = Math.min(Math.trunc(f32(random.next() * 3)), 2);
        const sign = Math.trunc(f32(random.next() * 2)) === 1 ? 1 : -1;
        const depth = f32(f32(f32(f32(sampling.scale.component(axis) * sampling.shellSize) * 0.5) * random.next()));
        const start = sign >= 0 ? low.component(axis) : high.component(axis);
        const value = f32(f32(depth * sign) + start);
        fraction = axis === 0 ? fraction.withX(value) : axis === 1 ? fraction.withY(value) : fraction.withZ(value);
      }

      const position = this.current[index].pointAt(fraction);
      const score = tries > 1 ? f32(dot(position.sub(origin), bias) + f32(random.next() * 72)) : FLOAT_MAX;

      if (score > best) {
        best = score;
        result = { position, fraction, index };
      }
    }

    return result;
  }

  private pickByVolume(remaining: number): number {
    for (let i = 0; i < this.count; i++) {
      remaining = f32(remaining - this.current[i].volume);

      if (remaining <= 0) {
        return i;
      }
    }

    return this.count - 1;
  }

  /** Whether a direction bias is large enough for the picks to score their candidates along it. */
  static hasDirectionBias(bias: Vector3): boolean {
    return Math.abs(bias.x) >= f32(1e-4) || Math.abs(bias.y) >= f32(1e-4) || Math.abs(bias.z) >= f32(1e-4);
  }

  /** Whether `point` lies inside any box, or with `boundBox` inside the world aligned box around all of them. */
  contains(point: Vector3, boundBox: boolean): boolean {
    if (this.boundsTime !== this.updateTime) {
      this.boundsTime = this.updateTime;
      let min = Vector3.splat(FLOAT_MAX);
      let max = Vector3.splat(FLOAT_MIN);

      for (const box of this.currentBoxes) {
        for (let corner = 0; corner < 8; corner++) {
          const local = new Vector3(
            (corner & 1) !== 0 ? box.maxs.x : box.mins.x,
            (corner & 2) !== 0 ? box.maxs.y : box.mins.y,
            (corner & 4) !== 0 ? box.maxs.z : box.mins.z,
          );
          const world = box.transformPoint(local);
          min = minV(min, world);
          max = maxV(max, world);
        }
      }

      this.bounds = { min, max };
    }

    const inBounds = aabbContains(this.bounds.min, this.bounds.max, point);

    if (boundBox || !inBounds) {
      return inBounds;
    }

    for (const box of this.currentBoxes) {
      if (aabbContains(box.mins, box.maxs, box.inverseTransformPoint(point))) {
        return true;
      }
    }

    return false;
  }

  /**
   * The box nearest to `point`, or only `desiredHitbox` when it is not negative, and a place in it
   * as a fraction of the box's extent per axis.
   */
  closest(systemState: ParticleSystemState, point: Vector3, desiredHitbox: number, scale: Vector3, closestPoint: boolean, testType: number, hybridRatio: number): { fraction: Vector3; index: number } {
    if (this.count === 0) {
      return { fraction: Vector3.zero, index: 0 };
    }

    const first = desiredHitbox >= 0 ? Math.min(desiredHitbox, this.count - 1) : 0;
    const last = desiredHitbox >= 0 ? first : this.count - 1;
    const { low, high } = HitBox.scaledFractions(scale);
    const random = systemState.random;

    let bestDistance = FLOAT_MAX;

    // When every box is passed over, the particle should keep the box and fraction of the particle before it
    let result = { fraction: Vector3.zero, index: 0 };

    for (let i = first; i <= last; i++) {
      const box = this.current[i];

      if (!closestPoint) {
        const boxDistance = distanceSquared(point, box.position);

        if (boxDistance >= bestDistance) {
          continue;
        }

        bestDistance = boxDistance;
        result = { fraction: random.nextBetweenPerComponent(low, high), index: i };
        continue;
      }

      const local = box.inverseTransformPoint(point);
      const nearest = testType === ClosestPointTestType.PARTICLE_CLOSEST_TYPE_BOX
        ? clampV(local, box.mins, box.maxs)
        : testType === ClosestPointTestType.PARTICLE_CLOSEST_TYPE_CAPSULE
          ? closestPointOnCapsule(box.mins, box.maxs, local)
          : lerpV(closestPointOnCapsule(box.mins, box.maxs, local), clampV(local, box.mins, box.maxs), hybridRatio);
      const nearestDistance = distanceSquared(local, nearest);
      const size = box.maxs.sub(box.mins);

      if (nearestDistance >= bestDistance || size.equals(Vector3.zero)) {
        continue;
      }

      const fraction = new Vector3(
        size.x !== 0 ? f32(f32(nearest.x - box.mins.x) / size.x) : 0.5,
        size.y !== 0 ? f32(f32(nearest.y - box.mins.y) / size.y) : 0.5,
        size.z !== 0 ? f32(f32(nearest.z - box.mins.z) / size.z) : 0.5,
      );

      bestDistance = nearestDistance;
      result = { fraction: fraction.sub(Vector3.splat(0.5)).mul(scale).add(Vector3.splat(0.5)), index: i };
    }

    return result;
  }

  /**
   * The velocity of box `index` between the refresh before and the last one, or null when the box
   * was not there both times or no time passed between them.
   */
  boxVelocity(index: number): Vector3 | null {
    const interval = f32(this.updateTime - this.previousUpdateTime);

    if (index < 0 || index >= this.count || index >= this.previousCount || this.previousUpdateTime === -1 || interval <= 0) {
      return null;
    }

    return this.current[index].position.sub(this.previous[index].position).div(interval);
  }

  /** The inverse of every bone's bind pose in model space, for the model the boxes were read from. */
  get inverseBindPose(): readonly Matrix4x4[] {
    const model = this.object?.model ?? null;

    if (model === null) {
      return [];
    }

    if (this.inverseBindPoseModel !== model) {
      this.inverseBindPoseModel = model;
      this.inverseBindPoseValue = model.inverseBindPose;
    }

    return this.inverseBindPoseValue;
  }

  /**
   * The linear blend skinning transform of a particle bound to up to four bones of the boxes read
   * as bones: each valid bone's bind pose inverse followed by its box transform, weighted by
   * `weights` and the remainder of 1 for the fourth. A bone is valid when it is not 0xFFFF and both
   * this and, with `computePrevious`, the refresh before hold it. A single valid bone is taken whole.
   * Null when no bone was valid.
   */
  computeSkinningMatrix(boneIndices: bigint, weights: Vector3, computePrevious: boolean): { skin: Matrix4x4; previousSkin: Matrix4x4 } | null {
    const inverseBind = this.inverseBindPose;
    const lastWeight = saturate(f32(f32(f32(1 - weights.x) - weights.y) - weights.z));
    const allWeights = [weights.x, weights.y, weights.z, lastWeight];
    const valid: number[] = [];
    const validWeights: number[] = [];

    for (let k = 0; k < PACKED_BONE_COUNT; k++) {
      const bone = getPackedBone(boneIndices, k);

      if (bone === PACKED_BONE_NONE || bone >= this.count || (computePrevious && bone >= this.previousCount) || bone >= inverseBind.length) {
        continue;
      }

      valid.push(bone);
      validWeights.push(allWeights[k]);
    }

    if (valid.length === 0) {
      return null;
    }

    return {
      skin: blend(this.current, inverseBind, valid, validWeights),
      previousSkin: computePrevious ? blend(this.previous, inverseBind, valid, validWeights) : Matrix4x4.identity(),
    };
  }
}

function blend(boxes: HitBox[], inverseBind: readonly Matrix4x4[], bones: number[], weights: number[]): Matrix4x4 {
  if (bones.length === 1) {
    return inverseBind[bones[0]].multiply(boxes[bones[0]].matrix);
  }

  let result = new Matrix4x4(new Float32Array(16));

  for (let i = 0; i < bones.length; i++) {
    result = addMatrices(result, scaleMatrix(inverseBind[bones[i]].multiply(boxes[bones[i]].matrix), weights[i]));
  }

  result.m[3] = 0;
  result.m[7] = 0;
  result.m[11] = 0;
  result.m[15] = 1;
  return result;
}

function findHitboxSet(model: ParticleModel, name: string): readonly ParticleHitbox[] | null {
  let fallback: readonly ParticleHitbox[] | null = null;
  const lower = name.toLowerCase();

  for (const [setName, hitboxes] of model.hitboxSets) {
    if (setName.toLowerCase() === lower) {
      return hitboxes;
    }

    if (fallback === null && setName.toLowerCase() === DEFAULT_HITBOX_SET) {
      fallback = hitboxes;
    }
  }

  return fallback;
}

function shapeBounds(hitbox: ParticleHitbox): { mins: Vector3; maxs: Vector3 } {
  const radius = Vector3.splat(hitbox.shapeRadius);

  switch (hitbox.shapeType) {
    case HitboxShape.Sphere:
      return { mins: hitbox.minBounds.sub(radius), maxs: hitbox.minBounds.add(radius) };
    case HitboxShape.Capsule:
      return { mins: minV(hitbox.minBounds, hitbox.maxBounds).sub(radius), maxs: maxV(hitbox.minBounds, hitbox.maxBounds).add(radius) };
    default:
      return { mins: hitbox.minBounds, maxs: hitbox.maxBounds };
  }
}

function volumeOf(size: Vector3): number {
  return f32(f32(size.x * size.y) * size.z);
}

/** AABB.Contains: inclusive on every face. */
function aabbContains(min: Vector3, max: Vector3, point: Vector3): boolean {
  return point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y && point.z >= min.z && point.z <= max.z;
}

/** Vector3.Clamp: Min(Max(value, min), max). */
function clampV(value: Vector3, min: Vector3, max: Vector3): Vector3 {
  return minV(maxV(value, min), max);
}

function closestPointOnCapsule(mins: Vector3, maxs: Vector3, point: Vector3): Vector3 {
  const size = maxs.sub(mins);
  const radius = f32(f32(f32(size.x + size.y) + size.z) * 0.25);
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.x && size.y >= size.z ? 1 : 2;
  const offsetValue = f32(f32(size.component(axis) * 0.5) - radius);
  const offset = axis === 0 ? new Vector3(offsetValue, 0, 0) : axis === 1 ? new Vector3(0, offsetValue, 0) : new Vector3(0, 0, offsetValue);
  const center = mins.add(maxs).scale(0.5);
  const start = center.add(offset);
  const segment = center.sub(offset).sub(start);

  const along = dot(point.sub(start), segment);
  const lengthSquared = segment.lengthSquared();
  const onSegment = along <= 0 ? start
    : along <= lengthSquared ? start.add(segment.scale(f32(along / lengthSquared)))
      : start.add(segment);

  const pointDistance = distance(point, onSegment);

  return f32(radius + FLOAT_EPSILON) < pointDistance
    ? onSegment.add(point.sub(onSegment).scale(f32(radius / pointDistance)))
    : point;
}
