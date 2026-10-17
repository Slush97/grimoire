// Pure math behind useElasticOverscroll: rubber-band resistance and a damped
// spring. No DOM here so it can be unit tested.

export const ELASTIC = {
  /** Asymptote of the pull, in px. The offset approaches it, never reaches it. */
  maxPx: 120,
  /** Rubber-band stiffness (UIScrollView uses 0.55). Lower feels heavier. */
  resistance: 0.55,
  /** Wheel delta to rubber-band input. A 100px Windows notch gives about 26px. */
  inputScale: 0.6,
  /** Spring rate (1/s) while input is arriving: how quickly the content follows. */
  followRate: 38,
  /** Spring natural frequency (1/s) on release. */
  returnRate: 16,
  /** Damping ratio on release. Below 1 it overshoots rest by about 20% and wobbles once. */
  returnDamping: 0.45,
  /** Quiet time after the last wheel event that counts as letting go. */
  releaseDelayMs: 90,
} as const;

/**
 * Rubber-band curve: offset for an accumulated pull of `input` px. Linear at
 * first (slope = resistance), flattening toward `max`. Sign follows input.
 */
export function rubberBand(input: number, max: number = ELASTIC.maxPx, resistance: number = ELASTIC.resistance): number {
  const x = Math.abs(input);
  const y = (1 - 1 / ((x * resistance) / max + 1)) * max;
  return Math.sign(input) * y;
}

/** Inverse of rubberBand, so a new pull can resume from a decaying offset. */
export function rubberBandInverse(offset: number, max: number = ELASTIC.maxPx, resistance: number = ELASTIC.resistance): number {
  const y = Math.min(Math.abs(offset), max * 0.999);
  return Math.sign(offset) * ((y * max) / ((max - y) * resistance));
}

/** WheelEvent delta in px, whatever its deltaMode (0 px, 1 lines, 2 pages). */
export function wheelDeltaPx(delta: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}

/**
 * One step of a damped spring toward `target`. Critically damped (no
 * overshoot) at the default `damping` of 1, underdamped below it. Exact for
 * any dt, so a dropped frame cannot add overshoot or blow it up.
 */
export function springStep(x: number, v: number, target: number, rate: number, dt: number, damping = 1): [number, number] {
  const d = x - target;
  if (damping < 1) {
    const decay = damping * rate;
    const freq = rate * Math.sqrt(1 - damping * damping);
    const e = Math.exp(-decay * dt);
    const cos = Math.cos(freq * dt);
    const sin = Math.sin(freq * dt);
    return [
      target + e * (d * cos + ((v + decay * d) / freq) * sin),
      e * (v * cos - ((decay * v + rate * rate * d) / freq) * sin),
    ];
  }
  const e = Math.exp(-rate * dt);
  const c = v + rate * d;
  return [target + (d + c * dt) * e, (v - rate * c * dt) * e];
}

/** Close enough to rest that the transform can be dropped. */
export function springSettled(x: number, v: number, target: number): boolean {
  return Math.abs(x - target) < 0.25 && Math.abs(v) < 4;
}
