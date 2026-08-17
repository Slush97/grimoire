/**
 * Five flows rebuild a local mod's VPK in place (merge add-sources,
 * replace-sources and extract-source, plus the soul-container and spirit-urn
 * re-imports): the fileName, load slot and metaKey survive, the bytes do not.
 * Local mods carry no GameBanana id pair, so a saved profile's only handle on
 * them is the stamped sha256, and the resolver deliberately refuses a fileName
 * fallback when the two known hashes disagree (see profileResolver.test.ts).
 * retargetProfileModSha is what stops a rebuilt mod from ever reaching that
 * refusal: without it, applying a profile would silently disable a merge the
 * user had just added a source to.
 *
 * Run against a real profiles.json in a temp userData dir rather than mocks:
 * the whole point of the helper is the load/rewrite/save round trip, and the
 * dep chain is electron-free except app.getPath() (same pattern as
 * priorityFolderMove.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
// lockerVpk -> launch asks the real process table whether Deadlock is running.
vi.mock('./launch', () => ({
  isDeadlockRunning: async () => false,
  readStash: async () => null,
}));

import { retargetProfileModSha } from './profiles';
import type { Profile } from '../../../src/types/electron';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function profilesPath(): string {
  return join(h.userData, 'profiles.json');
}

function seed(profiles: Profile[]): void {
  writeFileSync(profilesPath(), JSON.stringify(profiles, null, 2), 'utf-8');
}

function read(): Profile[] {
  return JSON.parse(readFileSync(profilesPath(), 'utf-8')) as Profile[];
}

function profile(id: string, mods: Array<{ fileName: string; sha256?: string; gameBananaId?: number }>): Profile {
  return {
    id,
    name: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    mods: mods.map((m) => ({ enabled: true, priority: 1, ...m })),
  } as Profile;
}

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'grimoire-retarget-'));
});

describe('retargetProfileModSha', () => {
  it('moves every entry on the old hash to the new one', () => {
    seed([
      profile('p1', [{ fileName: 'pak07_dir.vpk', sha256: SHA_A }]),
      profile('p2', [
        { fileName: 'pak03_dir.vpk', sha256: SHA_A },
        { fileName: 'pak04_dir.vpk', sha256: SHA_C },
      ]),
    ]);

    retargetProfileModSha(SHA_A, SHA_B);

    const [p1, p2] = read();
    expect(p1.mods[0].sha256).toBe(SHA_B);
    expect(p2.mods[0].sha256).toBe(SHA_B);
    // Untouched entries keep their own hash.
    expect(p2.mods[1].sha256).toBe(SHA_C);
  });

  it('normalizes case on both sides', () => {
    seed([profile('p1', [{ fileName: 'pak07_dir.vpk', sha256: SHA_A.toUpperCase() }])]);

    retargetProfileModSha(SHA_A, SHA_B.toUpperCase());

    expect(read()[0].mods[0].sha256).toBe(SHA_B);
  });

  it('leaves everything else in the entry alone', () => {
    seed([profile('p1', [{ fileName: 'pak07_dir.vpk', sha256: SHA_A, gameBananaId: 42 }])]);

    retargetProfileModSha(SHA_A, SHA_B);

    const entry = read()[0].mods[0];
    expect(entry.fileName).toBe('pak07_dir.vpk');
    expect(entry.enabled).toBe(true);
    expect(entry.gameBananaId).toBe(42);
  });

  it('does not rewrite the file when nothing matches', () => {
    seed([profile('p1', [{ fileName: 'pak07_dir.vpk', sha256: SHA_C }])]);
    const before = readFileSync(profilesPath(), 'utf-8');

    retargetProfileModSha(SHA_A, SHA_B);

    expect(readFileSync(profilesPath(), 'utf-8')).toBe(before);
  });

  it('is a no-op when either hash is missing or the two are equal', () => {
    // Pre-backfill installs and legacy profile entries have no hash at all;
    // rebuilding a mod whose bytes did not actually change is also common.
    retargetProfileModSha(undefined, SHA_B);
    retargetProfileModSha(SHA_A, undefined);
    retargetProfileModSha(SHA_A, SHA_A.toUpperCase());

    expect(existsSync(profilesPath())).toBe(false);
  });

  it('never throws, so a retarget failure cannot fail the rebuild', () => {
    // Unreadable profiles.json: loadProfiles already swallows it, and the
    // save half is wrapped too. The caller has just swapped a VPK into place
    // and must not be rolled back over profile bookkeeping.
    writeFileSync(profilesPath(), 'not json at all', 'utf-8');
    expect(() => retargetProfileModSha(SHA_A, SHA_B)).not.toThrow();
  });
});
