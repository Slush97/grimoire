import type { AppSettings } from '../types/mod';

export function getActiveDeadlockPath(settings: AppSettings | null): string | null {
  if (!settings) return null;
  if (settings.devMode) return settings.devDeadlockPath;
  return settings.deadlockPath;
}

/** Installation-scoped UI preferences never cross normal/developer libraries. */
export function getInstallationScope(settings: AppSettings | null): string | null {
  const path = getActiveDeadlockPath(settings);
  if (!path) return null;
  const root = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return JSON.stringify([settings?.devMode ?? false, /^[a-z]:\/|^\/\//i.test(root) ? root.toLowerCase() : root]);
}

/** Whether NSFW thumbnails are covered. `hide` also covers them: surfaces that
 *  can't drop a mod outright (your installed mods, Locker) fall back to blur. */
export function shouldBlurNsfw(settings: AppSettings | null): boolean {
  return (settings?.nsfwContentMode ?? 'blur') !== 'show';
}
