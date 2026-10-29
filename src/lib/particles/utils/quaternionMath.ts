// System.Numerics quaternion operations the model functions use, as .NET 10 evaluates them (MIT,
// dotnet/runtime v10.0.0), and MathUtils.ClampLength and TriangleCross from
// ValveResourceFormat/Utils/MathUtils.cs (MIT).

import { Quaternion, Vector3, cross, f32 } from '../numerics';

/** Quaternion.Conjugate: the vector part negated. */
export function quaternionConjugate(q: Quaternion): Quaternion {
  return new Quaternion(-q.x, -q.y, -q.z, q.w);
}

/** Quaternion.LengthSquared: Vector128.Dot with itself. */
export function quaternionLengthSquared(q: Quaternion): number {
  return Quaternion.dot(q, q);
}

/** Quaternion.Normalize: every lane divided by the length. */
export function quaternionNormalize(q: Quaternion): Quaternion {
  const length = f32(Math.sqrt(quaternionLengthSquared(q)));
  return new Quaternion(q.x / length, q.y / length, q.z / length, q.w / length);
}

/** Quaternion.Inverse: the conjugate divided by the squared length. */
export function quaternionInverse(q: Quaternion): Quaternion {
  const lengthSquared = quaternionLengthSquared(q);
  return new Quaternion(-q.x / lengthSquared, -q.y / lengthSquared, -q.z / lengthSquared, q.w / lengthSquared);
}

/** MathUtils.ClampLength: scaled down to `maxLength` when longer. */
export function clampLength(value: Vector3, maxLength: number): Vector3 {
  const lengthSquared = value.lengthSquared();
  return lengthSquared > f32(maxLength * maxLength) ? value.scale(f32(maxLength / f32(Math.sqrt(lengthSquared)))) : value;
}

/** MathUtils.TriangleCross: the cross product of the two edges leaving `a`. */
export function triangleCross(a: Vector3, b: Vector3, c: Vector3): Vector3 {
  return cross(b.sub(a), c.sub(a));
}
