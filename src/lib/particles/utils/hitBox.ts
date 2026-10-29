// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/HitBox.cs and the
// matrix helpers it reads from ValveResourceFormat/Utils/MathUtils.cs.
//
// One box of a hit box cache: a model hitbox, or a bone, placed in the world.

import { Matrix4x4, Quaternion, Vector3, f32, maxF, safeNormalize } from '../numerics';
import { quaternionConjugate, quaternionNormalize } from './quaternionMath';
import { transformQuaternion } from './vectorMath';

export class HitBox {
  /** The box's low corner, in the space of its transform. */
  readonly mins: Vector3;
  /** The box's high corner, in the space of its transform. */
  readonly maxs: Vector3;
  /** The rotation of the transform. */
  readonly orientation: Quaternion;
  /** The world position of the transform. */
  readonly position: Vector3;
  /** The uniform scale of the transform. */
  readonly scale: number;
  /** The box's volume when the cache was asked to weigh boxes by volume, 1 otherwise. */
  readonly volume: number;

  constructor(mins: Vector3, maxs: Vector3, orientation: Quaternion, position: Vector3, scale: number, volume: number) {
    this.mins = mins;
    this.maxs = maxs;
    this.orientation = orientation;
    this.position = position;
    this.scale = scale;
    this.volume = volume;
  }

  /** Carries a point from the box's space into the world. */
  transformPoint(local: Vector3): Vector3 {
    return transformQuaternion(local, this.orientation).scale(this.scale).add(this.position);
  }

  /** The world position of the point at `fraction` of the box's extent per axis. */
  pointAt(fraction: Vector3): Vector3 {
    return this.transformPoint(this.maxs.sub(this.mins).mul(fraction).add(this.mins));
  }

  /** The low and high fractions of a box's extent that bound the part `scale` covers, centred on the box. */
  static scaledFractions(scale: Vector3): { low: Vector3; high: Vector3 } {
    const half = scale.scale(0.5);
    return { low: Vector3.splat(0.5).sub(half), high: Vector3.splat(0.5).add(half) };
  }

  /** Carries a world point into the box's space. */
  inverseTransformPoint(world: Vector3): Vector3 {
    return transformQuaternion(world.sub(this.position).div(this.scale), quaternionConjugate(this.orientation));
  }

  /** The transform as a matrix, scale included. */
  get matrix(): Matrix4x4 {
    const matrix = scaleMatrix(Matrix4x4.fromQuaternion(this.orientation), this.scale);
    matrix.m[15] = 1;
    return matrix.withTranslation(this.position);
  }

  /** Splits a transform into the rotation, position and largest axis scale a box keeps. */
  static fromTransform(transform: Matrix4x4, mins: Vector3, maxs: Vector3, volume: number): HitBox {
    const scale = maxAxisScale(transform);
    let rotation = transform.withTranslation(Vector3.zero);

    if (scale > 0) {
      rotation = normalizeRows(rotation);
    }

    const orientation = quaternionNormalize(Quaternion.fromRotationMatrix(rotation));
    return new HitBox(mins, maxs, orientation, transform.translation, scale, volume);
  }
}

function row(m: Matrix4x4, index: number): Vector3 {
  return new Vector3(m.m[index * 4], m.m[index * 4 + 1], m.m[index * 4 + 2]);
}

function normalizeRows(m: Matrix4x4): Matrix4x4 {
  const x = safeNormalize(row(m, 0));
  const y = safeNormalize(row(m, 1));
  const z = safeNormalize(row(m, 2));
  return new Matrix4x4([x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1]);
}

/** MathUtils.AxisScale: the length of one of a transform's basis rows. */
export function axisScale(m: Matrix4x4, axis: number): number {
  return row(m, axis <= 0 ? 0 : axis === 1 ? 1 : 2).length();
}

/** MathUtils.MaxAxisScale: the largest per-axis scale baked into a transform. */
export function maxAxisScale(m: Matrix4x4): number {
  return maxF(maxF(axisScale(m, 0), axisScale(m, 1)), axisScale(m, 2));
}

/** Matrix4x4 * float: every element scaled. */
export function scaleMatrix(m: Matrix4x4, value: number): Matrix4x4 {
  return new Matrix4x4(Array.from(m.m, (element) => f32(element * value)));
}

/** Matrix4x4 + Matrix4x4: element by element. */
export function addMatrices(a: Matrix4x4, b: Matrix4x4): Matrix4x4 {
  return new Matrix4x4(Array.from(a.m, (element, i) => f32(element + b.m[i])));
}
