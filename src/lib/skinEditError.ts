import { isGameRunningModLockError } from './modLocks';

/** The error text without Electron's IPC wrapper and the `Error:` prefixes it stacks up. */
export function skinEditErrorDetail(reason: unknown): string {
  return String(reason)
    .replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*/, '')
    .replace(/^(?:\w*Error:\s*)+/, '')
    .trim();
}

/**
 * What to tell a player when the skin editor fails. The main process throws plain sentences for the
 * problems a player can fix; anything else (validation dumps, stack traces, tool output) becomes a
 * calm fallback, with the raw text left for a tooltip.
 */
export function skinEditErrorMessage(reason: unknown, t: (key: string) => string): string {
  if (isGameRunningModLockError(reason)) return t('common.gameRunningWarning');
  const detail = skinEditErrorDetail(reason);
  if (/\bENOSPC\b/.test(detail)) return t('foundry.skin.errors.diskFull');
  if (/\b(?:EBUSY|EPERM|EACCES)\b/.test(detail)) return t('foundry.skin.errors.fileBusy');
  const sentence = /^[A-Z][^{}[\]`\n\\/]*[.!?]$/.test(detail) && detail.length <= 240;
  return sentence ? detail : t('foundry.skin.errors.generic');
}
