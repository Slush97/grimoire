import type { AppSettings } from '../types/mod';

export function getActiveDeadlockPath(settings: AppSettings | null): string | null {
  if (!settings) return null;
  if (settings.devMode) return settings.devDeadlockPath;
  return settings.deadlockPath;
}

/**
 * Whether NSFW thumbnails should be blurred on the surfaces that have no
 * blur control of their own (Locker, Discover, Profiles, the Discover sidebar
 * peek). Browse is deliberately excluded: it owns `browseNsfwContentMode`.
 *
 * The legacy `hideNsfwPreviews` key has no writer left (its only assignment is
 * the default), so reading it alone left these surfaces permanently blurred
 * with no way to change it. `installedHideNsfwPreviews` is the key the Settings
 * toggle actually writes, so it leads here and the legacy key stays only as the
 * migration fallback for installs that predate the split.
 */
export function shouldBlurNsfw(settings: AppSettings | null): boolean {
  return settings?.installedHideNsfwPreviews ?? settings?.hideNsfwPreviews ?? true;
}
