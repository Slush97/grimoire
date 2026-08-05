import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, accentForeground, accentInk, contrastRatio } from './accentColor';

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
