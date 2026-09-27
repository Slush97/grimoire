import type { AppSettings } from '../types/mod';

export function getActiveDeadlockPath(settings: AppSettings | null): string | null {
  if (!settings) return null;
  if (settings.devMode) return settings.devDeadlockPath;
  return settings.deadlockPath;
}

/** Whether NSFW thumbnails are covered. `hide` also covers them: surfaces that
 *  can't drop a mod outright (your installed mods, Locker) fall back to blur. */
export function shouldBlurNsfw(settings: AppSettings | null): boolean {
  return (settings?.nsfwContentMode ?? 'blur') !== 'show';
}
