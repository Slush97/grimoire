// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Resource/ResourceTypes/ModelAnimation/Skeleton.cs,
// ValveResourceFormat/Resource/ResourceTypes/ModelAnimation/Bone.cs,
// ValveResourceFormat/Resource/ResourceTypes/ModelData/Hitbox.cs (and the hitbox sets of Mesh.cs),
// ValveResourceFormat/Particles/IParticleModelObject.cs and ValveResourceFormat/Particles/BindPoseModelObject.cs.
//
// The model a control point carries, as the model functions read it: its skeleton, its hitbox sets
// and its render bounds. The skeleton is read from the model's DATA block and the hitbox sets from
// its first mesh block (MDAT) that has any, both decoded from KV3 to JSON.

import { type KVObject, type KVValue, getArray, getString, getSubCollection, isCollection } from './kv';
import { Matrix4x4, Quaternion, Vector3, f32 } from './numerics';
import type { MeshTriangles } from './utils/meshTriangles';
import { stringToken } from './utils/stringToken';

export class ParticleBone {
  readonly index: number;
  readonly name: string;
  readonly position: Vector3;
  readonly angle: Quaternion;
  readonly bindPose: Matrix4x4;
  parent: ParticleBone | null = null;
  readonly children: ParticleBone[] = [];

  constructor(index: number, name: string, position: Vector3, rotation: Quaternion) {
    this.index = index;
    this.name = name;
    this.position = position;
    this.angle = rotation;
    this.bindPose = Matrix4x4.fromQuaternion(rotation).multiply(createTranslation(position));

    if (this.bindPose.invert() === null) {
      throw new Error('Matrix invert failed');
    }
  }

  setParent(parent: ParticleBone): void {
    if (!this.children.includes(parent)) {
      this.parent = parent;
      parent.children.push(this);
    }
  }
}

export class ParticleSkeleton {
  readonly name: string;
  readonly bones: readonly ParticleBone[];
  readonly roots: readonly ParticleBone[];
  private readonly boneHashToIndex = new Map<number, number>();

  constructor(name: string, bones: ParticleBone[], parents: readonly number[]) {
    this.name = name;
    this.bones = bones;
    const roots: ParticleBone[] = [];

    for (const bone of bones) {
      const parentId = parents[bone.index];

      if (parentId !== -1) {
        bone.setParent(bones[parentId]);
        continue;
      }

      roots.push(bone);
    }

    this.roots = roots;

    // A later bone of the same name wins
    for (let i = 0; i < bones.length; i++) {
      this.boneHashToIndex.set(stringToken(bones[i].name), i);
    }
  }

  /** Skeleton.FromModelData: the skeleton of a model's DATA block. */
  static fromModelData(modelData: KVObject): ParticleSkeleton {
    const skeletonData = getSubCollection(modelData, 'm_modelSkeleton') ?? {};
    const names = (getArray(skeletonData, 'm_boneName') ?? []).map((value) => String(value));
    const parents = (getArray(skeletonData, 'm_nParent') ?? []).map((value) => Number(value));
    const positions = (getArray(skeletonData, 'm_bonePosParent') ?? []).map(toVector3);
    const rotations = (getArray(skeletonData, 'm_boneRotParent') ?? []).map(toQuaternion);
    const bones = names.map((name, i) => new ParticleBone(i, name, positions[i], rotations[i]));
    return new ParticleSkeleton(getString(modelData, 'm_name') ?? '', bones, parents);
  }

  /** The index of the bone named `name`, ignoring ASCII case, or -1. */
  getBoneIndex(name: string): number {
    return this.boneHashToIndex.get(stringToken(name)) ?? -1;
  }

  /** Skeleton.ComputeWorldSubtree with no frame: each bone's bind pose carried down from `parentWorld`. */
  static computeWorldSubtree(bone: ParticleBone, parentWorld: Matrix4x4, world: Matrix4x4[]): void {
    world[bone.index] = bone.bindPose.multiply(parentWorld);

    for (const child of bone.children) {
      ParticleSkeleton.computeWorldSubtree(child, world[bone.index], world);
    }
  }
}

export const HitboxShape = {
  Box: 0,
  Sphere: 1,
  Capsule: 2,
} as const;

export type HitboxShape = (typeof HitboxShape)[keyof typeof HitboxShape];

