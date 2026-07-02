/**
 * Unit coverage for the addoninfo.txt serializer and the original-identity
 * helpers. serializeAddonInfo/carryForwardOriginalIdentity are pure; only
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
  carryForwardOriginalIdentity,
  computeOriginalIdentity,
  type AddonInfoFields,
} from './embeddedMetadata';
import type { ParsedAddonInfo } from './vpkIdentity';

function fields(over: Partial<AddonInfoFields> = {}): AddonInfoFields {
  return {
    title: 'My Mod',
    author: 'Some Author',
    grimoireOriginalSha256: 'a'.repeat(64),
    ...over,
  };
}

describe('serializeAddonInfo', () => {
  it('emits the exact KV1 AddonInfo shape: 4-space indent, quoted values', () => {
    const out = serializeAddonInfo(fields());
    expect(out).toBe(
      [
        '"AddonInfo"',
        '{',
        '    addonversion "1.0"',
        '    addontitle "My Mod"',
        '    addonauthor "Some Author"',
        '    grimoireOriginalSha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
        '}',
        '',
      ].join('\n')
    );
  });

  it('includes every optional field in the documented key order when all are set', () => {
    const out = serializeAddonInfo(
      fields({
        version: '2.3',
        description: 'A description',
        gamebananaId: '123',
        sourceUrl: 'https://gamebanana.com/mods/123',
        buildDate: '2026-01-01T00:00:00.000Z',
        grimoireOriginalCrc32: 'deadbeef',
        grimoireOriginalSize: 4096,
        grimoireMeta: 'grimoire_meta.json',
      })
    );
    const lines = out.split('\n');
    expect(lines).toEqual([
      '"AddonInfo"',
      '{',
      '    addonversion "2.3"',
      '    addontitle "My Mod"',
      '    addonauthor "Some Author"',
      '    addonDescription "A description"',
      '    gamebananaId "123"',
      '    sourceUrl "https://gamebanana.com/mods/123"',
      '    buildDate "2026-01-01T00:00:00.000Z"',
      '    grimoireOriginalSha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      '    grimoireOriginalCrc32 "deadbeef"',
      '    grimoireOriginalSize "4096"',
      '    grimoireMeta "grimoire_meta.json"',
      '}',
      '',
    ]);
  });

  it('escapes embedded double quotes and backslashes (backslash first)', () => {
    const out = serializeAddonInfo(fields({ title: 'C:\\Mods\\"Cool" Skin' }));
    expect(out).toContain('addontitle "C:\\\\Mods\\\\\\"Cool\\" Skin"');
  });

  it('omits undefined and empty-string optional fields entirely', () => {
    const out = serializeAddonInfo(
      fields({ description: undefined, gamebananaId: '', sourceUrl: undefined, buildDate: '' })
    );
    expect(out).not.toContain('addonDescription');
    expect(out).not.toContain('gamebananaId');
    expect(out).not.toContain('sourceUrl');
    expect(out).not.toContain('buildDate');
  });

  it('omits grimoireOriginalCrc32 when absent even though size is present', () => {
    const out = serializeAddonInfo(fields({ grimoireOriginalSize: 100 }));
    expect(out).not.toContain('grimoireOriginalCrc32');
    expect(out).toContain('grimoireOriginalSize "100"');
  });

  it('omits grimoireMeta unless explicitly set (non-merge tag)', () => {
    const out = serializeAddonInfo(fields());
    expect(out).not.toContain('grimoireMeta');
  });

  it('defaults addonversion to 1.0 when version is omitted', () => {
    const out = serializeAddonInfo(fields());
    expect(out).toContain('addonversion "1.0"');
  });
});

describe('carryForwardOriginalIdentity', () => {
  it('carries a valid embedded sha forward, lowercased, with crc/size when present', () => {
    const embed: ParsedAddonInfo = {
      grimoireOriginalSha256: 'A'.repeat(64),
      grimoireOriginalCrc32: 'DEADBEEF',
      grimoireOriginalSize: 2048,
      raw: {},
    };
    expect(carryForwardOriginalIdentity(embed)).toEqual({
      sha256: 'a'.repeat(64),
      crc32: 'deadbeef',
      size: 2048,
    });
  });

  it('tolerates absent crc/size, still carrying the sha forward', () => {
    const embed: ParsedAddonInfo = { grimoireOriginalSha256: 'b'.repeat(64), raw: {} };
    expect(carryForwardOriginalIdentity(embed)).toEqual({
      sha256: 'b'.repeat(64),
      crc32: undefined,
      size: undefined,
    });
  });

  it('returns null when the embed carries no sha at all', () => {
    const embed: ParsedAddonInfo = { raw: {} };
    expect(carryForwardOriginalIdentity(embed)).toBeNull();
  });

  it('returns null for a malformed (non-64-hex) sha', () => {
    const embed: ParsedAddonInfo = { grimoireOriginalSha256: 'not-a-real-hash', raw: {} };
    expect(carryForwardOriginalIdentity(embed)).toBeNull();
  });

  it('returns null when embed itself is undefined', () => {
    expect(carryForwardOriginalIdentity(undefined)).toBeNull();
  });
});

describe('computeOriginalIdentity', () => {
  it('matches independently computed sha256 and size for a real temp file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'embedded-metadata-'));
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
    const dir = mkdtempSync(join(tmpdir(), 'embedded-metadata-'));
    const filePath = join(dir, 'sample2.bin');
    writeFileSync(filePath, Buffer.from('no crc please'));

    const identity = await computeOriginalIdentity(filePath, { includeCrc: false });
    expect(identity.crc32).toBeUndefined();
    expect(identity.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
