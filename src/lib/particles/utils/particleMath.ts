// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/ParticleMath.cs.

import { ParticleFloatBiasType } from '../enums';
import { PI, Vector3, clamp, cross, f32, floatLerp, maxV, minV, normalize, remap, roundHalfEven, saturate, toInt } from '../numerics';

/** Length below which a vector counts as having no direction. */
export const MINIMUM_LENGTH = f32(1e-6);

/** Squared length below which a vector is too short to normalise. */
export const MINIMUM_LENGTH_SQUARED = f32(1e-12);

/** FLT_EPSILON, added to a divisor so a zero-length span is a step rather than an infinity. */
export const FLOAT_EPSILON = f32(1.1920929e-7);

/** FLT_MIN, the smallest positive normal float. */
export const FLOAT_MIN_NORMAL = f32(1.17549435e-38);

/** The fade end time taken when none is set. */
export const NO_FADE_END = f32(1e20);

/** Clamps to [0, 1], with NaN giving 0. */
export function clampToUnit(value: number): number {
  return value >= 0 ? Math.min(value, 1) : 0;
}

/** The parabola `4t(1 - t)` over [0, 1]. */
export function halfWave(t: number): number {
  return f32(f32(4 - f32(4 * t)) * t);
}

export function square(value: number): number {
  return f32(value * value);
}

/** The heading of `direction` in the XY plane plus pi. */
export function heading(direction: Vector3): number {
  return f32(f32(Math.atan2(direction.y, direction.x)) + PI);
}

/** `exponent` clamped to [-255, 255] and truncated toward zero to a multiple of 0.25. */
export function truncateToQuarterSteps(exponent: number): number {
  return f32(toInt(f32(clamp(exponent, -255, 255) * 4)) * 0.25);
}

/** Raises `value` to `exponent` after truncateToQuarterSteps. */
export function powQuarterSteps(value: number, exponent: number): number {
  return f32(Math.pow(value, truncateToQuarterSteps(exponent)));
}

/** An approximation of sin(pi * x) built from halfWave, used by the oscillation operators. */
export function sinPi(x: number): number {
  const negative = x < 0 || Object.is(x, -0);
  const phase = f32(Math.abs(x) % 2);
  const secondHalf = phase >= 1;
  const value = halfWave(secondHalf ? f32(phase - 1) : phase);

  return negative !== secondHalf ? -value : value;
}

/** `age / lifetime`, taking a lifetime below 0.0001 as 0.0001. */
export function normalizedAge(age: number, lifetime: number): number {
  return f32(age / Math.max(f32(0.0001), lifetime));
}

/** The standard bias curve `x / ((1 - x) * (1/bias - 2) + 1)`. */
export function bias(x: number, biasValue: number): number {
  if (biasValue <= 0) {
    return 0;
  }

  if (biasValue >= 1) {
    return 1;
  }

  return f32(x / f32(f32(f32(1 - x) * f32(f32(1 / biasValue) - 2)) + 1));
}

/** The bias curve with `x` clamped to [0, 1] and `bias` to [FLT_MIN, 1]. */
export function biasClamped(x: number, biasValue: number): number {
  x = saturate(x);
  biasValue = clamp(biasValue, FLOAT_MIN_NORMAL, 1);

  return f32(x / f32(f32(f32(1 - x) * f32(f32(1 / biasValue) - 2)) + 1));
}

/** One of the ParticleFloatBiasType curves for an `m_flBiasParameter` in [-1, 1], the identity at 0. */
export function biasFromParameter(x: number, biasParameter: number, biasType: number): number {
  if (biasType === ParticleFloatBiasType.PF_BIAS_TYPE_EXPONENTIAL) {
    const exponent = biasParameter >= 0
      ? f32(1 - saturate(biasParameter))
      : f32(20 - f32(saturate(f32(biasParameter + 1)) * 19));

    if (exponent <= 0) {
      return 1;
    }

    if (x <= 0) {
      return 0;
    }

    if (x >= 1) {
      return 1;
    }

    return f32(Math.pow(x, Math.min(exponent, 20)));
  }

  if (biasType !== ParticleFloatBiasType.PF_BIAS_TYPE_STANDARD && biasType !== ParticleFloatBiasType.PF_BIAS_TYPE_GAIN) {
    return 0;
  }

  const biasValue = saturate(f32(f32(biasParameter + 1) * 0.5));

  if (biasValue <= 0) {
    return 0;
  }

  if (biasValue >= 1) {
    return 1;
  }

  if (biasType === ParticleFloatBiasType.PF_BIAS_TYPE_GAIN) {
    return x < 0.5
      ? f32(bias(f32(x + x), biasValue) * 0.5)
      : f32(1 - f32(bias(f32(f32(2 - x) - x), biasValue) * 0.5));
  }

  return bias(x, biasValue);
}

/** The left and up axes completing a frame around `forward`, with world up as the reference. */
export function vectorVectors(forward: Vector3): { left: Vector3; up: Vector3 } {
  if (Math.abs(forward.x) < f32(0.001) && Math.abs(forward.y) < f32(0.001)) {
    return { left: Vector3.unitY, up: new Vector3(-forward.z, 0, 0) };
  }

  const right = normalize(cross(forward, Vector3.unitZ));
  const up = normalize(cross(right, forward));

  return { left: right.negate(), up };
}

/** Normalizes with FLT_EPSILON added to the squared length. */
export function normalizeWithEpsilon(value: Vector3): Vector3 {
  return value.div(f32(Math.sqrt(f32(value.lengthSquared() + FLOAT_EPSILON))));
}

/** The tint a light colour gives, quantised to bytes and clamped between the byte tint colours. */
export function lightTint(light: Vector3, tintMin: Vector3, tintMax: Vector3, amplification: number): Vector3 {
  const lightBytes = new Vector3(lightToByte(light.x), lightToByte(light.y), lightToByte(light.z));
  const scaledMin = tintMin.scale(255);
  const scaledMax = tintMax.scale(255);
  const tintMinBytes = new Vector3(roundHalfEven(scaledMin.x), roundHalfEven(scaledMin.y), roundHalfEven(scaledMin.z));
  const tintMaxBytes = new Vector3(roundHalfEven(scaledMax.x), roundHalfEven(scaledMax.y), roundHalfEven(scaledMax.z));

  return maxV(minV(lightBytes, tintMaxBytes), tintMinBytes).scale(f32(amplification / 255));
}

function lightToByte(value: number): number {
  return Math.trunc(f32(clampToUnit(value) * 255));
}

/** Where `x` lies between `min` and `max` as a fraction clamped to [0, 1]. */
export function clampedFraction(x: number, min: number, max: number): number {
  return saturate(f32(f32(x - min) / (max === min ? 1 : f32(max - min))));
}

/** MathUtils.RemapValClamped, using float.Lerp and a threshold for a degenerate input range. */
export function remapClamped(x: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number): number {
  if (inputMin === inputMax) { return x >= inputMax ? outputMax : outputMin; }
  return floatLerp(outputMin, outputMax, saturate(remap(x, inputMin, inputMax)));
}
