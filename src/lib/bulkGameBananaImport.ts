import {
  parseCollectionId,
  parseGameBananaItemUrl,
  type GameBananaItemRef,
} from '../types/gamebanana';

export const MAX_BULK_GAMEBANANA_LINKS = 100;

export interface BulkGameBananaItem extends GameBananaItemRef {
  url: string;
}

export interface BulkGameBananaParseResult {
  items: BulkGameBananaItem[];
  invalidInputs: string[];
  duplicateCount: number;
  overflowCount: number;
}

export type GameBananaImportInput =
  | { kind: 'collection'; collectionId: number }
  | { kind: 'links'; result: BulkGameBananaParseResult }
  | { kind: 'invalid'; result: BulkGameBananaParseResult };

const SECTION_PATH: Record<string, string> = {
  Mod: 'mods',
  Sound: 'sounds',
  Wip: 'wips',
};

function cleanPastedToken(token: string): string {
  return token.replace(/^[<([{`"']+|[>\])}`"';:.]+$/g, '');
}

/**
 * Turn a Discord/message-style paste into the supported GameBanana items that
 * Grimoire can resolve. The parser deliberately reports bad tokens instead of
 * silently dropping them, so the import preview can explain partial results.
 */
export function parseBulkGameBananaLinks(input: string): BulkGameBananaParseResult {
  const items: BulkGameBananaItem[] = [];
  const invalidInputs: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let overflowCount = 0;

  for (const rawToken of input.split(/[\s,]+/)) {
    const token = cleanPastedToken(rawToken.trim());
    if (!token) continue;

    const ref = parseGameBananaItemUrl(token);
    if (!ref) {
      invalidInputs.push(token);
      continue;
    }

    const key = `${ref.section}:${ref.id}`;
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);

    if (items.length >= MAX_BULK_GAMEBANANA_LINKS) {
      overflowCount += 1;
      continue;
    }

    items.push({
      ...ref,
      url: `https://gamebanana.com/${SECTION_PATH[ref.section]}/${ref.id}`,
    });
  }

  return { items, invalidInputs, duplicateCount, overflowCount };
}

/** Decide which existing import workflow owns a single shared paste field. */
export function classifyGameBananaImportInput(input: string): GameBananaImportInput {
  // Only a lone token can be a collection: parseCollectionId is unanchored and
  // would otherwise swallow a mixed paste, silently dropping every item link.
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 1) {
    const collectionId = parseCollectionId(tokens[0]);
    if (collectionId !== null) return { kind: 'collection', collectionId };
  }

  const result = parseBulkGameBananaLinks(input);
  return result.items.length > 0 ? { kind: 'links', result } : { kind: 'invalid', result };
}
