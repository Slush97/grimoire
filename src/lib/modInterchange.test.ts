import { describe, it, expect } from 'vitest';
import { isPlainVpkName, parseInterchangeDocument } from './modInterchange';

const doc = (mods: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'deadlock-mod-interchange', version: 1, mods, ...extra });

describe('parseInterchangeDocument', () => {
  it('keeps good entries and reports broken ones instead of failing', () => {
    const parsed = parseInterchangeDocument(
      doc([
        {
          key: 'gamebanana:mod:1',
          name: 'A',
          enabled: true,
          order: 3,
          origin: { provider: 'gamebanana', submissionType: 'mod', submissionId: 1, fileId: 9 },
          files: [{ name: 'a_dir.vpk', path: 'files/a/a_dir.vpk' }, { name: 'broken' }],
          futureField: 'ignored',
        },
        { key: 'x', name: 'B', origin: { provider: 'somewhere-else' } },
        { key: 'gamebanana:mod:1', name: 'dup', origin: { provider: 'local' } },
        { name: 'no key', origin: { provider: 'local' } },
      ])
    );
    expect(parsed.mods).toHaveLength(1);
    expect(parsed.mods[0].origin).toEqual({
      provider: 'gamebanana',
      submissionType: 'mod',
      submissionId: '1',
      fileId: 9,
      fileName: undefined,
    });
    expect(parsed.mods[0].files).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(3);
    expect(parsed.source.manager).toBe('unknown');
  });

  it('rejects other formats and future major versions', () => {
    expect(() => parseInterchangeDocument('{"format":"x","version":1}')).toThrow(/Not a mod interchange/);
    expect(() => parseInterchangeDocument(doc([], { version: 2 }))).toThrow(/Unsupported interchange version/);
    expect(() => parseInterchangeDocument('nope')).toThrow(/not valid JSON/);
  });
});

describe('isPlainVpkName', () => {
  it('accepts only a single vpk file name', () => {
    expect(isPlainVpkName('pak01_dir.vpk')).toBe(true);
    expect(isPlainVpkName('../x.vpk')).toBe(false);
    expect(isPlainVpkName('a\\b.vpk')).toBe(false);
    expect(isPlainVpkName('readme.txt')).toBe(false);
  });
});