/** A hitbox of a model (CHitBox). */
export interface ParticleHitbox {
  readonly name: string;
  readonly boneName: string;
  readonly minBounds: Vector3;
  readonly maxBounds: Vector3;
  readonly shapeRadius: number;
  readonly shapeType: HitboxShape;
}

/** Hitbox(KVObject): a hitbox's shape follows m_nShapeType, a box when it is absent. */
export function parseHitbox(data: KVObject): ParticleHitbox {
  return {
    name: getString(data, 'm_name') ?? '',
    boneName: getString(data, 'm_sBoneName') ?? '',
    minBounds: toVector3(data.m_vMinBounds ?? null),
    maxBounds: toVector3(data.m_vMaxBounds ?? null),
    shapeRadius: f32(Number(data.m_flShapeRadius ?? 0)),
    shapeType: Number(data.m_nShapeType ?? 0) as HitboxShape,
  };
}

/** Mesh.Read: the hitbox sets of one mesh block, in order. */
export function parseHitboxSets(meshData: KVObject): [string, ParticleHitbox[]][] {
  const sets: [string, ParticleHitbox[]][] = [];

  for (const entry of getArray(meshData, 'm_hitboxsets') ?? []) {
    if (!isCollection(entry)) {
      continue;
    }

    const hitboxSet = isCollection(entry.value ?? null) ? (entry.value as KVObject) : entry;
    const setName = getString(hitboxSet, 'm_name') ?? '';
    const key = 'm_HitBoxes' in hitboxSet ? 'm_HitBoxes' : 'm_hitboxes';
    sets.push([setName, (getArray(hitboxSet, key) ?? []).filter(isCollection).map(parseHitbox)]);
  }

  return sets;
}

/** A model as JSON: its skeleton in bone order, hitbox sets in stored order and render bounds. */
export interface SerializedParticleModel {
  name: string;
  bones: { name: string; parent: number; position: readonly number[]; rotation: readonly number[] }[];
  hitboxSets: { name: string; hitboxes: { name: string; boneName: string; min: readonly number[]; max: readonly number[]; radius: number; shape: number }[] }[];
  bounds: { min: readonly number[]; max: readonly number[] };
}

/** An axis aligned box. */
export interface ModelBounds {
  readonly min: Vector3;
  readonly max: Vector3;
}

/** A model as the particle model functions read it. */
export class ParticleModel {
  readonly name: string;
  readonly skeleton: ParticleSkeleton;
  /** The hitbox sets in their stored order, matched by name ignoring case. */
  readonly hitboxSets: readonly [string, readonly ParticleHitbox[]][];
  /** ModelElements.Bounds: the box around the most detailed render meshes, in model space. */
  readonly bounds: ModelBounds;
  /** The render mesh triangles C_INIT_CreateOnModel's m_bUseMesh reads, or null when the host has none. */
  meshTriangles: MeshTriangles | null = null;
  private inverseBindPoseCache: Matrix4x4[] | null = null;

  constructor(name: string, skeleton: ParticleSkeleton, hitboxSets: [string, ParticleHitbox[]][], bounds: ModelBounds) {
    this.name = name;
    this.skeleton = skeleton;
    this.hitboxSets = hitboxSets;
    this.bounds = bounds;
  }

  /**
   * A model from its decoded DATA block and the meshes that can supply its hitbox sets: its first
   * embedded mesh block (MDAT), which Model.Read always takes, then the meshes it references in
   * order, each of which SetExternalMeshData takes only while the model still has none.
   */
  static fromModelData(modelData: KVObject, meshBlocks: readonly KVObject[], bounds: ModelBounds): ParticleModel {
    let hitboxSets: [string, ParticleHitbox[]][] = [];

    for (const mesh of meshBlocks) {
      if (hitboxSets.length === 0) {
        hitboxSets = parseHitboxSets(mesh);
      }
    }

    return new ParticleModel(getString(modelData, 'm_name') ?? '', ParticleSkeleton.fromModelData(modelData), hitboxSets, bounds);
  }

