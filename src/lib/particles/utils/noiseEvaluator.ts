// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/NoiseEvaluator.cs.

import { ParticleNoiseModifier, ParticleNoiseTurbulence, ParticleNoiseType } from '../enums';
import { PI, Vector3, clamp, f32, fract, lerp, saturate, singleToInt32Bits, toInt } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import { curl3D, simplex3D, value3D, worley3D, worleyJitter } from './noise';

const OCTAVE_DIVISORS = new Float32Array([1, 1.5, 1.75, 1.875]);

const F_0_1 = f32(0.1);
const F_0_9 = f32(0.9);

/** Mirrors ParticleMath.HalfWave. */
function halfWave(t: number): number {
  return f32(f32(4 - f32(4 * t)) * t);
}

/** Mirrors ParticleMath.Square. */
function square(value: number): number {
  return f32(value * value);
}

/** MathF.CopySign: the magnitude of `magnitude` with the sign bit of `sign`. */
function copySign(magnitude: number, sign: number): number {
  return singleToInt32Bits(sign) < 0 ? -Math.abs(magnitude) : Math.abs(magnitude);
}

/** MathF.Sin. */
function sinF(x: number): number {
  return f32(Math.sin(x));
}

/**
 * The evaluation pipeline behind noise-typed particle inputs: an unweighted octave sum of the
 * selected primitive over a scaled coordinate, a turbulence resample, a shaping modifier, and
 * the output range. Turbulence overrides worley with fixed per-mode jitter and seed values, and
 * its alternate mode swaps a worley input to a simplex resample and every other input to a
 * worley resample. The octave sum is unweighted against amplitude-falloff divisors.
 */
export class NoiseEvaluator {
  private readonly outputMin: number = 0;
  private readonly outputMax: number = 1;
  private readonly noiseScale: number = F_0_1;
  private readonly offsetRate: Vector3 = Vector3.zero;
  private readonly noiseOffset: number = 0;
  private readonly octaves: number = 1;
  private readonly noiseType: number = ParticleNoiseType.PF_NOISE_TYPE_PERLIN;
  private readonly turbulence: number = ParticleNoiseTurbulence.PF_NOISE_TURB_NONE;
  private readonly modifier: number = ParticleNoiseModifier.PF_NOISE_MODIFIER_NONE;
  private readonly turbulenceScale: number = 1;
  private readonly turbulenceMix: number = 0.5;
  private readonly worleyJitter: number;

  constructor(parse: ParticleDefinitionParser) {
    this.outputMin = parse.float('m_flNoiseOutputMin', this.outputMin);
    this.outputMax = parse.float('m_flNoiseOutputMax', this.outputMax);
    this.noiseScale = parse.float('m_flNoiseScale', this.noiseScale);
    this.offsetRate = parse.vector3('m_vecNoiseOffsetRate', this.offsetRate);
    this.noiseOffset = parse.float('m_flNoiseOffset', this.noiseOffset);
    this.octaves = clamp(parse.int32('m_nNoiseOctaves', this.octaves), 1, 4);
    this.noiseType = parse.enum('m_nNoiseType', ParticleNoiseType, this.noiseType);
    this.turbulence = parse.enum('m_nNoiseTurbulence', ParticleNoiseTurbulence, this.turbulence);
    this.modifier = parse.enum('m_nNoiseModifier', ParticleNoiseModifier, this.modifier);
    this.turbulenceScale = parse.float('m_flNoiseTurbulenceScale', this.turbulenceScale);
    this.turbulenceMix = parse.float('m_flNoiseTurbulenceMix', this.turbulenceMix);
    this.worleyJitter = worleyJitter(this.noiseOffset);
  }

