// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/CurveFitting.cs.

import { type KVObject, type KVValue, coerceDouble, getArray, getString, isCollection } from '../kv';
import { f32, fract, saturate } from '../numerics';

const MINIMUM_KEY_SPACING = f32(0.0001);
const SINE_STEEP_SLOPE = f32(1.60305);
const SINE_SHALLOW_SLOPE = f32(0.0413377);

const TangentType = {
  Linear: 0,
  Spline: 1,
  Free: 2,
  Mirror: 3,
  Sine: 4,
  Flat: 5,
} as const;

type TangentType = (typeof TangentType)[keyof typeof TangentType];

/** A 2D point: a curve input (x) and output (y). */
export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

/** KVObject.ToVector2 of an array value. */
function toVector2(value: KVValue | undefined): CurvePoint {
  const elements = Array.isArray(value) ? value : [];
  return { x: f32(coerceDouble(elements[0], 0)), y: f32(coerceDouble(elements[1], 0)) };
}

/** GetFloatProperty. */
function getFloat(obj: KVObject, key: string): number {
  return f32(coerceDouble(obj[key], 0));
}

/**
 * Mirrors CubicHermite.GetPoint (ValveResourceFormat/Animation/Curves.cs) for a scalar segment,
 * tangents scaled by its width.
 */
function cubicHermite(point0: number, tangent0: number, point1: number, tangent1: number, t: number): number {
  const tSquared = f32(t * t);
  const tCubed = f32(tSquared * t);
  const threeTSquared = f32(3 * tSquared);
  const twoTCubed = f32(tCubed * 2);

  const a = f32(point0 * f32(f32(twoTCubed - threeTSquared) + 1));
  const b = f32(tangent0 * f32(f32(tCubed - f32(2 * tSquared)) + t));
  const c = f32(tangent1 * f32(tCubed - tSquared));
  const d = f32(point1 * f32(threeTSquared - twoTCubed));

  return f32(f32(f32(a + b) + c) + d);
}

function getTangentType(value: string | null): TangentType {
  switch (value) {
    case 'CURVE_TANGENT_LINEAR':
      return TangentType.Linear;
    case 'CURVE_TANGENT_FREE':
      return TangentType.Free;
    case 'CURVE_TANGENT_MIRROR':
      return TangentType.Mirror;
    case 'CURVE_TANGENT_SINE':
      return TangentType.Sine;
    case 'CURVE_TANGENT_FLAT':
      return TangentType.Flat;
    default:
      return TangentType.Spline;
  }
}

/**
 * A piecewise curve used in particle systems' dynamic parameters: cubic Hermite segments between
 * keys whose slopes come from each key's tangent modes.
 */
export class PiecewiseCurve {
  private readonly curveDomainMin: CurvePoint;
  private readonly curveDomainMax: CurvePoint;
  private readonly isLooped: boolean;

  private readonly keyX: Float32Array;
  private readonly keyY: Float32Array;
  private readonly slopeIncoming: Float32Array;
  private readonly slopeOutgoing: Float32Array;

  /** The lowest input (x) and output (y) the curve is defined over. */
  get domainMin(): CurvePoint {
    return this.curveDomainMin;
  }

  /** The highest input (x) and output (y) the curve is defined over. */
  get domainMax(): CurvePoint {
    return this.curveDomainMax;
  }

  /**
   * Reads a piecewise curve from its compiled data. `isLooped` wraps the input with a period of
   * the domain's upper x.
   */
  constructor(curveInfo: KVObject | null, isLooped: boolean) {
    this.isLooped = isLooped;

    const info = curveInfo ?? {};

    this.curveDomainMin = toVector2(info.m_vDomainMins);
    this.curveDomainMax = toVector2(info.m_vDomainMaxs);

    const splines = getArray(info, 'm_spline') ?? [];
    const tangents = getArray(info, 'm_tangents') ?? [];
    const count = Math.min(splines.length, tangents.length);

    this.keyX = new Float32Array(count);
    this.keyY = new Float32Array(count);
    this.slopeIncoming = new Float32Array(count);
    this.slopeOutgoing = new Float32Array(count);

    const incoming: TangentType[] = new Array<TangentType>(count);
    const outgoing: TangentType[] = new Array<TangentType>(count);

    for (let i = 0; i < count; i++) {
      const spline = splines[i];
      const tangent = tangents[i];
      const key = isCollection(spline) ? spline : {};
      const tangentInfo = isCollection(tangent) ? tangent : {};

      this.keyX[i] = getFloat(key, 'x');
      this.keyY[i] = getFloat(key, 'y');
      this.slopeIncoming[i] = getFloat(key, 'm_flSlopeIncoming');
      this.slopeOutgoing[i] = getFloat(key, 'm_flSlopeOutgoing');
      incoming[i] = getTangentType(getString(tangentInfo, 'm_nIncomingTangent'));
      outgoing[i] = getTangentType(getString(tangentInfo, 'm_nOutgoingTangent'));

      if (i > 0) {
        this.keyX[i] = Math.max(this.keyX[i], f32(this.keyX[i - 1] + MINIMUM_KEY_SPACING));
      }
    }

    this.computeSlopes(incoming, outgoing);
  }

