/**
 * Regression coverage for the f38a4ab keystone wiring: setModMetadataWithHash
 * must store the CANONICAL identity via resolveVpkIdentity (live hash for a
 * plain, non-VPK file), not just any hash of convenience. Mocks electron's
 * app.getPath the same way dmmMigration.nondestructive.test.ts does, pointing
 * getMetadataPath at a real temp dir; the plain temp file exercises
 * resolveVpkIdentity's 'live' fallback with no VPK/embed mocking required.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));

import { setModMetadataWithHash, getModMetadata } from './metadata';

function metadataPath(): string {
  return join(h.userData, 'mod-metadata.json');
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'metadata-identity-'));
});

describe('setModMetadataWithHash', () => {
  it('stores the live sha256 (lowercased) of a plain temp file as the canonical identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'metadata-identity-vpk-'));
    const filePath = join(dir, 'pak01_dir.vpk');
    const bytes = Buffer.from('a fresh, un-imprinted mod file');
    writeFileSync(filePath, bytes);

    await setModMetadataWithHash('pak01_dir.vpk', { modName: 'Cool Mod' }, filePath);

    const stored = getModMetadata('pak01_dir.vpk');
    expect(stored?.sha256).toBe(sha256Of(bytes));
    expect(stored?.sha256).toBe(stored?.sha256?.toLowerCase());
    expect(stored?.modName).toBe('Cool Mod');
  });

  it('persists the hash to disk under the right metaKey', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'metadata-identity-vpk-'));
    const filePath = join(dir, 'pak02_dir.vpk');
    writeFileSync(filePath, Buffer.from('another file'));

    await setModMetadataWithHash('pak02_dir.vpk', {}, filePath);

    const onDisk = JSON.parse(readFileSync(metadataPath(), 'utf-8'));
    expect(onDisk['pak02_dir.vpk'].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a second call with different data merges fields but overwrites the hash for the new bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'metadata-identity-vpk-'));
    const filePath = join(dir, 'pak03_dir.vpk');
    const firstBytes = Buffer.from('version one');
    writeFileSync(filePath, firstBytes);

    await setModMetadataWithHash('pak03_dir.vpk', { modName: 'First Name', gameBananaId: 111 }, filePath);
    const afterFirst = getModMetadata('pak03_dir.vpk');
    expect(afterFirst?.sha256).toBe(sha256Of(firstBytes));
    expect(afterFirst?.gameBananaId).toBe(111);

    const secondBytes = Buffer.from('version two, different content');
    writeFileSync(filePath, secondBytes);

    await setModMetadataWithHash('pak03_dir.vpk', { modName: 'Second Name' }, filePath);
    const afterSecond = getModMetadata('pak03_dir.vpk');

    // merge semantics: unspecified fields from the first call survive...
    expect(afterSecond?.gameBananaId).toBe(111);
    // ...but the ones passed in the second call, and the hash, are overwritten.
    expect(afterSecond?.modName).toBe('Second Name');
    expect(afterSecond?.sha256).toBe(sha256Of(secondBytes));
    expect(afterSecond?.sha256).not.toBe(afterFirst?.sha256);
  });
});
