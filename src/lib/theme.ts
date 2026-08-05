import { useSyncExternalStore } from 'react';

// Electron's nativeTheme is the source of truth: it makes this media query
// resolve to the saved override, or to the OS preference in system mode.
const DARK_QUERY = '(prefers-color-scheme: dark)';

export type ResolvedTheme = 'dark' | 'light';

function resolveTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function subscribeTheme(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia(DARK_QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

/** Mirror the currently resolved color scheme onto the root element. */
export function applyResolvedTheme(): void {
  document.documentElement.dataset.theme = resolveTheme();
}

/** Apply the theme and subscribe to setting/OS changes. Returns its cleanup. */
export function initThemeSync(): () => void {
  applyResolvedTheme();
  return subscribeTheme(applyResolvedTheme);
}

/**
 * Resolved theme as React state.
 *
 * CSS handles theming on its own, so components almost never need this. It
 * exists for canvas/WebGL surfaces that sample theme custom properties with
 * `getComputedStyle` at paint time: those read once and would otherwise keep
 * stale colors after a theme flip, because no React state changed.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, resolveTheme, () => 'dark');
}
