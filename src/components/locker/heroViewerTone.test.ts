import { describe, expect, it } from 'vitest';
import { deadlockTone } from './heroViewerTone';
import { DEADLOCK_BASE_POST, tonemapChannel } from '../../lib/particles/render/post';

describe('Deadlock preview tone curve', () => {
  it('preserves black and normalizes the authored white point', () => {
    expect(deadlockTone(0)).toBe(0);
    const white = 2 ** DEADLOCK_BASE_POST.tonemap.whitePoint / (2.8 * 2 ** DEADLOCK_BASE_POST.tonemap.exposureBias);
    expect(deadlockTone(white)).toBeCloseTo(1);
    expect(deadlockTone(white / 2)).toBeLessThan(1);
    expect(deadlockTone(-1)).toBe(0);
    expect(deadlockTone(100)).toBe(1);
  });
  it('keeps highlight order and bounds without lifting black', () => {
    const samples = [0, 0.01, 0.1, 0.5, 1, 2, 3].map(deadlockTone);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]);
  });
  it('agrees with the Source 2 post curve at the same scene exposure', () => {
    for (const exposure of [0.2, 1, 1.3, 1.6, 4]) {
      for (const radiance of [0, 0.02, 0.18, 0.19608, 1, 6.54902, 20]) {
        const linear = deadlockTone(radiance * exposure);
        const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
        expect(encoded).toBeCloseTo(tonemapChannel({ ...DEADLOCK_BASE_POST, exposure }, radiance), 10);
      }
    }
  });
  it('compresses bright emission per channel without preserving its HDR hue', () => {
    const display = [6.54902, 0.19608, 0].map((v) => {
      const linear = deadlockTone(v * 1.3);
      return Math.round(255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055));
    });
    expect(display).toEqual([255, 184, 0]);
  });
});
