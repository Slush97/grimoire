/**
 * Regression tests for the DMM-import corruption guards (the "everything is
 * broken now" incident: a stale state.json + repeated Fix Unknown clicks
 * tripled disabled mods and stamped wrong GameBanana identities onto real
 * files). Four guards under test:
 *  1. Idempotency: a re-run adopts nothing it adopted last time (no duplicate
 *     pakNN slots, no duplicate .disabled copies).
 *  2. Staleness: a DMM record older than the file it claims is a reused slot,
 *     not that mod; it must be skipped, not identity-hijacked. Corroboration
 *     by id-prefixed filename or matching name still adopts.
 *  3. Catalog validation: a submission id missing from the local GameBanana
 *     catalog is never stamped onto a file.
 *  4. Recoverability: the metadata sidecar is backed up before the batch.
 *
 * Same electron-free harness as dmmMigration.nondestructive.test.ts: only
 * app.getPath() is mocked; the real service runs against a temp sandbox.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateDmmInstall } from './dmmMigration';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));

interface Sandbox {
  dl: string;
  addons: string;
  disabled: string;
  separate: string;
  userData: string;
  statePath: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'dmm-guards-'));
  const dl = join(root, 'dl');
  const addons = join(dl, 'game', 'citadel', 'addons');
  const disabled = join(addons, '.disabled');
  const separate = join(root, 'dmm-profile');
  const userData = join(root, 'userdata');
  for (const d of [addons, disabled, separate, userData]) mkdirSync(d, { recursive: true });
  writeFileSync(join(dl, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
  return { dl, addons, disabled, separate, userData, statePath: join(root, 'state.json') };
}

interface StateModSpec {
  id: number;
  name: string;
  enabled: boolean;
  vpks: string[];
}

/** Write a DMM state.json (Tauri-store envelope, local-config as a STRING)
 *  holding one default profile with the given mods. */
function writeState(sb: Sandbox, mods: StateModSpec[]): void {
  const enabledMods: Record<string, unknown> = {};
  const stateMods: unknown[] = [];
  mods.forEach((m, i) => {
    enabledMods[String(m.id)] = { remoteId: String(m.id), enabled: m.enabled };
    stateMods.push({
      remoteId: String(m.id),
      name: m.name,
      category: 'Skins',
      installOrder: i,
      installedVpks: m.vpks,
    });
  });
  const state = {
    activeProfileId: 'default',
    localMods: [],
    profiles: {
      default: {
        id: 'default', name: 'Default', isDefault: true, folderName: null,
        enabledMods, mods: stateMods,
      },
    },
  };
  writeFileSync(sb.statePath, JSON.stringify({ 'local-config': JSON.stringify({ state, version: 15 }) }));
}

function run(sb: Sandbox, extra: Partial<Parameters<typeof migrateDmmInstall>[0]> = {}) {
  h.userData = sb.userData;
  return migrateDmmInstall({ deadlockPath: sb.dl, dmmStatePath: sb.statePath, ...extra });
}

/** Push a file's mtime past the state.json that claims it, simulating a slot
 *  Grimoire rewrote AFTER DMM last saved its bookkeeping. */
function makeNewerThanState(path: string): void {
  const future = new Date(Date.now() + 60_000);
  utimesSync(path, future, future);
}

const fileNames = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);

