// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/LightFalloff.cs.
//
// A light's attenuation, 1 / (constant + linear * d + quadratic * d^2).

const f32 = Math.fround;
const FLOAT_EPSILON = f32(1.1920929e-7);
const LUMINANCE_WEIGHTS = [0.2125, 0.7154, 0.0721] as const;

export interface LightCutoff {
  range: number;
  offset: number;
}

export class LightFalloff {
  readonly constant: number;
  readonly linear: number;
  readonly quadratic: number;

  constructor(constant: number, linear: number, quadratic: number) {
    this.constant = constant;
    this.linear = linear;
    this.quadratic = quadratic;
  }

  get isFinite(): boolean {
    return Number.isFinite(this.constant) && Number.isFinite(this.linear) && Number.isFinite(this.quadratic);
  }

  denominator(distance: number): number {
    return f32(this.constant + f32(this.linear * distance) + f32(f32(this.quadratic * distance) * distance));
  }

  /**
   * The curve through 1 at the light, 1/2 at `fiftyDistance` and 1/256 at `zeroDistance`. A fifty
   * percent distance past the zero one moves the zero one to twice the fifty.
   */
  static solve(fiftyDistance: number, zeroDistance: number): LightFalloff {
    if (fiftyDistance > zeroDistance) {
      zeroDistance = f32(fiftyDistance + fiftyDistance);
    }

    const [quadratic, linear, constant] = fitQuadratic(0, 1, fiftyDistance, 2, zeroDistance, 256) ?? [0, 1, 0];
    const scale = f32(2 / f32(f32(f32(f32(quadratic * fiftyDistance) + linear) * fiftyDistance) + constant));

    return new LightFalloff(f32(constant * scale), f32(linear * scale), f32(quadratic * scale));
  }

  /** The range where a light of `color` falls to a thousandth of its luminance, for curves without a constant term. */
  cutoffFor(color: [number, number, number]): LightCutoff {
    if (this.constant !== 0) {
      return { range: 0, offset: 0 };
    }

    let range = 0;
    const luminance = f32(color[0] * LUMINANCE_WEIGHTS[0] + color[1] * LUMINANCE_WEIGHTS[1] + color[2] * LUMINANCE_WEIGHTS[2]);

    if (luminance > 0) {
      const scale = f32(0.001 / luminance);
      const roots = solveQuadratic(f32(this.quadratic * scale), f32(this.linear * scale), f32(f32(this.constant * scale) - 1));

      if (roots !== null) {
        range = Math.max(0, Math.max(roots[0], roots[1]));
      }
    }

    return range > 0
      ? { range, offset: f32(1 / f32(f32(f32(range * range) * this.quadratic) + f32(f32(range * this.linear) + FLOAT_EPSILON))) }
      : { range: 0, offset: 0 };
  }

  evaluate(distanceSquared: number, cutoff: LightCutoff): number {
    distanceSquared = Math.max(1, distanceSquared);
    const constant = this.constant !== 0 ? this.constant : FLOAT_EPSILON;
    let intensity = f32(1 / f32(constant + f32(this.linear * f32(Math.sqrt(distanceSquared))) + f32(this.quadratic * distanceSquared)));

    if (cutoff.offset !== 0) {
      intensity = Math.max(0, f32(intensity - cutoff.offset));
    }

    if (cutoff.range !== 0 && !(distanceSquared < cutoff.range * cutoff.range)) {
      return 0;
    }

    return intensity;
  }
}

/**
 * The quadratic a x^2 + b x + c through three points, bent toward the line through the outer two
 * where it would turn back between them; null when two share an x.
 */
function fitQuadratic(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): [number, number, number] | null {
  if (x0 > x1) {
    [x0, y0, x1, y1] = [x1, y1, x0, y0];
  }

  if (x1 > x2) {
    [x1, y1, x2, y2] = [x2, y2, x1, y1];
  }

  if (x0 > x1) {
    [x0, y0, x1, y1] = [x1, y1, x0, y0];
  }

  const determinant = f32(f32(f32(x0 - x1) * f32(x0 - x2)) * f32(x1 - x2));

  if (determinant === 0) {
    return null;
  }

  const linearY1 = f32(f32(f32(f32(x1 - x0) * f32(y2 - y0)) / f32(x2 - x0)) + y0);
  let blend = 0;

  for (;;) {
    const middle = f32(f32(linearY1 * blend) + f32(f32(1 - blend) * y1));
    const a = f32(f32(f32(f32(middle - y0) * x2) + f32(f32(y0 - y2) * x1) + f32(f32(y2 - middle) * x0)) / determinant);
    const b = f32(
      f32(f32(f32(y0 - middle) * f32(x2 * x2)) + f32(f32(middle - y2) * f32(x0 * x0)) + f32(f32(x1 * x1) * f32(y2 - y0))) / determinant,
    );
    const c = f32(
      f32(
        f32(f32(f32(y0 * x2) - f32(x0 * y2)) * f32(x1 * x1)) +
          f32(f32(f32(x0 * x2) * f32(x2 - x0)) * middle) +
          f32(f32(f32(f32(x0 * x0) * y2) - f32(f32(x2 * x2) * y0)) * x1),
      ) / determinant,
    );

    const slope = f32(f32(a + a) + b);
    const turnsBack = y0 < y1 && y1 < y2 ? slope < 0 : y0 > y1 && y1 > y2 && slope > 0;

    if (!turnsBack) {
      return [a, b, c];
    }

    blend = f32(blend + 0.05);

    if (blend > 1) {
      return [a, b, c];
    }
  }
}

function solveQuadratic(a: number, b: number, c: number): [number, number] | null {
  if (a === 0) {
    if (b !== 0) {
      return [-c / b, -c / b];
    }

    return c === 0 ? [0, 0] : null;
  }

  const discriminant = f32(f32(b * b) - f32(f32(a * 4) * c));

  if (discriminant < 0) {
    return null;
  }

  const root = f32(Math.sqrt(discriminant));
  return [f32(f32(root - b) / f32(a + a)), f32(f32(-b - root) / f32(a + a))];
}