  /** The model as the hero particle bundle (and the particle oracle) describes it. */
  serialize(): SerializedParticleModel {
    const vector = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];
    return {
      name: this.name,
      bones: this.skeleton.bones.map((bone) => ({
        name: bone.name,
        parent: bone.parent?.index ?? -1,
        position: vector(bone.position),
        rotation: [bone.angle.x, bone.angle.y, bone.angle.z, bone.angle.w],
      })),
      hitboxSets: this.hitboxSets.map(([name, hitboxes]) => ({
        name,
        hitboxes: hitboxes.map((hitbox) => ({
          name: hitbox.name,
          boneName: hitbox.boneName,
          min: vector(hitbox.minBounds),
          max: vector(hitbox.maxBounds),
          radius: hitbox.shapeRadius,
          shape: hitbox.shapeType,
        })),
      })),
      bounds: { min: vector(this.bounds.min), max: vector(this.bounds.max) },
    };
  }

  static deserialize(description: SerializedParticleModel): ParticleModel {
    const vector = (values: readonly number[]) => new Vector3(values[0], values[1], values[2]);
    const bones = description.bones.map((bone, i) =>
      new ParticleBone(i, bone.name, vector(bone.position), new Quaternion(bone.rotation[0], bone.rotation[1], bone.rotation[2], bone.rotation[3])));
    const skeleton = new ParticleSkeleton(description.name, bones, description.bones.map((bone) => bone.parent));
    const hitboxSets: [string, ParticleHitbox[]][] = description.hitboxSets.map((set) => [set.name, set.hitboxes.map((hitbox) => ({
      name: hitbox.name,
      boneName: hitbox.boneName,
      minBounds: vector(hitbox.min),
      maxBounds: vector(hitbox.max),
      shapeRadius: f32(hitbox.radius),
      shapeType: hitbox.shape as HitboxShape,
    }))]);
    return new ParticleModel(description.name, skeleton, hitboxSets, { min: vector(description.bounds.min), max: vector(description.bounds.max) });
  }

  /** BindPoseModelObject.GetBindPose: every bone's bind pose in model space, by bone index. */
  getBindPose(bones: Matrix4x4[]): void {
    for (const root of this.skeleton.roots) {
      ParticleSkeleton.computeWorldSubtree(root, Matrix4x4.identity(), bones);
    }
  }

  /** BindPoseModelObject.GetInverseBindPose. */
  get inverseBindPose(): readonly Matrix4x4[] {
    if (this.inverseBindPoseCache === null) {
      const bones = new Array<Matrix4x4>(this.skeleton.bones.length);
      this.getBindPose(bones);
      this.inverseBindPoseCache = bones.map((bone) => bone.invert() ?? bone);
    }

    return this.inverseBindPoseCache;
  }
}

/**
 * The object a control point is bound to when it carries a model (IParticleModelObject): where it
 * stands, how its skeleton is posed and which sequence it plays.
 */
export interface ParticleModelObject {
  readonly model: ParticleModel;
  /** Carries the model's space into the world, scale included. */
  readonly transform: Matrix4x4;
  /** Writes every bone of the skeleton in its current pose, in model space, by bone index. */
  getBonePose(bones: Matrix4x4[]): void;
  /** The index of the sequence the object plays, or -1. */
  readonly sequenceIndex: number;
  /** How fast the sequence plays, 1 at its authored speed. */
  readonly sequenceRate: number;
}

/** A model standing still in its bind pose (BindPoseModelObject). */
export class BindPoseModelObject implements ParticleModelObject {
  readonly model: ParticleModel;
  transform = Matrix4x4.identity();
  readonly sequenceIndex = -1;
  readonly sequenceRate = 1;

  constructor(model: ParticleModel) {
    this.model = model;
  }

  getBonePose(bones: Matrix4x4[]): void {
    this.model.getBindPose(bones);
  }
}

/** Matrix4x4.CreateTranslation. */
export function createTranslation(position: Vector3): Matrix4x4 {
  return new Matrix4x4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, position.x, position.y, position.z, 1]);
}

function element(value: KVValue, index: number): number {
  return Array.isArray(value) ? Number(value[index] ?? 0) : 0;
}

/** KVObject.ToVector3 over a JSON array. */
function toVector3(value: KVValue): Vector3 {
  return new Vector3(element(value, 0), element(value, 1), element(value, 2));
}

/** KVObject.ToQuaternion over a JSON array. */
function toQuaternion(value: KVValue): Quaternion {
  return new Quaternion(element(value, 0), element(value, 1), element(value, 2), element(value, 3));
}
