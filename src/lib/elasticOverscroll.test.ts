import { describe, expect, it } from 'vitest';
import { ELASTIC, rubberBand, rubberBandInverse, springSettled, springStep, wheelDeltaPx } from './elasticOverscroll';

describe('rubberBand', () => {
  it('starts at the resistance slope and never passes the cap', () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(1)).toBeCloseTo(ELASTIC.resistance, 1);
    expect(rubberBand(1e6)).toBeLessThan(ELASTIC.maxPx);
    expect(rubberBand(1e6)).toBeGreaterThan(ELASTIC.maxPx * 0.99);
  });

  it('is monotonic and symmetric', () => {
    let prev = 0;
    for (let x = 10; x <= 2000; x += 10) {
      const y = rubberBand(x);
      expect(y).toBeGreaterThan(prev);
      expect(rubberBand(-x)).toBeCloseTo(-y, 10);
      prev = y;
    }
  });

  it('gives one mouse-wheel notch a visible give, not a lurch', () => {
    const windowsNotch = rubberBand(100 * ELASTIC.inputScale);
    const linuxNotch = rubberBand(53 * ELASTIC.inputScale);
    expect(windowsNotch).toBeGreaterThan(18);
    expect(windowsNotch).toBeLessThan(35);
    expect(linuxNotch).toBeGreaterThan(10);
    expect(linuxNotch).toBeLessThan(windowsNotch);
  });

  it('round-trips through its inverse so a pull can resume mid-spring', () => {
    for (const x of [-500, -40, -3, 3, 40, 500]) {
      expect(rubberBandInverse(rubberBand(x))).toBeCloseTo(x, 6);
    }
  });
});

describe('wheelDeltaPx', () => {
  it('converts line and page deltas to pixels', () => {
    expect(wheelDeltaPx(3, 0, 800)).toBe(3);
    expect(wheelDeltaPx(3, 1, 800)).toBe(48);
    expect(wheelDeltaPx(-1, 2, 800)).toBe(-800);
  });
});

describe('springStep', () => {
  const settle = (x: number, v: number, rate: number, damping?: number) => {
    let t = 0;
    let peakPastTarget = 0;
    while (!springSettled(x, v, 0) && t < 5) {
      [x, v] = springStep(x, v, 0, rate, 1 / 60, damping);
      peakPastTarget = Math.max(peakPastTarget, -x);
      t += 1 / 60;
    }
    return { t, peakPastTarget };
  };

  it('never overshoots when critically damped', () => {
    const { t, peakPastTarget } = settle(40, 0, 17);
    expect(peakPastTarget).toBe(0);
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.6);
  });

  it('snaps back past rest on release, then settles within a second', () => {
    const { t, peakPastTarget } = settle(40, 0, ELASTIC.returnRate, ELASTIC.returnDamping);
    expect(peakPastTarget).toBeGreaterThan(40 * 0.1);
    expect(peakPastTarget).toBeLessThan(40 * 0.3);
    expect(t).toBeLessThan(1);
  });

  it('is exact for any step size, so a long frame cannot blow it up', () => {
    for (const damping of [1, ELASTIC.returnDamping]) {
      const [x1] = springStep(40, 0, 0, ELASTIC.returnRate, 0.2, damping);
      let x = 40;
      let v = 0;
      for (let i = 0; i < 20; i++) [x, v] = springStep(x, v, 0, ELASTIC.returnRate, 0.01, damping);
      expect(x1).toBeCloseTo(x, 6);
      expect(Math.abs(springStep(40, 0, 0, ELASTIC.returnRate, 10, damping)[0])).toBeLessThan(1e-6);
    }
  });

  it('follows a moving target while input arrives', () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 12; i++) [x, v] = springStep(x, v, 14, ELASTIC.followRate, 1 / 60);
    expect(x).toBeGreaterThan(12);
    expect(x).toBeLessThanOrEqual(14);
  });
});
