/**
 * Unit coverage for the canonical VPK identity resolver. resolveVpkIdentity
 * and its addoninfo.txt parser are electron/sqlite-free (vpk.ts and
 * fileMatch.ts only touch node fs/crypto/worker_threads), so this runs
 * against real temp files with no mocking.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveVpkIdentity, parseAddonInfo } from './vpkIdentity';
import { serializeAddonInfo } from './embeddedMetadata';

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
  it('recovers the grimoireOriginal* triple after a full serialize/parse round-trip', () => {
    const serialized = serializeAddonInfo({
      title: 'Round Trip Mod',
      author: 'Author Name',
      grimoireOriginalSha256: 'c'.repeat(64),
      grimoireOriginalCrc32: 'cafebabe',
      grimoireOriginalSize: 123456,
    });

    const parsed = parseAddonInfo(serialized);
    expect(parsed.grimoireOriginalSha256).toBe('c'.repeat(64));
    expect(parsed.grimoireOriginalCrc32).toBe('cafebabe');
    expect(parsed.grimoireOriginalSize).toBe(123456);
    expect(parsed.title).toBe('Round Trip Mod');
    expect(parsed.author).toBe('Author Name');
  });

  it('recovers an escaped double-quote in a value through the round-trip', () => {
    const serialized = serializeAddonInfo({
      title: 'Cool "Skin" Pack',
      author: 'Some\\Author',
      grimoireOriginalSha256: 'd'.repeat(64),
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
    expect(parsed.grimoireOriginalSha256).toBeUndefined();
    expect(parsed.grimoireOriginalCrc32).toBeUndefined();
    expect(parsed.grimoireOriginalSize).toBeUndefined();
    expect(parsed.grimoireMeta).toBeUndefined();
  });
});
