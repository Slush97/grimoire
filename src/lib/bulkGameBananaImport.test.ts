import { describe, expect, it } from 'vitest';
import {
  classifyGameBananaImportInput,
  MAX_BULK_GAMEBANANA_LINKS,
  parseBulkGameBananaLinks,
} from './bulkGameBananaImport';

describe('parseBulkGameBananaLinks', () => {
  it('parses supported GameBanana item links pasted across lines or spaces', () => {
    const result = parseBulkGameBananaLinks(`
      https://gamebanana.com/mods/655750
      https://gamebanana.com/sounds/86259 https://gamebanana.com/wips/123
    `);

    expect(result.items).toEqual([
      { id: 655750, section: 'Mod', url: 'https://gamebanana.com/mods/655750' },
      { id: 86259, section: 'Sound', url: 'https://gamebanana.com/sounds/86259' },
      { id: 123, section: 'Wip', url: 'https://gamebanana.com/wips/123' },
    ]);
    expect(result.invalidInputs).toEqual([]);
    expect(result.duplicateCount).toBe(0);
    expect(result.overflowCount).toBe(0);
  });

  it('deduplicates the same item and reports unsupported or malformed entries', () => {
    const result = parseBulkGameBananaLinks(`
      <https://gamebanana.com/mods/655750>
      https://gamebanana.com/mods/655750?ref=discord
      https://gamebanana.com/collections/123
      https://example.com/mods/456
      not-a-link
    `);

    expect(result.items).toEqual([
      { id: 655750, section: 'Mod', url: 'https://gamebanana.com/mods/655750' },
    ]);
    expect(result.invalidInputs).toEqual([
      'https://gamebanana.com/collections/123',
      'https://example.com/mods/456',
      'not-a-link',
    ]);
    expect(result.duplicateCount).toBe(1);
  });

  it('caps a paste before it can resolve an unbounded number of API requests', () => {
    const input = Array.from(
      { length: MAX_BULK_GAMEBANANA_LINKS + 3 },
      (_, index) => `https://gamebanana.com/mods/${index + 1}`,
    ).join('\n');

    const result = parseBulkGameBananaLinks(input);

    expect(result.items).toHaveLength(MAX_BULK_GAMEBANANA_LINKS);
    expect(result.overflowCount).toBe(3);
  });
});

describe('classifyGameBananaImportInput', () => {
  it('routes a collection URL or numeric id to collection import', () => {
    expect(classifyGameBananaImportInput('https://gamebanana.com/collections/164637')).toEqual({
      kind: 'collection',
      collectionId: 164637,
    });
    expect(classifyGameBananaImportInput('164637')).toEqual({
      kind: 'collection',
      collectionId: 164637,
    });
  });

  it('routes a list of item links to bulk import', () => {
    const result = classifyGameBananaImportInput(`
      https://gamebanana.com/mods/655750
      https://gamebanana.com/sounds/86259
    `);

    expect(result.kind).toBe('links');
    if (result.kind !== 'links') throw new Error('Expected links');
    expect(result.result.items).toHaveLength(2);
  });

  it('keeps item links from a mixed paste and reports the collection link as skipped', () => {
    const result = classifyGameBananaImportInput(`
      https://gamebanana.com/mods/2
      https://gamebanana.com/collections/123
    `);

    expect(result.kind).toBe('links');
    if (result.kind !== 'links') throw new Error('Expected links');
    expect(result.result.items).toEqual([
      { id: 2, section: 'Mod', url: 'https://gamebanana.com/mods/2' },
    ]);
    expect(result.result.invalidInputs).toEqual(['https://gamebanana.com/collections/123']);
  });

  it('reports input containing neither a collection nor item links as invalid', () => {
    expect(classifyGameBananaImportInput('https://gamebanana.com/members/123').kind).toBe('invalid');
  });
});
