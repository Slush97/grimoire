// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/SkinnedSnapshot.cs and
// ValveResourceFormat/Particles/Utils/ModelInput.cs.
//
// A control point snapshot whose points are skinned to bones by name, such as one taken off a
// model's surface, read by the functions that deform it with the bones of a control point's model.

import { ParticleField, ParticleModelType } from '../enums';
import { getSubCollection, isCollection } from '../kv';
import type { ParticleModel } from '../model';
import { Vector3, f32, toInt } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { PACKED_BONE_COUNT, PACKED_BONE_NONE, PACKED_BONES_ALL_NONE, packBone } from './packedBones';
import { SnapshotBinding, type SnapshotSkinning, getSnapshotAttributeName } from './snapshotBinding';

/** The columns of the bound snapshot a skinned read uses. */
export class SkinnedColumns {
  /** How many points the snapshot holds. */
  readonly count: number;
  /** Each point's rest position, in the model's space, as x, y, z. */
  readonly positions: Float32Array;
  /** Each point's bones and weights, or null when the points name one hitbox each instead. */
  readonly skinning: readonly SnapshotSkinning[] | null;
  /** Each point's one bone, taken whole, read when there is no skinning. */
  readonly hitboxes: readonly string[] | null;
  readonly normals: Float32Array | null;
  readonly radii: Float32Array | null;
  readonly colors: Float32Array | null;
  readonly alphas: Float32Array | null;

  constructor(count: number, positions: Float32Array, skinning: readonly SnapshotSkinning[] | null, hitboxes: readonly string[] | null,
    normals: Float32Array | null, radii: Float32Array | null, colors: Float32Array | null, alphas: Float32Array | null) {
    this.count = count;
    this.positions = positions;
    this.skinning = skinning;
    this.hitboxes = hitboxes;
    this.normals = normals;
    this.radii = radii;
    this.colors = colors;
    this.alphas = alphas;
  }

  position(row: number): Vector3 {
    return vectorAt(this.positions, row);
  }

  normal(row: number): Vector3 {
    return vectorAt(this.normals!, row);
  }

  color(row: number): Vector3 {
    return vectorAt(this.colors!, row);
  }

  /**
   * The four bones of point `row` as indices into the boxes of a bone cache: each named bone's index
   * in `model`'s skeleton, 0 when it has none, wrapped to `boneCount`. A point naming one hitbox
   * leaves the other three slots unused, and every slot is unused when there are no bones.
   */
  boneIndices(row: number, model: ParticleModel, boneCount: number): bigint {
    if (boneCount <= 0) {
      return PACKED_BONES_ALL_NONE;
    }

    if (this.skinning === null) {
      return packBone(boneIndex(this.hitboxes![row], model, boneCount), 0)
        | packBone(PACKED_BONE_NONE, 1) | packBone(PACKED_BONE_NONE, 2) | packBone(PACKED_BONE_NONE, 3);
    }

    let indices = 0n;
    const jointNames = this.skinning[row].jointNames;

    for (let k = 0; k < PACKED_BONE_COUNT; k++) {
      indices |= packBone(boneIndex(jointNames[k], model, boneCount), k);
    }

    return indices;
  }

  /** The weights of the first three bones of point `row`. */
  boneWeights(row: number): Vector3 {
    if (this.skinning === null) {
      return Vector3.unitX;
    }

    const weights = this.skinning[row].weights;
    return new Vector3(weights[0], weights[1], weights[2]);
  }
}

function vectorAt(values: Float32Array, row: number): Vector3 {
  return new Vector3(values[row * 3], values[row * 3 + 1], values[row * 3 + 2]);
}

function boneIndex(name: string, model: ParticleModel, boneCount: number): number {
  return Math.max(model.skeleton.getBoneIndex(name), 0) % boneCount;
}

export class SkinnedSnapshot {
  private readonly binding: SnapshotBinding;

  constructor(parse: ParticleDefinitionParser) {
    this.binding = new SnapshotBinding(parse, 'm_nSnapshotControlPointNumber', 1, true);
  }

  /**
   * The bound snapshot's columns, or null when nothing is bound, the snapshot is empty, or it lacks
   * positions or both skinning and hitbox names.
   */
  resolve(state: ParticleSystemState): SkinnedColumns | null {
    const snapshot = this.binding.resolve(state);

    if (snapshot === null || snapshot.numParticles <= 0) {
      return null;
    }

    let positions: Float32Array | null = null;
    let skinning: readonly SnapshotSkinning[] | null = null;
    let hitboxes: readonly string[] | null = null;
    let normals: Float32Array | null = null;
    let radii: Float32Array | null = null;
    let colors: Float32Array | null = null;
    let alphas: Float32Array | null = null;

    for (const { name, data } of snapshot.columns ?? []) {
      switch (data.kind) {
        case 'skinning':
          skinning = data.values;
          break;
        case 'string':
          if (name === getSnapshotAttributeName(ParticleField.HitboxIndex)) {
            hitboxes = data.values;
          }
          break;
        case 'vector':
          if (name === getSnapshotAttributeName(ParticleField.Position)) {
            positions = data.values;
          } else if (name === getSnapshotAttributeName(ParticleField.Normal)) {
            normals = data.values;
          } else if (name === getSnapshotAttributeName(ParticleField.Color)) {
            colors = data.values;
          }
          break;
        case 'float':
          if (name === getSnapshotAttributeName(ParticleField.Radius)) {
            radii = data.values;
          } else if (name === getSnapshotAttributeName(ParticleField.Alpha)) {
            alphas = data.values;
          }
          break;
        default:
          break;
      }
    }

    const boneRows = skinning?.length ?? hitboxes?.length ?? null;

    if (positions === null || boneRows === null) {
      return null;
    }

    const count = Math.min(snapshot.numParticles, Math.min(positions.length / 3, boneRows));
    return count === 0 ? null : new SkinnedColumns(count, positions, skinning, hitboxes, normals, radii, colors, alphas);
  }

  /**
   * A point picked at random among `count`: a draw from the system's sequence, or with a
   * `randomSeed` other than 0 from a sequence of the function's own, which `counter` walks.
   */
  static randomRow(state: ParticleSystemState, count: number, randomSeed: number, counter: { value: number }): number {
    return toInt(f32(count * state.random.nextOrSeeded(randomSeed, counter)));
  }

  /** The point a walk at `index` reads: past the last point it wraps round, moved on by `fullLoopIncrement` per loop. */
  static walkRow(index: number, count: number, fullLoopIncrement: number): number {
    return index >= count ? (index + fullLoopIncrement * Math.trunc(index / count)) % count : index;
  }
}

/**
 * ModelInput.ControlPoint: the control point a function's m_modelInput reads, or -1 when it reads
 * a named value or nothing. A missing input reads control point 0.
 */
export function modelInputControlPoint(parse: ParticleDefinitionParser, key = 'm_modelInput'): number {
  const data = getSubCollection(parse.data, key);

  if (data === null || !isCollection(data)) {
    return 0;
  }

  const input = parse.nested(data);

  return input.enum('m_nType', ParticleModelType, ParticleModelType.PM_TYPE_CONTROL_POINT) === ParticleModelType.PM_TYPE_CONTROL_POINT
    ? input.controlPoint('m_nControlPoint')
    : -1;
}
