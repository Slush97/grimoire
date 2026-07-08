/**
 * Unit coverage for the canonical VPK identity resolver, the addoninfo.txt
 * parser (vpk-modinfo v1 key set), and carryForwardOriginalIdentity including
 * its legacy-shim fallback. resolveVpkIdentity and the parser are
 * electron/sqlite-free (vpk.ts and fileMatch.ts only touch node
 * fs/crypto/worker_threads), so this runs against real temp files with no
 * mocking.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  resolveVpkIdentity,
  parseAddonInfo,
  carryForwardOriginalIdentity,
  type ParsedAddonInfo,
} from './vpkIdentity';
import { serializeAddonInfo } from './modinfoFormat';

describe('resolveVpkIdentity', () => {
  it('falls back to the live hash for a non-VPK file, matching node-crypto sha256', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vpk-identity-'));
    const filePath = join(dir, 'not-a-vpk.bin');
    const bytes = Buffer.from('plain file, no VPK signature, no embed');
    writeFileSync(filePath, bytes);

    const expectedSha = createHash('sha256').update(bytes).digest('hex');
    const identity = await resolveVpkIdentity(filePath);

    expect(identity.source).toBe('live');
    expect(identity.sha256).toBe(expectedSha);
    expect(identity.embedded).toBeUndefined();
  });

  it('throws when the abort signal is already aborted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vpk-identity-'));
    const filePath = join(dir, 'aborted.bin');
    writeFileSync(filePath, Buffer.from('irrelevant'));

    const controller = new AbortController();
    controller.abort();

    await expect(resolveVpkIdentity(filePath, controller.signal)).rejects.toThrow(/aborted/i);
  });
});

describe('parseAddonInfo (round-trip through serializeAddonInfo)', () => {
  it('recovers the original* triple and GameBanana fields after a full round-trip', () => {
    const serialized = serializeAddonInfo({
      title: 'Round Trip Mod',
      author: 'Author Name',
      gamebananaId: '123',
      gamebananaFileId: '456',
      sourceUrl: 'https://gamebanana.com/mods/123',
      buildDate: '2026-01-01T00:00:00.000Z',
      originalSha256: 'c'.repeat(64),
      originalSize: 123456,
      originalCrc32: 'cafebabe',
    });

    const parsed = parseAddonInfo(serialized);
    expect(parsed.originalSha256).toBe('c'.repeat(64));
    expect(parsed.originalCrc32).toBe('cafebabe');
    expect(parsed.originalSize).toBe(123456);
    expect(parsed.gamebananaId).toBe('123');
    expect(parsed.gamebananaFileId).toBe('456');
    expect(parsed.sourceUrl).toBe('https://gamebanana.com/mods/123');
    expect(parsed.buildDate).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.title).toBe('Round Trip Mod');
    expect(parsed.author).toBe('Author Name');
    expect(parsed.modinfoVersion).toBe('1');
  });

  it('recovers an escaped double-quote in a value through the round-trip', () => {
    const serialized = serializeAddonInfo({
      title: 'Cool "Skin" Pack',
      author: 'Some\\Author',
      buildDate: '2026-01-01T00:00:00.000Z',
      originalSha256: 'd'.repeat(64),
    });

    const parsed = parseAddonInfo(serialized);
    expect(parsed.title).toBe('Cool "Skin" Pack');
    expect(parsed.author).toBe('Some\\Author');
  });

  it('parses fields case-insensitively and exposes every flat key via raw', () => {
    const parsed = parseAddonInfo('"AddonInfo"\n{\n    AddonTitle "Mixed Case"\n}\n');
    expect(parsed.title).toBe('Mixed Case');
    expect(parsed.raw['addontitle']).toBe('Mixed Case');
  });

  it('yields undefined optional fields for a minimal document', () => {
    const parsed = parseAddonInfo('"AddonInfo"\n{\n    addontitle "Bare"\n}\n');
    expect(parsed.originalSha256).toBeUndefined();
    expect(parsed.originalCrc32).toBeUndefined();
    expect(parsed.originalSize).toBeUndefined();
    expect(parsed.modinfoVersion).toBeUndefined();
  });
});

describe('carryForwardOriginalIdentity', () => {
  it('carries a valid embedded sha forward, lowercased, with crc/size when present', () => {
    const embed: ParsedAddonInfo = {
      originalSha256: 'A'.repeat(64),
      originalCrc32: 'DEADBEEF',
      originalSize: 2048,
      raw: {},
    };
    expect(carryForwardOriginalIdentity(embed)).toEqual({
      sha256: 'a'.repeat(64),
      crc32: 'deadbeef',
      size: 2048,
    });
  });

  it('tolerates absent crc/size, still carrying the sha forward', () => {
    const embed: ParsedAddonInfo = { originalSha256: 'b'.repeat(64), raw: {} };
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
    const embed: ParsedAddonInfo = { originalSha256: 'not-a-real-hash', raw: {} };
    expect(carryForwardOriginalIdentity(embed)).toBeNull();
  });

  it('returns null when embed itself is undefined', () => {
    expect(carryForwardOriginalIdentity(undefined)).toBeNull();
  });

  // PRE-RELEASE SHIM coverage: the legacy grimoire-branded key set.
  it('falls back to the legacy grimoireOriginal* raw keys (shim path)', () => {
    const embed: ParsedAddonInfo = {
      raw: {
        grimoireoriginalsha256: 'E'.repeat(64),
        grimoireoriginalcrc32: 'CAFEBABE',
        grimoireoriginalsize: '4096',
      },
    };
    expect(carryForwardOriginalIdentity(embed)).toEqual({
      sha256: 'e'.repeat(64),
      crc32: 'cafebabe',
      size: 4096,
    });
  });

  it('prefers the current keys over legacy keys when both are present', () => {
    const embed: ParsedAddonInfo = {
      originalSha256: 'a'.repeat(64),
      raw: { grimoireoriginalsha256: 'f'.repeat(64) },
    };
    expect(carryForwardOriginalIdentity(embed)?.sha256).toBe('a'.repeat(64));
  });

  it('ignores a malformed legacy size but keeps the legacy sha', () => {
    const embed: ParsedAddonInfo = {
      raw: { grimoireoriginalsha256: 'f'.repeat(64), grimoireoriginalsize: 'huge' },
    };
    expect(carryForwardOriginalIdentity(embed)).toEqual({
      sha256: 'f'.repeat(64),
      crc32: undefined,
      size: undefined,
    });
  });

  it('falls back to the old grimoire_meta.json merge sha as the last resort (shim path)', () => {
    const embed: ParsedAddonInfo = { raw: {} };
    const identity = carryForwardOriginalIdentity(embed, { originalSha256: 'D'.repeat(64) });
    expect(identity).toEqual({ sha256: 'd'.repeat(64) });
  });

  it('returns null when the legacy merge meta sha is malformed too', () => {
    expect(carryForwardOriginalIdentity(undefined, { originalSha256: 'bogus' })).toBeNull();
  });
});
