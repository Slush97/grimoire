import { DEFAULT_THEME, type AppTheme } from './theme';

// Split from theme.ts deliberately: that module is imported by the main
// process (no DOM lib in tsconfig.node), so the document-touching half lives
// in this renderer-only file.
export function applyTheme(theme: AppTheme | null | undefined): void {
  const root = document.documentElement;
  if (!theme || theme === DEFAULT_THEME) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}
