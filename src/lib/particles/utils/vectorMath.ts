// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetVec.cs, System.Numerics calls.
// Euler matrix composition: ValveResourceFormat/Resource/ResourceTypes/EntityTransformHelper.cs.
// .NET 10 System.Numerics implementations are MIT, dotnet/runtime v10.0.0.

import { Matrix4x4, Quaternion, Vector3, degreesToRadians, radiansToDegrees, f32, fmaF, floatLerp } from '../numerics';

/** System.Numerics.Vector3.Lerp, using the same fused component operation as float.Lerp. */
export function vectorLerp(from: Vector3, to: Vector3, amount: number): Vector3 {
  return new Vector3(floatLerp(from.x, to.x, amount), floatLerp(from.y, to.y, amount), floatLerp(from.z, to.z, amount));
}

/** EntityTransformHelper.EulerAnglesToRotationMatrix, composed in roll, pitch, yaw order. */
export function eulerAnglesToRotationMatrix(pitchYawRoll: Vector3): Matrix4x4 {
  const pitch = degreesToRadians(pitchYawRoll.x);
  const yaw = degreesToRadians(pitchYawRoll.y);
  const roll = degreesToRadians(pitchYawRoll.z);
  const sr = f32(Math.sin(roll));
  const cr = f32(Math.cos(roll));
  const sp = f32(Math.sin(pitch));
  const cp = f32(Math.cos(pitch));
  const sy = f32(Math.sin(yaw));
  const cy = f32(Math.cos(yaw));
  const rollMatrix = new Matrix4x4([1, 0, 0, 0, 0, cr, sr, 0, 0, -sr, cr, 0, 0, 0, 0, 1]);
  const pitchMatrix = new Matrix4x4([cp, 0, -sp, 0, 0, 1, 0, 0, sp, 0, cp, 0, 0, 0, 0, 1]);
  const yawMatrix = new Matrix4x4([cy, sy, 0, 0, -sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return rollMatrix.multiply(pitchMatrix).multiply(yawMatrix);
}

/** .NET 10 Matrix4x4.CreateFromAxisAngle constructs a quaternion, then its matrix. */
export function createFromAxisAngle(axis: Vector3, angle: number): Matrix4x4 {
  const halfAngle = f32(angle * 0.5);
  const sin = f32(Math.sin(halfAngle));
  const cos = f32(Math.cos(halfAngle));
  return Matrix4x4.fromQuaternion(new Quaternion(f32(axis.x * sin), f32(axis.y * sin), f32(axis.z * sin), cos));
}

/** .NET 10 Quaternion.op_Multiply, with each signed product accumulated in shuffle order. */
export function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return new Quaternion(
    f32(f32(f32(f32(b.x * a.w) + f32(b.w * a.x)) + f32(b.z * a.y)) - f32(b.y * a.z)),
    f32(f32(f32(f32(b.y * a.w) - f32(b.z * a.x)) + f32(b.w * a.y)) + f32(b.x * a.z)),
    f32(f32(f32(f32(b.z * a.w) + f32(b.y * a.x)) - f32(b.x * a.y)) + f32(b.w * a.z)),
    f32(f32(f32(f32(b.w * a.w) - f32(b.x * a.x)) - f32(b.y * a.y)) - f32(b.z * a.z)),
  );
}

/** .NET 10 Vector3.Transform(value, quaternion), through Vector4 with W = 1. */
export function transformQuaternion(v: Vector3, q: Quaternion): Vector3 {
  const conjugate = new Quaternion(-q.x, -q.y, -q.z, q.w);
  const temp = quaternionMultiply(new Quaternion(v.x, v.y, v.z, 1), conjugate);
  const result = quaternionMultiply(q, temp);
  return new Vector3(result.x, result.y, result.z);
}

/** EntityTransformHelper.ToEulerAngles, in degrees with Source pitch/yaw/roll ordering. */
export function quaternionToEulerAngles(q: Quaternion): Vector3 {
  const forwardX = f32(1 - f32(2 * f32(f32(q.y * q.y) + f32(q.z * q.z))));
  const forwardY = f32(2 * f32(f32(q.x * q.y) + f32(q.w * q.z)));
  const forwardZ = f32(2 * f32(f32(q.x * q.z) - f32(q.w * q.y)));
  const xyDist = f32(Math.sqrt(f32(f32(forwardX * forwardX) + f32(forwardY * forwardY))));
  const pitch = f32(Math.atan2(-forwardZ, xyDist));
  let yaw: number;
  let roll: number;
  if (xyDist > f32(0.001)) {
    const leftZ = f32(2 * f32(f32(q.y * q.z) + f32(q.w * q.x)));
    const upZ = f32(1 - f32(2 * f32(f32(q.x * q.x) + f32(q.y * q.y))));
    yaw = f32(Math.atan2(forwardY, forwardX));
    roll = f32(Math.atan2(leftZ, upZ));
  } else {
    const leftX = f32(2 * f32(f32(q.x * q.y) - f32(q.w * q.z)));
    const leftY = f32(1 - f32(2 * f32(f32(q.x * q.x) + f32(q.z * q.z))));
    yaw = f32(Math.atan2(-leftX, leftY));
    roll = 0;
  }
  return new Vector3(radiansToDegrees(pitch), radiansToDegrees(yaw), radiansToDegrees(roll));
}

/** .NET 10 Vector3.Reflect. */
export function reflect(vector: Vector3, normal: Vector3): Vector3 {
  const dot = vector.dot(normal);
  const twice = f32(dot + dot);
  return new Vector3(fmaF(-twice, normal.x, vector.x), fmaF(-twice, normal.y, vector.y), fmaF(-twice, normal.z, vector.z));
}

/** System.Numerics.Matrix4x4.Transpose. */
export function transpose(matrix: Matrix4x4): Matrix4x4 {
  const m = matrix.m;
  return new Matrix4x4([m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]]);
}
