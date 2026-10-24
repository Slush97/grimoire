import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { foundryDraftKey, readFoundryDraft, restoreMovementFxDraft, writeFoundryDraft } from './foundryDrafts';
import { movementFxSchema } from './movementFx';

describe('local Door Stuck drafts', () => {
  it('restores the selected movement recipe and mode without replacing another effect or hero', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const key = (value: string) => foundryDraftKey('game-a', value);
    const dash = movementFxSchema.parse({ kind: 'dash', color: '#ff00ff', image: 'data:image/png;base64,AAAA', palette: { mode: 'gradient', end: '#00ffff' }, illuminated: true, outline: true, brightness: 2 });
    const melee = movementFxSchema.parse({ kind: 'heavy-melee', color: '#abcdef', image: null });
    writeFoundryDraft(storage, key('page:hero'), 'lash');
    expect(restoreMovementFxDraft(storage, 'game-a', dash)).toBe(true);
    expect(restoreMovementFxDraft(storage, 'game-a', melee)).toBe(true);
    expect(readFoundryDraft(storage, key('movement:dash:choice'), movementFxSchema)).toEqual(dash);
    expect(readFoundryDraft(storage, key('movement:heavy-melee:choice'), movementFxSchema)).toEqual(melee);
    expect(readFoundryDraft(storage, key('movement:kind'), z.string())).toBe('heavy-melee');
    expect(readFoundryDraft(storage, key('workshop:section'), z.string())).toBe('abilities');
    expect(readFoundryDraft(storage, key('workshop:ability'), z.string())).toBe('movement');
    expect(readFoundryDraft(storage, key('page:mode'), z.string())).toBe('heroes');
    expect(readFoundryDraft(storage, key('page:hero'), z.string())).toBe('lash');
    expect(readFoundryDraft(storage, foundryDraftKey('game-b', 'movement:kind'), z.string())).toBeUndefined();
    expect(restoreMovementFxDraft({ setItem: () => { throw new Error('Quota'); } }, 'game-a', dash)).toBe(false);
  });
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
