import { describe, expect, it } from 'vitest';
import { deadlockTone } from './heroViewerTone';

describe('Deadlock preview tone curve', () => {
  it('preserves black and normalizes the authored white point', () => {
    expect(deadlockTone(0)).toBe(0);
    expect(deadlockTone(3.9996)).toBeCloseTo(1);
    expect(deadlockTone(-1)).toBe(0);
    expect(deadlockTone(100)).toBe(1);
  });
  it('keeps highlight order and bounds without lifting black', () => {
    const samples = [0, 0.01, 0.1, 0.5, 1, 2, 4].map(deadlockTone);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]);
  });
});
