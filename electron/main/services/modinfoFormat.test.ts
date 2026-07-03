/**
 * Unit coverage for the vpk-modinfo v1 format module: the addoninfo.txt
 * serializer (new key set, single-line enforcement), the modinfo.json
 * serializer/parser round-trip, parseModinfo's reject-on-malformed behavior,
 * and computeOriginalIdentity. Serializers and the parser are pure; only
 * computeOriginalIdentity touches disk (via fingerprintFile/crc32File, both
 * electron-free), so it gets a real temp file instead of a mock.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  serializeAddonInfo,
  serializeModinfo,
  parseModinfo,
  computeOriginalIdentity,
  findImprintRepackMismatch,
  ADDONINFO_ENTRY,
  MODINFO_ENTRY,
  MODINFO_FORMAT,
  MODINFO_GAME,
  MODINFO_SCHEMA_VERSION,
  type AddonInfoFields,
  type ModinfoModRecord,
  type ModinfoMergeRecord,
} from './modinfoFormat';
import type { VpkEntryStat } from './vpk';

function fields(over: Partial<AddonInfoFields> = {}): AddonInfoFields {
  return {
    title: 'My Mod',
    author: 'Some Author',
    buildDate: '2026-01-01T00:00:00.000Z',
    originalSha256: 'a'.repeat(64),
    ...over,
  };
}

function modRecord(over: Partial<ModinfoModRecord> = {}): ModinfoModRecord {
  return {
    format: MODINFO_FORMAT,
    schemaVersion: MODINFO_SCHEMA_VERSION,
    kind: 'mod',
    writtenBy: { tool: 'grimoire', version: '1.22.0' },
    writtenAt: '2026-07-03T12:00:00.000Z',
    firstImprintedAt: '2026-01-01T00:00:00.000Z',
    game: MODINFO_GAME,
    identity: { sha256: 'a'.repeat(64), size: 4096, crc32: 'deadbeef' },
    title: 'My Mod',
    ...over,
  };
}

function mergeRecord(over: Partial<ModinfoMergeRecord> = {}): ModinfoMergeRecord {
  return {
    format: MODINFO_FORMAT,
    schemaVersion: MODINFO_SCHEMA_VERSION,
    kind: 'merge',
    writtenBy: { tool: 'grimoire', version: '1.22.0' },
    writtenAt: '2026-07-03T12:00:00.000Z',
    firstImprintedAt: '2026-07-03T12:00:00.000Z',
    game: MODINFO_GAME,
    identity: { sha256: 'b'.repeat(64), size: 8192 },
    title: 'My Merge',
    author: 'Multiple (merged)',
    merge: { title: 'My Merge' },
    sources: [
      {
        title: 'Source One',
        identity: { sha256: 'c'.repeat(64) },
        gamebananaId: 123,
        gamebananaFileId: 456,
        section: 'Mod',
        priorityAtMergeTime: 1,
        enabledAtMergeTime: true,
        fileNameAtMergeTime: 'pak01_dir.vpk',
        vpkIndex: 0,
      },
      {
        title: 'Source Two',
        identity: { sha256: undefined },
        priorityAtMergeTime: 2,
        enabledAtMergeTime: false,
        fileNameAtMergeTime: 'local_mod.vpk',
      },
    ],
    ...over,
  };
}

describe('serializeAddonInfo', () => {
  it('emits the exact KV1 shape with the v1 key order and the trailing schema marker', () => {
    const out = serializeAddonInfo(
      fields({
        gamebananaId: '123',
        gamebananaFileId: '456',
        sourceUrl: 'https://gamebanana.com/mods/123',
        originalSize: 4096,
        originalCrc32: 'deadbeef',
      })
    );
    expect(out).toBe(
      [
        '"AddonInfo"',
        '{',
        '    addonversion "1.0"',
        '    addontitle "My Mod"',
        '    addonauthor "Some Author"',
        '    gamebananaId "123"',
        '    gamebananaFileId "456"',
        '    sourceUrl "https://gamebanana.com/mods/123"',
        '    buildDate "2026-01-01T00:00:00.000Z"',
        '    originalSha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
        '    originalSize "4096"',
        '    originalCrc32 "deadbeef"',
        '    modinfoVersion "1"',
        '}',
        '',
      ].join('\n')
    );
  });

  it('omits undefined and empty-string optional fields entirely', () => {
    const out = serializeAddonInfo(
      fields({ author: undefined, gamebananaId: '', sourceUrl: undefined })
    );
    expect(out).not.toContain('addonauthor');
    expect(out).not.toContain('gamebananaId');
    expect(out).not.toContain('sourceUrl');
    expect(out).not.toContain('originalSize');
    expect(out).not.toContain('originalCrc32');
  });

  it('enforces single-line values: control characters collapse to spaces', () => {
    const out = serializeAddonInfo(fields({ title: 'Line one\nLine two\ttabbed\r\n end' }));
    expect(out).toContain('addontitle "Line one Line two tabbed end"');
    // No raw control characters survive anywhere in the output values.
    const valueLines = out.split('\n').filter((line) => line.startsWith('    '));
    for (const line of valueLines) {
      expect(line).not.toMatch(/[\t\r]/);
    }
  });

  it('escapes embedded double quotes and backslashes (backslash first)', () => {
    const out = serializeAddonInfo(fields({ title: 'C:\\Mods\\"Cool" Skin' }));
    expect(out).toContain('addontitle "C:\\\\Mods\\\\\\"Cool\\" Skin"');
  });

  it('always writes the modinfoVersion marker last, before the closing brace', () => {
    const lines = serializeAddonInfo(fields()).split('\n');
    const close = lines.indexOf('}');
    expect(lines[close - 1]).toBe('    modinfoVersion "1"');
  });
});

describe('serializeModinfo / parseModinfo round-trip', () => {
  it('round-trips a full kind:"mod" record', () => {
    const record = modRecord({
      author: 'Author Name',
      description: 'A long\nmulti-line description that lives in JSON only.',
      source: {
        gamebananaId: 123,
        gamebananaFileId: 456,
        url: 'https://gamebanana.com/mods/123',
        section: 'Mod',
        categoryId: 33295,
        categoryName: 'Skins',
      },
      packaging: { vpkIndex: 1, variantLabel: 'Gold' },
    });
    const parsed = parseModinfo(serializeModinfo(record));
    expect(parsed).toEqual(record);
  });

  it('round-trips a minimal kind:"mod" record (no author/source/packaging)', () => {
    const record = modRecord();
    const parsed = parseModinfo(serializeModinfo(record));
    expect(parsed).toEqual(record);
  });

  it('round-trips a kind:"merge" record including per-source vpkIndex', () => {
    const record = mergeRecord();
    const parsed = parseModinfo(serializeModinfo(record));
    expect(parsed).toEqual(record);
    expect(parsed?.kind).toBe('merge');
    if (parsed?.kind === 'merge') {
      expect(parsed.sources[0].vpkIndex).toBe(0);
      expect(parsed.sources[1].identity.sha256).toBeUndefined();
    }
  });

  it('serializes pretty-printed 2-space JSON with a trailing newline', () => {
    const text = serializeModinfo(modRecord());
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('  "format": "vpk-modinfo"');
  });

  it('lowercases the identity sha on parse', () => {
    const text = serializeModinfo(modRecord()).replace('a'.repeat(64), 'A'.repeat(64));
    expect(parseModinfo(text)?.identity.sha256).toBe('a'.repeat(64));
  });
});

describe('parseModinfo rejects malformed documents', () => {
  const valid = () => JSON.parse(serializeModinfo(modRecord())) as Record<string, unknown>;

  it('rejects non-JSON bytes', () => {
    expect(parseModinfo('not json at all')).toBeNull();
    expect(parseModinfo(Buffer.from([0xff, 0xfe, 0x00]))).toBeNull();
  });

  it('rejects a wrong format marker', () => {
    expect(parseModinfo(JSON.stringify({ ...valid(), format: 'grimoire-embedded-merge' }))).toBeNull();
  });

  it('rejects a wrong schema version', () => {
    expect(parseModinfo(JSON.stringify({ ...valid(), schemaVersion: 2 }))).toBeNull();
    expect(parseModinfo(JSON.stringify({ ...valid(), schemaVersion: '1' }))).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(parseModinfo(JSON.stringify({ ...valid(), kind: 'profile' }))).toBeNull();
  });

  it('rejects a malformed identity sha', () => {
    expect(parseModinfo(JSON.stringify({ ...valid(), identity: { sha256: 'nope' } }))).toBeNull();
    expect(parseModinfo(JSON.stringify({ ...valid(), identity: {} }))).toBeNull();
  });

  it('rejects missing required scalars (title / writtenAt / firstImprintedAt)', () => {
    for (const key of ['title', 'writtenAt', 'firstImprintedAt'] as const) {
      const doc = valid();
      delete doc[key];
      expect(parseModinfo(JSON.stringify(doc))).toBeNull();
    }
  });

  it('rejects a merge record without a merge block or sources', () => {
    const doc = JSON.parse(serializeModinfo(mergeRecord())) as Record<string, unknown>;
    expect(parseModinfo(JSON.stringify({ ...doc, merge: undefined }))).toBeNull();
    expect(parseModinfo(JSON.stringify({ ...doc, sources: undefined }))).toBeNull();
  });

  it('rejects a merge record with a structurally broken source entry', () => {
    const doc = JSON.parse(serializeModinfo(mergeRecord())) as Record<string, unknown>;
    const sources = doc.sources as Array<Record<string, unknown>>;
    sources[0] = { ...sources[0], enabledAtMergeTime: 'yes' };
    expect(parseModinfo(JSON.stringify(doc))).toBeNull();
  });

  it('accepts an EMPTY sources array (a merge with sources stripped is still a merge)', () => {
    const doc = JSON.parse(serializeModinfo(mergeRecord())) as Record<string, unknown>;
    doc.sources = [];
    const parsed = parseModinfo(JSON.stringify(doc));
    expect(parsed?.kind).toBe('merge');
  });
});

// The set/size comparison is tested pure: the repo has no VPK-binary fixture
// machinery (no test writes a real VPK), so parseVpkEntryStats' binary walk is
// an acknowledged integration gap, covered in practice by real imprint runs.
describe('findImprintRepackMismatch', () => {
  const entry = (path: string, size: number): VpkEntryStat => ({ path, size });
  const gameEntries = [
    entry('models/heroes/abrams/body.vmdl_c', 1000),
    entry('materials/skin.vtex_c', 2000),
  ];
  const imprintEntries = [entry(ADDONINFO_ENTRY, 300), entry(MODINFO_ENTRY, 700)];

  it('passes a first imprint: input entries carried, only the imprint entries added', () => {
    expect(findImprintRepackMismatch(gameEntries, [...gameEntries, ...imprintEntries])).toBeNull();
  });

  it('passes a re-imprint: imprint entries present on both sides with changed sizes', () => {
    const input = [...gameEntries, entry(ADDONINFO_ENTRY, 250), entry(MODINFO_ENTRY, 600)];
    expect(findImprintRepackMismatch(input, [...gameEntries, ...imprintEntries])).toBeNull();
  });

  it('normalizes case and slash direction when matching carried entries', () => {
    const input = [entry('Models\\Heroes\\Abrams\\body.vmdl_c', 1000)];
    const output = [entry('models/heroes/abrams/body.vmdl_c', 1000), ...imprintEntries];
    expect(findImprintRepackMismatch(input, output)).toBeNull();
  });

  it('reports a carried entry missing from the output, by name', () => {
    const output = [gameEntries[0], ...imprintEntries];
    const mismatch = findImprintRepackMismatch(gameEntries, output);
    expect(mismatch).toContain('1 carried entries missing from the output');
    expect(mismatch).toContain('materials/skin.vtex_c');
  });

  it('reports an unexpected entry added beyond the imprint pair', () => {
    const output = [...gameEntries, ...imprintEntries, entry('smuggled.txt', 5)];
    const mismatch = findImprintRepackMismatch(gameEntries, output);
    expect(mismatch).toContain('1 unexpected entries added');
    expect(mismatch).toContain('smuggled.txt');
  });

  it('reports a carried entry whose size changed, with both sizes', () => {
    const output = [gameEntries[0], entry('materials/skin.vtex_c', 1999), ...imprintEntries];
    const mismatch = findImprintRepackMismatch(gameEntries, output);
    expect(mismatch).toContain('1 carried entries changed size');
    expect(mismatch).toContain('materials/skin.vtex_c (2000 -> 1999 bytes)');
  });

  it('reports imprint entries absent from the output', () => {
    const mismatch = findImprintRepackMismatch(gameEntries, [...gameEntries, imprintEntries[0]]);
    expect(mismatch).toContain('imprint entries missing from the output');
    expect(mismatch).toContain(MODINFO_ENTRY);
  });

  it('joins multiple problems and caps long entry lists', () => {
    const input = Array.from({ length: 8 }, (_, i) => entry(`particles/fx_${i}.vpcf_c`, 10 + i));
    const mismatch = findImprintRepackMismatch(input, [...imprintEntries, entry('extra.bin', 1)]);
    expect(mismatch).toContain('8 carried entries missing from the output');
    expect(mismatch).toContain('+3 more');
    expect(mismatch).toContain('; ');
    expect(mismatch).toContain('1 unexpected entries added');
  });
});

describe('computeOriginalIdentity', () => {
  it('matches independently computed sha256 and size for a real temp file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modinfo-format-'));
    const filePath = join(dir, 'sample.bin');
    const bytes = Buffer.from('hello grimoire imprint test payload');
    writeFileSync(filePath, bytes);

    const expectedSha = createHash('sha256').update(bytes).digest('hex');
    const expectedSize = statSync(filePath).size;

    const identity = await computeOriginalIdentity(filePath);
    expect(identity.sha256).toBe(expectedSha);
    expect(identity.size).toBe(expectedSize);
    expect(identity.crc32).toMatch(/^[0-9a-f]{8}$/);
  });

  it('omits crc32 when includeCrc is false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modinfo-format-'));
    const filePath = join(dir, 'sample2.bin');
    writeFileSync(filePath, Buffer.from('no crc please'));

    const identity = await computeOriginalIdentity(filePath, { includeCrc: false });
    expect(identity.crc32).toBeUndefined();
    expect(identity.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
