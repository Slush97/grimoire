import { HIDDEN_NOTE_MAX_LENGTH, type HiddenCreator } from '../types/mod';

/** Identity of a list row. Hidden mods carry a section because GameBanana
 *  numbers Mods, Sounds and WiPs separately; creators have none. */
export function hiddenEntryKey(entry: { id: number; section?: string }): string {
  return `${entry.section ?? ''}:${entry.id}`;
}

/** The entry with `note` as it is stored: trimmed, bounded, and absent when empty. */
export function withHiddenNote<T extends { note?: string }>(entry: T, note: string): T {
  const trimmed = note.trim().slice(0, HIDDEN_NOTE_MAX_LENGTH);
  const next = { ...entry };
  if (trimmed) next.note = trimmed;
  else delete next.note;
  return next;
}

/** The creator as it is stored when hidden now, remembering the mod it was hidden from. */
export function hideCreatorNow(
  creator: Pick<HiddenCreator, 'id' | 'name'>,
  from: { id: number; name: string; section: string; submitterId?: number } | null | undefined,
  now = Date.now(),
): HiddenCreator {
  const entry: HiddenCreator = { id: creator.id, name: creator.name, hiddenAt: now };
  // Only a mod of theirs explains the choice. The creator can also be hidden
  // from their artist page while some other mod's details sit underneath.
  if (from && from.submitterId === creator.id) entry.fromMod = { id: from.id, name: from.name, section: from.section };
  return entry;
}
