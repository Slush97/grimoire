import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { foundryDraftKey, readFoundryDraft, writeFoundryDraft } from './foundryDrafts';

describe('local Door Stuck drafts', () => {
  it('isolates installations and heroes and validates restored values', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const key = foundryDraftKey('game-a', 'Mina');
    expect(writeFoundryDraft(storage, key, { name: 'My draft' })).toBe(true);
    const schema = z.object({ name: z.string() }).strict();
    expect(readFoundryDraft(storage, key, schema)).toEqual({ name: 'My draft' });
    expect(readFoundryDraft(storage, foundryDraftKey('game-b', 'Mina'), schema)).toBeUndefined();
    expect(readFoundryDraft(storage, foundryDraftKey('game-a', 'Bebop'), schema)).toBeUndefined();
    expect(readFoundryDraft(storage, key, z.number())).toBeUndefined();
    storage.setItem(key, '{bad'); expect(readFoundryDraft(storage, key, schema)).toBeUndefined();
  });
  it('reports a full or unavailable storage instead of throwing away the session', () => {
    expect(writeFoundryDraft({ setItem: () => { throw new Error('Quota'); } }, 'draft', {})).toBe(false);
    expect(readFoundryDraft({ getItem: () => { throw new Error('Unavailable'); } }, 'draft', z.string())).toBeUndefined();
  });
});
