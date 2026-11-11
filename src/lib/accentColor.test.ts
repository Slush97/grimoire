// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyAccentColor, normalizeHex } from './accentColor';

describe('normalizeHex', () => {
  it('expands the three-digit shorthand and lowercases', () => {
    expect(normalizeHex('#f60')).toBe('#ff6600');
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
  });

  it('lowercases a six-digit color and leaves anything else alone', () => {
    expect(normalizeHex('#FF6600')).toBe('#ff6600');
    expect(normalizeHex('#ff66')).toBe('#ff66');
    expect(normalizeHex('not a color')).toBe('not a color');
  });
});

describe('applyAccentColor', () => {
  const root = document.documentElement;

  afterEach(() => {
    for (const name of ['--color-accent', '--color-accent-hover', '--color-accent-foreground']) root.style.removeProperty(name);
  });

  it('writes a full hex and a real hover color for a shorthand pick', () => {
    applyAccentColor('#f60');

    expect(root.style.getPropertyValue('--color-accent')).toBe('#ff6600');
    expect(root.style.getPropertyValue('--color-accent-hover')).toBe('#e05a00');
    expect(root.style.getPropertyValue('--color-accent-foreground')).toBe('#ffffff');
  });

  it('keeps the curated hover for a preset, whatever the case', () => {
    applyAccentColor('#F97316');

    expect(root.style.getPropertyValue('--color-accent')).toBe('#f97316');
    expect(root.style.getPropertyValue('--color-accent-hover')).toBe('#ea580c');
  });
});
