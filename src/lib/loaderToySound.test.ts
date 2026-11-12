import { describe, expect, it } from 'vitest';
import { fanLevel, fanPitch, nextClack, openToySound } from './loaderToySound';

describe('nextClack', () => {
  it('never plays the same clack twice running, and reaches every other one', () => {
    for (let last = 0; last < 6; last++) {
      const picks = new Set(Array.from({ length: 50 }, (_, step) => nextClack(last, 6, () => step / 50)));
      expect(picks.has(last)).toBe(false);
      expect(picks.size).toBe(5);
    }
  });

  it('takes any clack first', () => {
    expect(new Set(Array.from({ length: 60 }, (_, step) => nextClack(-1, 6, () => step / 60))).size).toBe(6);
  });

  it('stays in range at the ends of the dice', () => {
    for (const roll of [0, 0.999999, 1]) {
      expect(nextClack(2, 6, () => roll)).toBeGreaterThanOrEqual(0);
      expect(nextClack(2, 6, () => roll)).toBeLessThan(6);
      expect(nextClack(-1, 6, () => roll)).toBeLessThan(6);
    }
    expect(nextClack(0, 1, () => 0.5)).toBe(0);
  });
});

describe('the fan', () => {
  it('hums higher and louder the faster it turns', () => {
    expect(fanPitch(1)).toBe(1);
    expect(fanPitch(9)).toBeGreaterThan(fanPitch(5));
    expect(fanLevel(9)).toBeGreaterThan(fanLevel(1));
  });
});

describe('openToySound', () => {
  it('is silent, and harmless, at no volume or where there is no audio', () => {
    for (const volume of [0, 0.7, Number.NaN]) {
      const sound = openToySound(volume);
      expect(() => { sound.key(); sound.tap(); sound.crack(); sound.jolt(); sound.fan(4); sound.mute(true); sound.close(); }).not.toThrow();
    }
  });
});