  /**
   * Replaces the authored slopes with ones derived from the tangent modes, keeping them only for
   * free tangents. A mirrored incoming tangent takes the outgoing slope.
   */
  private computeSlopes(incoming: TangentType[], outgoing: TangentType[]): void {
    const { keyX, keyY, slopeIncoming, slopeOutgoing } = this;
    const last = keyX.length - 1;

    for (let i = 0; i <= last; i++) {
      let dxPrevious = 0;
      let dyPrevious = 0;
      let slopePrevious = 0;
      let dxNext = 0;
      let dyNext = 0;
      let slopeNext = 0;
      let slopeCentral = 0;

      if (i > 0) {
        dyPrevious = f32(keyY[i] - keyY[i - 1]);
        dxPrevious = f32(keyX[i] - keyX[i - 1]);
        slopePrevious = f32(dyPrevious / dxPrevious);
      }

      if (i < last) {
        if (i > 0) {
          slopeCentral = f32(f32(keyY[i + 1] - keyY[i - 1]) / f32(keyX[i + 1] - keyX[i - 1]));
        }

        dyNext = f32(keyY[i + 1] - keyY[i]);
        dxNext = f32(keyX[i + 1] - keyX[i]);
        slopeNext = f32(dyNext / dxNext);
      } else if (i > 0) {
        slopeCentral = slopePrevious;
      }

      if (i === 0) {
        slopeCentral = slopeNext;
      }

      switch (incoming[i]) {
        case TangentType.Linear:
          slopeIncoming[i] = slopePrevious;
          break;
        case TangentType.Spline:
          slopeIncoming[i] = slopeCentral;
          break;
        case TangentType.Free:
          break;
        case TangentType.Sine:
          slopeIncoming[i] = f32(
            (dxPrevious === 0 ? 1 : f32(1 / dxPrevious)) * (dyPrevious <= 0 ? -SINE_STEEP_SLOPE : -SINE_SHALLOW_SLOPE),
          );
          break;
        default:
          slopeIncoming[i] = 0;
      }

      switch (outgoing[i]) {
        case TangentType.Linear:
          slopeOutgoing[i] = slopeNext;
          break;
        case TangentType.Spline:
          slopeOutgoing[i] = slopeCentral;
          break;
        case TangentType.Free:
          break;
        case TangentType.Mirror:
          slopeOutgoing[i] = slopeIncoming[i];
          break;
        case TangentType.Sine:
          slopeOutgoing[i] = f32(
            (dxNext === 0 ? 1 : f32(1 / dxNext)) * (dyNext <= 0 ? SINE_SHALLOW_SLOPE : SINE_STEEP_SLOPE),
          );
          break;
        default:
          slopeOutgoing[i] = 0;
      }

      if (incoming[i] === TangentType.Mirror) {
        slopeIncoming[i] = slopeOutgoing[i];
      }
    }
  }

  /**
   * Evaluates the curve at the given input value. Inputs before the first key or after the last
   * one hold that key's value, and the result is clamped to the domain's y range.
   */
  evaluate(value: number): number {
    const { keyX, keyY } = this;

    if (keyX.length < 2) {
      return 0;
    }

    value = f32(value);

    if (this.isLooped && this.curveDomainMax.x !== 0) {
      value = f32(fract(f32(value / this.curveDomainMax.x)) * this.curveDomainMax.x);
    }

    const end = this.findSegmentEnd(value);
    const start = end - 1;

    const dx = f32(keyX[end] - keyX[start]);
    let t = f32(value - keyX[start]);

    if (dx !== 0) {
      t = f32(t / dx);
    }

    t = saturate(t);

    const y = cubicHermite(
      keyY[start],
      f32(this.slopeOutgoing[start] * dx),
      keyY[end],
      f32(this.slopeIncoming[end] * dx),
      t,
    );

    return Math.min(Math.max(y, this.curveDomainMin.y), this.curveDomainMax.y);
  }

  /**
   * The end of the curve's domain and the value of its last key, which the curve holds from
   * there on. Null for a curve with fewer than two keys.
   */
  tryGetEnd(): CurvePoint | null {
    if (this.keyX.length < 2) {
      return null;
    }

    return { x: this.curveDomainMax.x, y: this.keyY[this.keyY.length - 1] };
  }

  /** The first key after the first one that is not below `value`, or the last key. */
  private findSegmentEnd(value: number): number {
    let low = 1;
    let high = this.keyX.length - 1;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (this.keyX[middle] < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }
}