describe('idempotency: a second run adopts nothing and mints no duplicates', () => {
  it('re-run is a no-op for in-place and copy adoptions alike', async () => {
    const sb = makeSandbox();
    const liveSlot = join(sb.addons, 'pak50_dir.vpk');
    const separateVpk = join(sb.separate, 'skin_c_dir.vpk');
    writeFileSync(liveSlot, Buffer.from('ENABLED-MOD-111'));
    writeFileSync(separateVpk, Buffer.from('DISABLED-MOD-333'));
    writeState(sb, [
      { id: 111, name: 'Enabled A', enabled: true, vpks: [liveSlot] },
      { id: 333, name: 'Disabled C', enabled: false, vpks: [separateVpk] },
    ]);

    const first = await run(sb);
    expect(first.adopted.map((a) => a.submissionId).sort()).toEqual([111, 333]);

    const addonsAfterFirst = fileNames(sb.addons);
    const disabledAfterFirst = fileNames(sb.disabled);
    // The copy branch brought exactly one file into .disabled.
    expect(disabledAfterFirst.length).toBe(1);

    const second = await run(sb);
    expect(second.adopted).toEqual([]);
    expect(second.preview).toEqual([]);
    expect(second.skipped.map((s) => s.submissionId).sort()).toEqual([111, 333]);
    for (const s of second.skipped) expect(s.reason).toContain('already managed');
    // THE regression: no third copy, no extra pakNN slot.
    expect(fileNames(sb.addons)).toEqual(addonsAfterFirst);
    expect(fileNames(sb.disabled)).toEqual(disabledAfterFirst);
  });

  it('an identical file already managed under another id is not copied again', async () => {
    const sb = makeSandbox();
    const content = Buffer.from('DISABLED-MOD-333');
    const separateVpk = join(sb.separate, 'skin_c_dir.vpk');
    writeFileSync(separateVpk, content);
    // A prior import left a managed copy whose metadata lost the submission id
    // (different gameBananaId), so the id filter alone would not catch it.
    const managedCopy = join(sb.disabled, 'old_copy_dir.vpk');
    writeFileSync(managedCopy, content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    writeFileSync(
      join(sb.userData, 'mod-metadata.json'),
      JSON.stringify({ 'old_copy_dir.vpk': { gameBananaId: 999, sha256 } })
    );
    writeState(sb, [{ id: 333, name: 'Disabled C', enabled: false, vpks: [separateVpk] }]);

    const preDisabled = fileNames(sb.disabled);
    const report = await run(sb);
    expect(report.adopted).toEqual([]);
    expect(report.skipped[0].reason).toContain('identical file');
    expect(fileNames(sb.disabled)).toEqual(preDisabled);
  });
});

describe('staleness guard: stale DMM records cannot hijack reused slots', () => {
  it('skips a bare pakNN slot that is newer than the record claiming it', async () => {
    const sb = makeSandbox();
    const liveSlot = join(sb.addons, 'pak50_dir.vpk');
    writeFileSync(liveSlot, Buffer.from('SOME-OTHER-USERS-MOD'));
    writeState(sb, [{ id: 111, name: 'Old DMM Mod', enabled: true, vpks: [liveSlot] }]);
    makeNewerThanState(liveSlot);

    const report = await run(sb);
    expect(report.adopted).toEqual([]);
    expect(report.skipped[0].submissionId).toBe(111);
    expect(report.skipped[0].reason).toContain('newer than the DMM record');
    // No identity was stamped onto the file.
    const metaPath = join(sb.userData, 'mod-metadata.json');
    if (existsSync(metaPath)) {
      expect(JSON.parse(readFileSync(metaPath, 'utf-8'))['pak50_dir.vpk']).toBeUndefined();
    }
  });

  it('still adopts when the filename matches the recorded mod name', async () => {
    const sb = makeSandbox();
    const vpk = join(sb.disabled, 'glamorous_geist_dir.vpk');
    writeFileSync(vpk, Buffer.from('DISABLED-MOD-444'));
    writeState(sb, [{ id: 444, name: 'Glamorous Geist', enabled: false, vpks: [vpk] }]);
    makeNewerThanState(vpk);

    const report = await run(sb);
    expect(report.adopted.map((a) => a.submissionId)).toEqual([444]);
  });

  it('still adopts a file whose name carries the submission-id prefix', async () => {
    const sb = makeSandbox();
    const parked = join(sb.addons, '555_CoolSkin.vpk');
    writeFileSync(parked, Buffer.from('PARKED-MOD-555'));
    writeState(sb, [{ id: 555, name: 'Cool Skin', enabled: true, vpks: [parked] }]);
    makeNewerThanState(parked);

    const report = await run(sb);
    expect(report.adopted.map((a) => a.submissionId)).toEqual([555]);
    // Promoted into a real pakNN slot (a parked name is not engine-loadable).
    expect(report.adopted[0].installedAs).toMatch(/^pak\d{2}_dir\.vpk$/);
  });
});

describe('catalog validation: unknown submission ids are never stamped', () => {
  it('skips ids the local GameBanana catalog does not know', async () => {
    const sb = makeSandbox();
    const knownVpk = join(sb.addons, 'pak50_dir.vpk');
    const bogusVpk = join(sb.disabled, 'weird_thing_dir.vpk');
    writeFileSync(knownVpk, Buffer.from('KNOWN-111'));
    writeFileSync(bogusVpk, Buffer.from('BOGUS-76'));
    writeState(sb, [
      { id: 111, name: 'Known Mod', enabled: true, vpks: [knownVpk] },
      { id: 76, name: 'Weird Thing', enabled: false, vpks: [bogusVpk] },
    ]);

    const report = await run(sb, { isKnownSubmission: (id) => id === 111 });
    expect(report.adopted.map((a) => a.submissionId)).toEqual([111]);
    expect(report.skipped[0].submissionId).toBe(76);
    expect(report.skipped[0].reason).toContain('catalog');
    expect(report.warnings.some((w) => w.includes('catalog'))).toBe(true);
  });

  it('scan preview reflects the same filters as execute', async () => {
    const sb = makeSandbox();
    const knownVpk = join(sb.addons, 'pak50_dir.vpk');
    const bogusVpk = join(sb.disabled, 'weird_thing_dir.vpk');
    writeFileSync(knownVpk, Buffer.from('KNOWN-111'));
    writeFileSync(bogusVpk, Buffer.from('BOGUS-76'));
    writeState(sb, [
      { id: 111, name: 'Known Mod', enabled: true, vpks: [knownVpk] },
      { id: 76, name: 'Weird Thing', enabled: false, vpks: [bogusVpk] },
    ]);

    const scan = await run(sb, { planOnly: true, isKnownSubmission: (id) => id === 111 });
    expect(scan.preview.map((p) => p.submissionId)).toEqual([111]);
    expect(scan.skipped.map((s) => s.submissionId)).toEqual([76]);
    // Dry run: nothing written.
    expect(existsSync(join(sb.userData, 'mod-metadata.json'))).toBe(false);
  });
});

describe('recoverability: sidecar backup before the batch write', () => {
  it('backs up the pre-import metadata and does not rotate it out on no-op re-runs', async () => {
    const sb = makeSandbox();
    const liveSlot = join(sb.addons, 'pak50_dir.vpk');
    writeFileSync(liveSlot, Buffer.from('ENABLED-MOD-111'));
    const seeded = JSON.stringify({ 'pak01_dir.vpk': { gameBananaId: 42, modName: 'Precious' } });
    writeFileSync(join(sb.userData, 'mod-metadata.json'), seeded);
    writeState(sb, [{ id: 111, name: 'Enabled A', enabled: true, vpks: [liveSlot] }]);

    await run(sb);
    const backupDir = join(sb.userData, 'mod-metadata.backups');
    const backups = fileNames(backupDir);
    expect(backups.length).toBe(1);
    expect(readFileSync(join(backupDir, backups[0]), 'utf-8')).toBe(seeded);

    // No-op re-runs (everything already managed) must not add backups.
    await run(sb);
    await run(sb);
    expect(fileNames(backupDir)).toEqual(backups);
  });

  it('a re-run that only hits skips (perpetually stale entry) does not rotate the real backup', async () => {
    const sb = makeSandbox();
    const liveSlot = join(sb.addons, 'pak50_dir.vpk');
    const staleVpk = join(sb.disabled, 'hijack_me_dir.vpk');
    writeFileSync(liveSlot, Buffer.from('ENABLED-MOD-111'));
    writeFileSync(staleVpk, Buffer.from('SOMEONE-ELSES-MOD'));
    const seeded = JSON.stringify({ 'pak01_dir.vpk': { gameBananaId: 42 } });
    writeFileSync(join(sb.userData, 'mod-metadata.json'), seeded);
    writeState(sb, [
      { id: 111, name: 'Enabled A', enabled: true, vpks: [liveSlot] },
      { id: 222, name: 'Ugly Idol', enabled: false, vpks: [staleVpk] },
    ]);
    makeNewerThanState(staleVpk);

    // First run adopts 111 (writes -> one backup of the seeded sidecar).
    const first = await run(sb);
    expect(first.adopted.map((a) => a.submissionId)).toEqual([111]);
    const backupDir = join(sb.userData, 'mod-metadata.backups');
    const backups = fileNames(backupDir);
    expect(backups.length).toBe(1);
    expect(readFileSync(join(backupDir, backups[0]), 'utf-8')).toBe(seeded);

    // Entry 222 stays adoptable-but-stale forever; repeated clicks execute
    // again but write nothing, so no new backup may appear (it would rotate
    // the real pre-import backup out of the keep-N window).
    for (let i = 0; i < 3; i++) {
      const rerun = await run(sb);
      expect(rerun.adopted).toEqual([]);
    }
    expect(fileNames(backupDir)).toEqual(backups);
  });
});
