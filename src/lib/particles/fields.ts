// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleFieldExtensions.cs and
// the field tables of ValveResourceFormat/Particles/ParticleBuffer.cs.

import { ParticleField, ParticleSetMethod } from './enums';
import { FLOAT_MAX, FLOAT_MIN, Vector3, clamp, f32 } from './numerics';

/** The number of ParticleField values, the size of the field tables. */
export const FIELD_COUNT = ParticleField.RopeSegmentData + 1;

/** The bit of the field in a ParticleField bit mask. Masks are bigints: there are more than 32 fields. */
export function fieldMask(field: number): bigint {
  return 1n << BigInt(field);
}

export function maskOf(fields: readonly number[]): bigint {
  let mask = 0n;
  for (const field of fields) {
    mask |= fieldMask(field);
  }
  return mask;
}

export function maskContains(mask: bigint, field: number): boolean {
  return field >= 0 && field < FIELD_COUNT && (mask & fieldMask(field)) !== 0n;
}

export const FLOAT_FIELDS: readonly number[] = [
  ParticleField.LifeDuration,
  ParticleField.Radius,
  ParticleField.Roll,
  ParticleField.RollSpeed,
  ParticleField.Alpha,
  ParticleField.CreationTime,
  ParticleField.SequenceNumber,
  ParticleField.TrailLength,
  ParticleField.Yaw,
  ParticleField.SecondSequenceNumber,
  ParticleField.AlphaAlternate,
  ParticleField.ScratchFloat,
  ParticleField.Pitch,
  ParticleField.GlowAlpha,
  ParticleField.ScratchFloat1,
  ParticleField.ScratchFloat2,
  ParticleField.ForceScale,
  ParticleField.ManualAnimationFrame,
  ParticleField.ShaderExtraData1,
  ParticleField.ShaderExtraData2,
];

export const INTEGER_FIELDS: readonly number[] = [
  ParticleField.ParticleId,
  ParticleField.HitboxIndex,
  ParticleField.ParentParticleIndex,
  ParticleField.BoxFlags,
  ParticleField.UserEventStates,
  ParticleField.ParentParticleId,
  ParticleField.RopeSegmentId,
];

export const SCALAR_FIELDS: readonly number[] = [...FLOAT_FIELDS, ...INTEGER_FIELDS];

export const VECTOR_FIELDS: readonly number[] = [
  ParticleField.Position,
  ParticleField.PositionPrevious,
  ParticleField.Color,
  ParticleField.HitboxOffsetPosition,
  ParticleField.ScratchVector,
  ParticleField.Normal,
  ParticleField.GlowRgb,
  ParticleField.ScratchVector2,
  ParticleField.BoneWeights,
  ParticleField.BoxMins,
  ParticleField.BoxMaxs,
  ParticleField.BoxAngles,
  ParticleField.RopeSegmentData,
];

const INTEGER_FIELD_MASK = maskOf(INTEGER_FIELDS);
const SCALAR_FIELD_MASK = maskOf(SCALAR_FIELDS);
const VECTOR_FIELD_MASK = maskOf(VECTOR_FIELDS);

/** The attributes that hold a value per particle: every field except the pointer fields. */
export const VALUE_FIELD_MASK = SCALAR_FIELD_MASK | VECTOR_FIELD_MASK | fieldMask(ParticleField.BoneIndices);

/** The fields renderers blend between two steps, besides the alpha2 field each renderer configures. */
export const BLENDED_FIELD_MASK = maskOf([
  ParticleField.Position,
  ParticleField.Radius,
  ParticleField.Roll,
  ParticleField.Color,
  ParticleField.Alpha,
  ParticleField.Yaw,
  ParticleField.Pitch,
]);

/** Whether the field is an integer attribute, stored as its bits in the scalar table. */
export function isIntegerField(field: number): boolean {
  return maskContains(INTEGER_FIELD_MASK, field);
}

/** ParticleBuffer.IsScalar: a float or integer attribute. */
export function isScalarField(field: number): boolean {
  return maskContains(SCALAR_FIELD_MASK, field);
}

/** ParticleBuffer.IsVector. */
export function isVectorField(field: number): boolean {
  return maskContains(VECTOR_FIELD_MASK, field);
}

/** Whether the field holds an angle, stored in radians while authored in degrees. RollSpeed counts. */
export function isAngleField(field: number): boolean {
  return field === ParticleField.Roll || field === ParticleField.Yaw || field === ParticleField.Pitch || field === ParticleField.RollSpeed;
}

/** Whether the field holds an orientation angle; the angular rate is excluded. */
export function isOrientationField(field: number): boolean {
  return field === ParticleField.Roll || field === ParticleField.Yaw || field === ParticleField.Pitch;
}

