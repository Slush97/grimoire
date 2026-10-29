import { z } from 'zod';
import type { MovementFxChoice } from './movementFx';

const PREFIX = 'grimoire.foundry.draft.v1:';

/** Drafts belong to the active game install (the dev copy while dev mode is on). */
export function foundryDraftScope(settings: { devMode?: boolean; devDeadlockPath?: string | null; deadlockPath?: string | null } | null | undefined): string {
  return settings?.devMode && settings.devDeadlockPath ? settings.devDeadlockPath : settings?.deadlockPath ?? '';
}

export function foundryDraftKey(scope: string, key: string): string {
  return `${PREFIX}${JSON.stringify([scope, key])}`;
}

/** The scope and key of a storage key made by foundryDraftKey, or null for any other key. */
export function parseFoundryDraftKey(storageKey: string): { scope: string; key: string } | null {
  if (!storageKey.startsWith(PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(storageKey.slice(PREFIX.length));
    return Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string' ? { scope: parsed[0], key: parsed[1] } : null;
  } catch { return null; }
}

export function readFoundryDraft<T>(storage: Pick<Storage, 'getItem'>, key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | undefined {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function writeFoundryDraft(storage: Pick<Storage, 'setItem'>, key: string, value: unknown): boolean {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** An explicit Installed action restores only this effect's draft and editor mode. */
export function restoreMovementFxDraft(storage: Pick<Storage, 'setItem'>, scope: string, choice: MovementFxChoice): boolean {
  const entries: Array<[string, unknown]> = [
    [`movement:${choice.kind}:choice`, choice],
    ['movement:kind', choice.kind],
    ['workshop:section', 'abilities'],
    ['workshop:ability', 'movement'],
    ['page:mode', 'heroes'],
  ];
  return entries.every(([key, value]) => writeFoundryDraft(storage, foundryDraftKey(scope, key), value));
}
