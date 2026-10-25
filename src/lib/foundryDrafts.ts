import { z } from 'zod';
import type { MovementFxChoice } from './movementFx';

const PREFIX = 'grimoire.foundry.draft.v1:';

export function foundryDraftKey(scope: string, key: string): string {
  return `${PREFIX}${JSON.stringify([scope, key])}`;
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
