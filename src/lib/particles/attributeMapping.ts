// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/AttributeMapping.cs.

import { ParticleFloatBiasType, PfInputMode, PfMapType, PfRoundType } from './enums';
import { getString, getSubCollection, hasKey, isCollection } from './kv';
import { clampEitherOrder, f32, fract, lerp, roundHalfEven } from './numerics';
import type { ParticleDefinitionParser } from './parser';
import { PiecewiseCurve } from './utils/curve';
import { biasFromParameter } from './utils/particleMath';

/** The value an input settles at from some input value on, for inputs that flatten out. */
export interface SteadyState {
  time: number;
  value: number;
}

/** Particle attribute remapping (the mapping half of CParticleFloatInput). */
export class AttributeMapping {
  private readonly mapType: number = PfMapType.Direct;
  private readonly inputMode: number = PfInputMode.Clamped;
  private readonly roundType: number = PfRoundType.Nearest;

  private readonly multFactor: number = 1;

  private readonly input0: number = 0;
  private readonly input1: number = 1;
  private readonly output0: number = 0;
  private readonly output1: number = 1;

  private readonly notchedRangeMin: number = 0;
  private readonly notchedRangeMax: number = 1;
  private readonly notchedOutputOutside: number = 0;
  private readonly notchedOutputInside: number = 1;

  private readonly biasType: number = ParticleFloatBiasType.PF_BIAS_TYPE_STANDARD;
  private readonly biasParameter: number = 0;

  private readonly curve: PiecewiseCurve | null = null;

  private readonly compareValue: number = 0;

  /** A mapping that passes the input through unchanged when `parse` is null. */
  constructor(parse: ParticleDefinitionParser | null = null, isRemapInput = false) {
    if (parse === null) {
      return;
    }

    this.inputMode = parse.enumNormalized('m_nInputMode', PfInputMode, 'PfInputMode', this.inputMode);

    // A random remap input maps 0 to 1 onto its random range and ignores the map type
    const inputType = isRemapInput ? getString(parse.data, 'm_nType', 'PF_TYPE_INVALID') : 'PF_TYPE_INVALID';

    if (inputType === 'PF_TYPE_RANDOM_UNIFORM') {
      this.mapType = PfMapType.Remap;
      this.output0 = parse.float('m_flRandomMin');
      this.output1 = parse.float('m_flRandomMax', 1);
      return;
    }

    if (inputType === 'PF_TYPE_RANDOM_BIASED') {
      this.mapType = PfMapType.RemapBiased;
      this.output0 = parse.float('m_flRandomMin');
      this.output1 = parse.float('m_flRandomMax', 1);
      this.biasType = parse.enum('m_nBiasType', ParticleFloatBiasType, this.biasType);
      this.biasParameter = parse.float('m_flBiasParameter', this.biasParameter);
      return;
    }

    this.mapType = parse.enumNormalized('m_nMapType', PfMapType, 'PfMapType', PfMapType.Direct);

    switch (this.mapType) {
      case PfMapType.Direct:
        break;

      case PfMapType.Mult:
        this.multFactor = parse.float('m_flMultFactor', this.multFactor);
        break;

      case PfMapType.Remap:
      case PfMapType.RemapBiased:
        this.input0 = parse.float('m_flInput0', this.input0);
        this.input1 = parse.float('m_flInput1', this.input1);
        this.output0 = parse.float('m_flOutput0', this.output0);
        this.output1 = parse.float('m_flOutput1', this.output1);
        this.biasType = parse.enum('m_nBiasType', ParticleFloatBiasType, this.biasType);
        this.biasParameter = parse.float('m_flBiasParameter', this.biasParameter);
        break;

      case PfMapType.Curve:
        this.curve = new PiecewiseCurve(getSubCollection(parse.data, 'm_Curve'), this.inputMode === PfInputMode.Looped);
        break;

      case PfMapType.Notched: {
        const rangeMin = parse.float('m_flNotchedRangeMin', this.notchedRangeMin);
        const rangeMax = parse.float('m_flNotchedRangeMax', this.notchedRangeMax);
        this.notchedRangeMin = Math.min(rangeMin, rangeMax);
        this.notchedRangeMax = Math.max(rangeMin, rangeMax);
        this.notchedOutputOutside = parse.float('m_flNotchedOutputOutside', this.notchedOutputOutside);
        this.notchedOutputInside = parse.float('m_flNotchedOutputInside', this.notchedOutputInside);
        break;
      }

      case PfMapType.Round:
        this.roundType = hasKey(parse.data, 'm_nRoundType')
          ? parse.enumNormalized('m_nRoundType', PfRoundType, 'PfRoundType', PfRoundType.Invalid)
          : this.roundType;
        break;

      case PfMapType.Min:
      case PfMapType.Max:
      case PfMapType.Mod:
        this.compareValue = parse.float('m_flCompareValue');
        break;

      default:
        break;
    }
  }

  /** Reads the CParticleRemapFloatInput at `key`, or null when the block is absent. */
  static fromRemapInput(parse: ParticleDefinitionParser, key: string): AttributeMapping | null {
    const remap = getSubCollection(parse.data, key);
    return isCollection(remap) ? new AttributeMapping(parse.nested(remap), true) : null;
  }

