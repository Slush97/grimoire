import { describe, expect, it } from 'vitest';
import {
  ACCENT_PRESETS,
  accentForeground,
  accentInk,
  contrastRatio,
  DARK_INK_SURFACE,
  LIGHT_INK_SURFACE,
} from './accentColor';

describe('accent color contrast', () => {
  it('chooses readable foreground ink for every preset fill', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(contrastRatio(accentForeground(preset.color), preset.color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('produces AA accent ink for dark and light themed surfaces', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(contrastRatio(accentInk(preset.color, '#242424'), '#242424')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accentInk(preset.color, '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accentInk(preset.hover, '#242424'), '#242424')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accentInk(preset.hover, '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });

  // Regression: the light ink used to be checked against pure white, which
  // left it under AA on the darker light surfaces (bg-tertiary, bg-sunken).
  it('produces ink that clears AA on every themed surface, not just cards', () => {
    const darkSurfaces = ['#0f0f0f', '#1a1a1a', '#141414', '#242424'];
    const lightSurfaces = ['#eeeeef', '#fafafa', '#f8f8f9', '#e4e4e7', '#dcdce0'];
    for (const preset of ACCENT_PRESETS) {
      for (const surface of darkSurfaces) {
        expect(contrastRatio(accentInk(preset.color, DARK_INK_SURFACE), surface)).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of lightSurfaces) {
        expect(contrastRatio(accentInk(preset.color, LIGHT_INK_SURFACE), surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('preserves an accent that already clears the target contrast', () => {
    expect(accentInk('#2563eb', '#ffffff')).toBe('#2563eb');
  });

  it('handles malformed colors without throwing', () => {
    expect(contrastRatio('invalid', '#ffffff')).toBe(1);
    expect(accentInk('invalid', '#ffffff')).toBe('#ffffff');
  });
});
