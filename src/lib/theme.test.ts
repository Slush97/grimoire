// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme } from './applyTheme';
import { THEME_ARGUMENT_PREFIX, nativeThemeSource, normalizeTheme, themeFromArguments, windowBackgroundColor } from './theme';

describe('applyTheme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('marks the document with a non-default theme', () => {
    applyTheme('oled');
    expect(document.documentElement.dataset.theme).toBe('oled');

    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('removes the marker for the default dark theme', () => {
    document.documentElement.dataset.theme = 'light';

    applyTheme('dark');

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe('theme', () => {
  it('keeps a saved theme and maps the old OLED toggle onto one', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('light', true)).toBe('light');
    expect(normalizeTheme(undefined, true)).toBe('oled');
    expect(normalizeTheme(undefined, false)).toBe('dark');
    expect(normalizeTheme('sepia')).toBe('dark');
  });

  it('matches the Electron window to the painted canvas', () => {
    expect(windowBackgroundColor('oled')).toBe('#000000');
    expect(windowBackgroundColor('dark')).toBe('#0f0f0f');
    expect(windowBackgroundColor('light')).toBe('#f1efea');
    expect(windowBackgroundColor(undefined)).toBe('#0f0f0f');
  });

  it('draws the OS chrome light only for the light theme', () => {
    expect(nativeThemeSource('light')).toBe('light');
    expect(nativeThemeSource('oled')).toBe('dark');
    expect(nativeThemeSource('dark')).toBe('dark');
  });

  it('reads the theme main passes on the command line', () => {
    expect(themeFromArguments(['app', `${THEME_ARGUMENT_PREFIX}light`])).toBe('light');
    expect(themeFromArguments(['app'])).toBe('dark');
    expect(themeFromArguments([`${THEME_ARGUMENT_PREFIX}nope`])).toBe('dark');
  });
});