  /** Evaluates the pipeline at a sample vector and collection time, returning a value in the output range. */
  evaluate(input: Vector3, age: number): number {
    const coord = input
      .add(Vector3.one)
      .scale(f32(this.noiseScale * F_0_1))
      .add(this.offsetRate.scale(age).scale(F_0_1).add(Vector3.splat(this.noiseOffset)));

    let sum = 0;
    let frequency = 1;

    for (let i = 0; i < this.octaves; i++) {
      sum = f32(sum + this.sampleNoise(coord.scale(frequency), this.worleyJitter, this.noiseOffset));
      frequency = f32(frequency * 2);
    }

    const value = this.applyTurbulence(f32(sum / OCTAVE_DIVISORS[this.octaves - 1]), coord);

    return f32(f32(saturate(this.applyModifier(value)) * f32(this.outputMax - this.outputMin)) + this.outputMin);
  }

  private sampleNoise(coord: Vector3, jitter: number, seed: number): number {
    switch (this.noiseType) {
      case ParticleNoiseType.PF_NOISE_TYPE_SIMPLEX:
        return simplex3D(coord);
      case ParticleNoiseType.PF_NOISE_TYPE_WORLEY:
        return worley3D(coord, jitter, seed);
      case ParticleNoiseType.PF_NOISE_TYPE_CURL:
        return curl3D(coord).x;
      default:
        return value3D(coord);
    }
  }

  private applyTurbulence(value: number, coord: Vector3): number {
    if (this.turbulence === ParticleNoiseTurbulence.PF_NOISE_TURB_NONE) {
      return value;
    }

    const scaled = coord.scale(this.turbulenceScale);
    let target: number;

    switch (this.turbulence) {
      case ParticleNoiseTurbulence.PF_NOISE_TURB_HIGHLIGHT:
        target = f32(1 - f32(2 * Math.abs(this.sampleNoise(scaled.add(new Vector3(2.804, 1.98, 2.43)), F_0_9, 132))));
        break;
      case ParticleNoiseTurbulence.PF_NOISE_TURB_FEEDBACK:
        target = this.sampleNoise(scaled.add(new Vector3(1.804, 2.98, 1.43).scale(value)), F_0_9, 324);
        break;
      case ParticleNoiseTurbulence.PF_NOISE_TURB_LOOPY: {
        const magnitude = Math.abs(value);
        const triangle = halfWave(fract(magnitude));
        let wave = copySign(triangle, value);

        if ((toInt(magnitude) & 1) === 1) {
          wave = -wave;
        }

        target = this.sampleNoise(scaled.add(new Vector3(1.244, -1.15, 2.37).scale(wave)), F_0_9, 132);
        break;
      }
      case ParticleNoiseTurbulence.PF_NOISE_TURB_CONTRAST:
        target = clamp(
          f32(2 * this.sampleNoise(scaled.add(new Vector3(2.93, 2.734, 2.13).scale(f32(2 - value))), F_0_9, 132)),
          -1,
          1,
        );
        break;
      case ParticleNoiseTurbulence.PF_NOISE_TURB_ALTERNATE: {
        const warped = scaled.add(new Vector3(3.393, 3.734, 3.313).scale(value));
        const resampled =
          this.noiseType === ParticleNoiseType.PF_NOISE_TYPE_WORLEY
            ? simplex3D(warped)
            : worley3D(warped, f32(0.97), 22);

        target = f32(value * resampled);
        break;
      }
      default:
        return value;
    }

    return lerp(value, target, this.turbulenceMix);
  }

  private applyModifier(value: number): number {
    switch (this.modifier) {
      case ParticleNoiseModifier.PF_NOISE_MODIFIER_NONE:
        return f32(f32(value * 0.5) + 0.5);
      case ParticleNoiseModifier.PF_NOISE_MODIFIER_LINES:
        return square(sinF(f32(value * f32(3 * PI))));
      case ParticleNoiseModifier.PF_NOISE_MODIFIER_CLUMPS:
        return f32(f32(2.5 * Math.abs(value)) - 0.5);
      case ParticleNoiseModifier.PF_NOISE_MODIFIER_RINGS:
        return saturate(f32(f32(Math.abs(sinF(f32(value * PI))) + 0.25) / 1.25));
      default:
        return 1;
    }
  }
}