  applyMapping(value: number): number {
    switch (this.mapType) {
      case PfMapType.Mult:
        return f32(value * this.multFactor);

      case PfMapType.Remap:
        return this.clampToOutputRange(lerp(this.output0, this.output1, this.remapFraction(value)));

      case PfMapType.RemapBiased: {
        const biased = biasFromParameter(Math.min(this.remapFraction(value), 1), this.biasParameter, this.biasType);
        return this.clampToOutputRange(lerp(this.output0, this.output1, biased));
      }

      case PfMapType.Curve:
        return this.curve!.evaluate(value);

      case PfMapType.Notched:
        return value >= this.notchedRangeMin && value <= this.notchedRangeMax ? this.notchedOutputInside : this.notchedOutputOutside;

      case PfMapType.Round:
        switch (this.roundType) {
          case PfRoundType.Nearest:
            return roundHalfEven(value);
          case PfRoundType.Floor:
            return Math.floor(value);
          case PfRoundType.Ceil:
            return Math.ceil(value);
          default:
            return value;
        }

      case PfMapType.Min:
        return Math.min(value, this.compareValue);

      case PfMapType.Max:
        return Math.max(value, this.compareValue);

      case PfMapType.Mod:
        return this.compareValue === 0 ? value : f32(value - f32(Math.trunc(f32(value / this.compareValue)) * this.compareValue));

      default:
        return value;
    }
  }

  /** The input value from which an unlooped mapping stays at its final value, or null. */
  tryGetSteadyState(): SteadyState | null {
    if (this.inputMode === PfInputMode.Looped) {
      return null;
    }

    switch (this.mapType) {
      case PfMapType.Remap:
      case PfMapType.RemapBiased:
        // A reversed input range still reports its second end
        return { time: this.input1, value: this.output1 };

      case PfMapType.Curve: {
        const end = this.curve!.tryGetEnd();
        return end === null ? null : { time: end.x, value: end.y };
      }

      case PfMapType.Notched:
        return { time: this.notchedRangeMax, value: this.notchedOutputOutside };

      case PfMapType.Min:
        return { time: this.compareValue, value: this.compareValue };

      default:
        return null;
    }
  }

  /** Maps every value in place, as applyMapping does, with the column operations' rounding. */
  applyMappingColumn(values: Float32Array): void {
    switch (this.mapType) {
      case PfMapType.Mult:
        for (let i = 0; i < values.length; i++) {
          values[i] = values[i] * this.multFactor;
        }
        return;

      case PfMapType.Remap:
        if (this.inputMode !== PfInputMode.Looped && this.input0 !== this.input1) {
          const inputRange = f32(this.input1 - this.input0);
          const outputRange = f32(this.output1 - this.output0);
          const min = Math.min(this.output0, this.output1);
          const max = Math.max(this.output0, this.output1);

          for (let i = 0; i < values.length; i++) {
            let value = f32(values[i] - this.input0);
            value = f32(value / inputRange);
            value = f32(value * outputRange);
            value = f32(value + this.output0);
            values[i] = Math.min(Math.max(value, min), max);
          }

          return;
        }
        break;

      case PfMapType.Round:
        if (this.roundType === PfRoundType.Nearest) {
          for (let i = 0; i < values.length; i++) {
            values[i] = roundHalfEven(values[i]);
          }
          return;
        }

        if (this.roundType === PfRoundType.Floor) {
          for (let i = 0; i < values.length; i++) {
            values[i] = Math.floor(values[i]);
          }
          return;
        }

        if (this.roundType === PfRoundType.Ceil) {
          for (let i = 0; i < values.length; i++) {
            values[i] = Math.ceil(values[i]);
          }
          return;
        }

        return;

      case PfMapType.Min:
        for (let i = 0; i < values.length; i++) {
          values[i] = Math.min(values[i], this.compareValue);
        }
        return;

      case PfMapType.Max:
        for (let i = 0; i < values.length; i++) {
          values[i] = Math.max(values[i], this.compareValue);
        }
        return;

      case PfMapType.RemapBiased:
      case PfMapType.Curve:
      case PfMapType.Notched:
      case PfMapType.Mod:
        break;

      default:
        return;
    }

    for (let i = 0; i < values.length; i++) {
      values[i] = this.applyMapping(values[i]);
    }
  }

  /** Where the input falls in the input range, unclamped; a looped input is folded into [0, m_flInput1) first. */
  private remapFraction(value: number): number {
    if (this.inputMode === PfInputMode.Looped && this.input1 !== 0) {
      value = f32(this.input1 * fract(f32(value / this.input1)));
    }

    const inputRange = f32(this.input1 - this.input0);

    if (inputRange === 0) {
      return this.input0 <= value ? 1 : 0;
    }

    return f32(f32(value - this.input0) / inputRange);
  }

  private clampToOutputRange(value: number): number {
    return clampEitherOrder(value, this.output0, this.output1);
  }
}
