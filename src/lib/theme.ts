// Electron's nativeTheme is the source of truth: it makes this media query
// resolve to the saved override, or to the OS preference in system mode.
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Mirror the currently resolved color scheme onto the root element. */
export function applyResolvedTheme(): void {
  document.documentElement.dataset.theme = window.matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light';
}

/** Apply the theme and subscribe to setting/OS changes. Returns its cleanup. */
export function initThemeSync(): () => void {
  const mediaQuery = window.matchMedia(DARK_QUERY);
  const apply = () => {
    document.documentElement.dataset.theme = mediaQuery.matches ? 'dark' : 'light';
  };

  apply();
  mediaQuery.addEventListener('change', apply);
  return () => mediaQuery.removeEventListener('change', apply);
}
