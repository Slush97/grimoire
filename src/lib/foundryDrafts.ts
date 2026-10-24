import { z } from 'zod';

const PREFIX = 'grimoire.foundry.draft.v1:';

export function foundryDraftKey(scope: string, key: string): string {
  return `${PREFIX}${JSON.stringify([scope, key])}`;
}

export function readFoundryDraft<T>(storage: Pick<Storage, 'getItem'>, key: string, schema: z.ZodType<T>): T | undefined {
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
