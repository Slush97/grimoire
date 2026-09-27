import type { UnknownModFilterGuess } from '../../../types/mod';

export type FoundUnknownMatch = UnknownModFilterGuess['crcMatch'] & { status: 'found' };

export function isFoundUnknownMatch(match: UnknownModFilterGuess['crcMatch'] | undefined): match is FoundUnknownMatch {
  return match?.status === 'found';
}
