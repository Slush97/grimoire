import { describe, expect, it } from 'vitest';
import { hiddenEntryKey, hideCreatorNow, withHiddenNote } from './hiddenContent';
import { HIDDEN_NOTE_MAX_LENGTH, type HiddenCreator, type HiddenMod } from '../types/mod';

describe('hiddenEntryKey', () => {
  it('tells apart equal ids in different GameBanana sections, and creators from mods', () => {
    expect(hiddenEntryKey({ id: 42, section: 'Mod' })).toBe('Mod:42');
    expect(hiddenEntryKey({ id: 42, section: 'Sound' })).toBe('Sound:42');
    expect(hiddenEntryKey({ id: 42 })).toBe(':42');
  });
});

describe('withHiddenNote', () => {
  const mod: HiddenMod = { id: 1, name: 'Win Probability', section: 'Mod', hiddenAt: 5 };

  it('stores a trimmed note and keeps the rest of the entry', () => {
    expect(withHiddenNote(mod, '  breaks the HUD  ')).toEqual({ ...mod, note: 'breaks the HUD' });
  });

  it('removes the note when it is cleared', () => {
    const noted = { ...mod, note: 'old' };
    expect(withHiddenNote(noted, '   ')).toEqual(mod);
    expect('note' in withHiddenNote(noted, '')).toBe(false);
    expect(noted.note).toBe('old');
  });

  it('cuts a note at the stored length', () => {
    expect(withHiddenNote(mod, 'x'.repeat(HIDDEN_NOTE_MAX_LENGTH + 20)).note).toHaveLength(HIDDEN_NOTE_MAX_LENGTH);
  });
});

describe('hideCreatorNow', () => {
  const creator: HiddenCreator = { id: 7, name: 'Krak4n' };

  it('records when the creator was hidden and the mod of theirs it was hidden from', () => {
    expect(hideCreatorNow(creator, { id: 99, name: 'Some Skin', section: 'Mod', submitterId: 7 }, 1234)).toEqual({
      id: 7, name: 'Krak4n', hiddenAt: 1234, fromMod: { id: 99, name: 'Some Skin', section: 'Mod' },
    });
  });

  it('leaves the mod out when it is someone else\'s or there is none', () => {
    // Hidden from their artist page while another creator's details were open underneath.
    expect(hideCreatorNow(creator, { id: 99, name: 'Other Skin', section: 'Mod', submitterId: 8 }, 1234))
      .toEqual({ id: 7, name: 'Krak4n', hiddenAt: 1234 });
    expect(hideCreatorNow(creator, null, 1234)).toEqual({ id: 7, name: 'Krak4n', hiddenAt: 1234 });
  });

  it('drops a stale note or context carried on the request', () => {
    const stale = { ...creator, note: 'from an earlier hide', fromMod: { id: 1, name: 'Old', section: 'Mod' } };
    expect(hideCreatorNow(stale, undefined, 1234)).toEqual({ id: 7, name: 'Krak4n', hiddenAt: 1234 });
  });
});
