import type { AppSettings } from '../types/mod';

export function getActiveDeadlockPath(settings: AppSettings | null): string | null {
  if (!settings) return null;
  if (settings.devMode) return settings.devDeadlockPath;
  return settings.deadlockPath;
}