export function isNormalizedField(field: number): boolean {
  return (
    field === ParticleField.Color ||
    field === ParticleField.Alpha ||
    field === ParticleField.AlphaAlternate ||
    field === ParticleField.GlowRgb ||
    field === ParticleField.GlowAlpha
  );
}

export function isAlphaField(field: number): boolean {
  return field === ParticleField.Alpha || field === ParticleField.AlphaAlternate;
}

/** The range the float set operators hold a written value inside. */
export function setFloatRange(field: number): [number, number] {
  if (field === ParticleField.Alpha || field === ParticleField.AlphaAlternate) {
    return [0, 1];
  }
  if (field === ParticleField.Radius || field === ParticleField.TrailLength) {
    return [0, FLOAT_MAX];
  }
  return [FLOAT_MIN, FLOAT_MAX];
}

/** Whether the set method combines the value with the particle's initial value. */
export function readsInitialValue(setMethod: number): boolean {
  return setMethod === ParticleSetMethod.PARTICLE_SET_SCALE_INITIAL_VALUE || setMethod === ParticleSetMethod.PARTICLE_SET_ADD_TO_INITIAL_VALUE;
}

/** Combines `value` with a particle's initial and current values as `setMethod` says. */
export function applySetMethod(value: number, initialValue: number, currentValue: number, deltaTime: number, setMethod: number): number {
  switch (setMethod) {
    case ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE:
      return value;
    case ParticleSetMethod.PARTICLE_SET_SCALE_INITIAL_VALUE:
      return f32(value * initialValue);
    case ParticleSetMethod.PARTICLE_SET_ADD_TO_INITIAL_VALUE:
      return f32(value + initialValue);
    case ParticleSetMethod.PARTICLE_SET_SCALE_CURRENT_VALUE:
      return f32(value * currentValue);
    case ParticleSetMethod.PARTICLE_SET_ADD_TO_CURRENT_VALUE:
      return f32(value + currentValue);
    case ParticleSetMethod.PARTICLE_SET_RAMP_CURRENT_VALUE:
      return f32(currentValue + f32(value * deltaTime));
    default:
      throw new Error(`Unknown particle set type ${setMethod}`);
  }
}

/** applySetMethod for vectors. */
export function applySetMethodV(value: Vector3, initialValue: Vector3, currentValue: Vector3, deltaTime: number, setMethod: number): Vector3 {
  switch (setMethod) {
    case ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE:
      return value;
    case ParticleSetMethod.PARTICLE_SET_SCALE_INITIAL_VALUE:
      return value.mul(initialValue);
    case ParticleSetMethod.PARTICLE_SET_ADD_TO_INITIAL_VALUE:
      return value.add(initialValue);
    case ParticleSetMethod.PARTICLE_SET_SCALE_CURRENT_VALUE:
      return value.mul(currentValue);
    case ParticleSetMethod.PARTICLE_SET_ADD_TO_CURRENT_VALUE:
      return value.add(currentValue);
    case ParticleSetMethod.PARTICLE_SET_RAMP_CURRENT_VALUE:
      return currentValue.add(value.scale(deltaTime));
    default:
      throw new Error(`Unknown particle set type ${setMethod}`);
  }
}

/** applySetMethod over a column in place (the TensorPrimitives overload). */
export function applySetMethodColumn(
  values: Float32Array,
  initialValues: Float32Array,
  currentValues: Float32Array,
  deltaTime: number,
  setMethod: number,
): void {
  if (setMethod === ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE) {
    return;
  }

  for (let i = 0; i < values.length; i++) {
    switch (setMethod) {
      case ParticleSetMethod.PARTICLE_SET_SCALE_INITIAL_VALUE:
        values[i] = values[i] * initialValues[i];
        break;
      case ParticleSetMethod.PARTICLE_SET_ADD_TO_INITIAL_VALUE:
        values[i] = values[i] + initialValues[i];
        break;
      case ParticleSetMethod.PARTICLE_SET_SCALE_CURRENT_VALUE:
        values[i] = values[i] * currentValues[i];
        break;
      case ParticleSetMethod.PARTICLE_SET_ADD_TO_CURRENT_VALUE:
        values[i] = values[i] + currentValues[i];
        break;
      case ParticleSetMethod.PARTICLE_SET_RAMP_CURRENT_VALUE:
        // TensorPrimitives.MultiplyAdd rounds the product before the add
        values[i] = f32(values[i] * deltaTime) + currentValues[i];
        break;
      default:
        throw new Error(`Unknown particle set type ${setMethod}`);
    }
  }
}

/** Clamps a column in place (TensorPrimitives.Clamp). */
export function clampColumn(values: Float32Array, min: number, max: number): void {
  for (let i = 0; i < values.length; i++) {
    values[i] = clamp(values[i], min, max);
  }
}
