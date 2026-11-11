// This module is imported by the main process, whose tsconfig has no DOM lib,
// so it must stay document-free; the DOM half of the theme switch lives in
// applyTheme.ts.

/** Dark is the default look, OLED moves its surfaces to true black, light
 *  flips surfaces and ink. The token sets live in index.css. */
export const APP_THEMES = ['dark', 'oled', 'light'] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export const DEFAULT_THEME: AppTheme = 'dark';

/** The app's base background (--color-bg-primary in index.css) per theme,
 *  painted under the glow in preview tiles and behind the native window. */
const BACKGROUND_BASES: Record<AppTheme, string> = {
  dark: '#0f0f0f',
  oled: '#000000',
  light: '#f1efea',
};

export const BACKGROUND_BASE = BACKGROUND_BASES.dark;

/** A saved theme, or the one the old `oledMode` toggle stood for when the
 *  settings file predates the theme setting. */
export function normalizeTheme(value: unknown, legacyOledMode?: unknown): AppTheme {
  if ((APP_THEMES as readonly unknown[]).includes(value)) return value as AppTheme;
  return legacyOledMode === true ? 'oled' : DEFAULT_THEME;
}

/** Native window background (pre-paint flash, resize gutters) matching the
 *  painted canvas. */
export function windowBackgroundColor(theme: AppTheme | null | undefined): string {
  return BACKGROUND_BASES[theme ?? DEFAULT_THEME] ?? BACKGROUND_BASE;
}

/** What the OS draws around the page: title bar, native menus, dialogs. */
export function nativeThemeSource(theme: AppTheme | null | undefined): 'dark' | 'light' {
  return theme === 'light' ? 'light' : 'dark';
}

/** Flag main adds to the renderer's argv so the preload can hand the saved
 *  theme over before the settings IPC round-trip. */
export const THEME_ARGUMENT_PREFIX = '--grimoire-theme=';

export function themeFromArguments(argv: readonly string[]): AppTheme {
  const argument = argv.find((value) => value.startsWith(THEME_ARGUMENT_PREFIX));
  return normalizeTheme(argument?.slice(THEME_ARGUMENT_PREFIX.length));
}
