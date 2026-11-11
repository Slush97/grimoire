import { describe, expect, it } from 'vitest';
import { MAX_CUSTOM_SWATCHES, applyCustomSwatch, customSwatches, removeCustomSwatch, sameSwatches } from './customSwatches';
import { ACCENT_SWATCH_RULES as accent, DEFAULT_ACCENT_COLOR } from './accentColor';
import { BACKGROUND_GRADIENT_PRESETS, BACKGROUND_SWATCH_RULES as glow } from './backgroundGradient';

const PINK = '#ff66cc';
const TEAL = '#11aa99';
const LIME = '#aaff00';
const NAVY = '#101060';

describe('customSwatches', () => {
  it('shows the stored swatches in the order they were added', () => {
    expect(customSwatches([PINK, TEAL], PINK, accent)).toEqual([PINK, TEAL]);
    expect(customSwatches(undefined, DEFAULT_ACCENT_COLOR, accent)).toEqual([]);
  });

  it('shows a custom color picked before swatches existed', () => {
    // Settings hold it only as the active accent.
    expect(customSwatches([], PINK, accent)).toEqual([PINK]);
    expect(customSwatches([TEAL], PINK, accent)).toEqual([TEAL, PINK]);
  });

  it('never lists a preset or the same color twice', () => {
    expect(customSwatches([DEFAULT_ACCENT_COLOR, PINK, PINK.toUpperCase()], DEFAULT_ACCENT_COLOR.toUpperCase(), accent)).toEqual([PINK]);
  });

  it('keeps the newest few', () => {
    const stored = [PINK, TEAL, LIME, NAVY];
    expect(customSwatches(stored, PINK, accent)).toEqual(stored.slice(-MAX_CUSTOM_SWATCHES));
  });
});

describe('applyCustomSwatch', () => {
  it('adds a swatch when a preset was active, so the preset is not lost and nothing is replaced', () => {
    expect(applyCustomSwatch([PINK], DEFAULT_ACCENT_COLOR, TEAL, accent)).toEqual([PINK, TEAL]);
    expect(applyCustomSwatch([], DEFAULT_ACCENT_COLOR, PINK, accent)).toEqual([PINK]);
  });

  it('changes the active swatch in place when the user tweaks one of their own', () => {
    expect(applyCustomSwatch([PINK, TEAL, LIME], TEAL, NAVY, accent)).toEqual([PINK, NAVY, LIME]);
  });

  it('only selects a preset or a swatch that already exists', () => {
    expect(applyCustomSwatch([PINK, TEAL], PINK, DEFAULT_ACCENT_COLOR, accent)).toEqual([PINK, TEAL]);
    expect(applyCustomSwatch([PINK, TEAL], PINK, TEAL.toUpperCase(), accent)).toEqual([PINK, TEAL]);
    expect(applyCustomSwatch([PINK], PINK, PINK, accent)).toEqual([PINK]);
  });

  it('drops the oldest swatch when a new one goes over the limit', () => {
    expect(applyCustomSwatch([PINK, TEAL, LIME], DEFAULT_ACCENT_COLOR, NAVY, accent)).toEqual([TEAL, LIME, NAVY]);
  });
});

describe('removeCustomSwatch and sameSwatches', () => {
  it('removes one swatch, whatever its case', () => {
    expect(removeCustomSwatch([PINK, TEAL], PINK.toUpperCase(), accent)).toEqual([TEAL]);
    expect(removeCustomSwatch([PINK], TEAL, accent)).toEqual([PINK]);
  });

  it('compares lists entry by entry', () => {
    expect(sameSwatches([PINK, TEAL], [PINK.toUpperCase(), TEAL], accent)).toBe(true);
    expect(sameSwatches([PINK, TEAL], [TEAL, PINK], accent)).toBe(false);
    expect(sameSwatches([PINK], [PINK, TEAL], accent)).toBe(false);
  });
});

describe('background glow swatches', () => {
  const preset = { from: BACKGROUND_GRADIENT_PRESETS[0].from, to: BACKGROUND_GRADIENT_PRESETS[0].to };
  const mine = { from: PINK, to: TEAL };
  const other = { from: LIME, to: NAVY };

  it('follows the same rules with a pair of colors', () => {
    expect(customSwatches([], mine, glow)).toEqual([mine]);
    expect(customSwatches([mine], null, glow)).toEqual([mine]);
    expect(customSwatches([preset], preset, glow)).toEqual([]);
    // From no glow or a preset: add. From one of the user's own: change it.
    expect(applyCustomSwatch([mine], null, other, glow)).toEqual([mine, other]);
    expect(applyCustomSwatch([mine], preset, other, glow)).toEqual([mine, other]);
    expect(applyCustomSwatch([mine], mine, other, glow)).toEqual([other]);
    expect(applyCustomSwatch([mine], mine, preset, glow)).toEqual([mine]);
  });

  it('treats a glow with its corners swapped as a different glow', () => {
    expect(applyCustomSwatch([mine], null, { from: TEAL, to: PINK }, glow)).toEqual([mine, { from: TEAL, to: PINK }]);
  });
});
