// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/ColorGradient.cs.

import { type KVObject, coerceDouble, getArray, hasKey, isCollection, toVector3 } from '../kv';
import { Vector3, clamp, f32, lerpV } from '../numerics';

const COINCIDENT_STOP_DISTANCE = f32(1e-5);

/** float.CompareTo, which orders NaN before every number. */
function compareFloat(a: number, b: number): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  if (a === b) {
    return 0;
  }
  return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : -1) : 1;
}

/** A colour ramp over [0, 1], blended between stops in whole 8-bit steps per channel. */
export class ColorGradient {
  private readonly positions: Float32Array;
  private readonly colors: Vector3[];

  /**
   * Reads the stops with their positions clamped to [0, 1] and sorted, keeping stops at the
   * same position in file order.
   */
  constructor(gradient: KVObject | null) {
    const stops = (gradient ? getArray(gradient, 'm_Stops') : null) ?? [];

    const sorted = stops
      .map((element) => {
        const stop = isCollection(element) ? element : {};
        return {
          position: clamp(f32(coerceDouble(stop.m_flPosition, 0)), 0, 1),
          color: hasKey(stop, 'm_Color') ? toVector3(stop.m_Color) : Vector3.zero,
        };
      })
      .sort((a, b) => compareFloat(a.position, b.position));

    this.positions = Float32Array.from(sorted, (stop) => stop.position);
    this.colors = sorted.map((stop) => stop.color);
  }

  /**
   * The colour at `t`, normalized to [0, 1]. Positions outside the stops take the nearest end
   * stop, and a gradient without stops is white.
   */
  evaluate(t: number): Vector3 {
    const { positions, colors } = this;

    if (positions.length === 0) {
      return Vector3.one;
    }

    const index = this.findStop(t);

    if (index < 0) {
      return colors[0].div(255);
    }

    if (index === positions.length - 1) {
      return colors[index].div(255);
    }

    const span = f32(positions[index + 1] - positions[index]);

    if (span < COINCIDENT_STOP_DISTANCE) {
      return colors[index].div(255);
    }

    const blended = lerpV(colors[index], colors[index + 1], f32(f32(t - positions[index]) / span));

    return new Vector3(Math.trunc(blended.x), Math.trunc(blended.y), Math.trunc(blended.z)).div(255);
  }

  /** The stop matching `t`, else the last stop before it, or -1 when it is before every stop. */
  private findStop(t: number): number {
    const { positions } = this;
    let low = 0;
    let high = positions.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;

      if (t > positions[middle]) {
        low = middle + 1;
      } else if (positions[middle] > t) {
        high = middle - 1;
      } else {
        return middle;
      }
    }

    return high;
  }
}
