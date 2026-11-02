// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/TransformOrientationMath.cs.

import { Quaternion, Vector3, degreesToRadians, eulerAnglesToQuaternion, f32 } from '../numerics';
import type { ParticleSystemState } from '../state';
import type { TransformProvider } from '../transformProviders';
import { quaternionMultiply, quaternionToEulerAngles, transformQuaternion } from './vectorMath';

export function computeOrientation(input: TransformProvider, state: ParticleSystemState, offset: Vector3, useQuat: boolean): {
  anglesRadians: Vector3;
  forward: Vector3;
} {
  const transform = input.nextTransform(state);
  const baseRotation = Quaternion.fromRotationMatrix(transform);
  const toRadians = (v: Vector3) => new Vector3(degreesToRadians(v.x), degreesToRadians(v.y), degreesToRadians(v.z));
  if (useQuat) {
    const rotation = eulerAnglesToQuaternion(new Vector3(offset.y, offset.z, offset.x));
    const final = quaternionMultiply(baseRotation, rotation);
    return { anglesRadians: toRadians(quaternionToEulerAngles(final)), forward: transformQuaternion(Vector3.unitX, final) };
  }
  const angles = quaternionToEulerAngles(baseRotation).add(offset);
  const pitch = degreesToRadians(angles.x);
  const yaw = degreesToRadians(angles.y);
  const cosPitch = f32(Math.cos(pitch));
  return { anglesRadians: toRadians(angles), forward: new Vector3(f32(cosPitch * f32(Math.cos(yaw))), f32(cosPitch * f32(Math.sin(yaw))), -f32(Math.sin(pitch))) };
}
