/**
 * Orchestration-level regression test for migrateDmmInstall: proves the import
 * is NON-DESTRUCTIVE. DMM deploys its mods into the SAME folders Grimoire scans
 * (citadel/addons for enabled, citadel/addons/.disabled for disabled) with the
 * same `*_dir.vpk` naming, so adoption must be a pure metadata write with no
 * file moved, renamed, or deleted. The only time a file is created is when DMM's
 * source lives in a separate folder, and even then the original is left intact.
 *
 * The whole migrate dep chain is electron/sqlite-free except app.getPath(), so
 * we mock just that and run the real service against a temp sandbox.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateDmmInstall } from './dmmMigration';

// app.getPath('userData') is the only electron touchpoint; it's read lazily, so
// the hoisted ref is populated by beforeAll before the service ever calls it.
const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));

type Snap = Record<string, { ino: number; size: number }>;
function snap(dir: string): Snap {
  const out: Snap = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const s = statSync(join(dir, name));
    if (s.isFile()) out[name] = { ino: s.ino, size: s.size };
  }
  return out;
}

/** Wrap a DMM state object in the Tauri-store + zustand-persist envelope, with
 *  local-config as a STRING (the shape DMM actually writes). */
function dmmStateFile(state: unknown): string {
  return JSON.stringify({ 'local-config': JSON.stringify({ state, version: 15 }) });
}

describe('migrateDmmInstall (non-destructive adoption)', () => {
  let report: Awaited<ReturnType<typeof migrateDmmInstall>>;
  let preAddons: Snap, postAddons: Snap, preDisabled: Snap, postDisabled: Snap;
  let preSeparate: Snap, postSeparate: Snap;
  let metaPath: string;
  let dirs: { addons: string; disabled: string; separate: string };

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'dmm-nd-'));
    const dl = join(root, 'dl');
    const addons = join(dl, 'game', 'citadel', 'addons');
    const disabled = join(addons, '.disabled');
    const separate = join(root, 'dmm-profile'); // a DMM folder outside Grimoire's roots
    const userData = join(root, 'userdata');
    for (const d of [addons, disabled, separate, userData, join(dl, 'game', 'citadel')]) {
      mkdirSync(d, { recursive: true });
    }
    writeFileSync(join(dl, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
    h.userData = userData;
    dirs = { addons, disabled, separate };

    // Three fresh DMM mods, each already deployed where DMM puts them:
    //  111 enabled  -> a live pakNN_dir.vpk in citadel/addons      (in-place)
    //  222 disabled -> a *_dir.vpk in the shared .disabled folder  (in-place, the new branch)
    //  333 disabled -> a *_dir.vpk in a SEPARATE DMM folder        (copy, original kept)
    const enabledSlot = join(addons, 'pak50_dir.vpk');
    const disabledShared = join(disabled, 'skin_b_dir.vpk');
    const disabledSeparate = join(separate, 'skin_c_dir.vpk');
    writeFileSync(enabledSlot, Buffer.from('ENABLED-MOD-111'));
    writeFileSync(disabledShared, Buffer.from('DISABLED-MOD-222'));
    writeFileSync(disabledSeparate, Buffer.from('DISABLED-MOD-333'));

    const state = {
      activeProfileId: 'default',
      localMods: [],
      profiles: {
        default: {
          id: 'default', name: 'Default Profile', isDefault: true, folderName: null,
          enabledMods: {
            '111': { remoteId: '111', enabled: true },
            '222': { remoteId: '222', enabled: false },
            '333': { remoteId: '333', enabled: false },
          },
          mods: [
            { remoteId: '111', name: 'Enabled A', category: 'Skins', installOrder: 0,
              installedVpks: [enabledSlot],
              selectedDownloads: [{ url: 'https://gamebanana.com/dl/9001', name: 'a.zip' }] },
            { remoteId: '222', name: 'Disabled B', category: 'Skins', installOrder: 1,
              installedVpks: [disabledShared] },
            { remoteId: '333', name: 'Disabled C', category: 'Skins', installOrder: 2,
              installedVpks: [disabledSeparate] },
          ],
        },
      },
    };
    const statePath = join(root, 'state.json');
    writeFileSync(statePath, dmmStateFile(state));

    preAddons = snap(addons); preDisabled = snap(disabled); preSeparate = snap(separate);
    report = await migrateDmmInstall({ deadlockPath: dl, dmmStatePath: statePath, planOnly: false });
    postAddons = snap(addons); postDisabled = snap(disabled); postSeparate = snap(separate);
    metaPath = join(userData, 'mod-metadata.json');
  });

  it('adopts all three mods in-place mode', () => {
    expect(report.mode).toBe('in-place');
    expect(report.adopted.map((a) => a.submissionId).sort()).toEqual([111, 222, 333]);
    expect(report.skipped).toEqual([]);
  });

  it('enabled mod: adopted onto its existing live slot, no new addons file', () => {
    expect(Object.keys(postAddons).sort()).toEqual(Object.keys(preAddons).sort());
    expect(postAddons['pak50_dir.vpk'].ino).toBe(preAddons['pak50_dir.vpk'].ino);
  });

  it('shared-folder disabled mod: metadata-only, same inode, nothing moved', () => {
    // skin_b stays put with the same inode (NOT renamed/recreated).
    expect(postDisabled['skin_b_dir.vpk']).toBeDefined();
    expect(postDisabled['skin_b_dir.vpk'].ino).toBe(preDisabled['skin_b_dir.vpk'].ino);
  });

  it('separate-folder disabled mod: COPIED in, original left untouched', () => {
    // The DMM original is still there, byte-for-byte.
    expect(postSeparate['skin_c_dir.vpk']).toBeDefined();
    expect(postSeparate['skin_c_dir.vpk'].ino).toBe(preSeparate['skin_c_dir.vpk'].ino);
    expect(readFileSync(join(dirs.separate, 'skin_c_dir.vpk')).toString()).toBe('DISABLED-MOD-333');
    // Exactly one new file appeared in .disabled (the copy of skin_c).
    const added = Object.keys(postDisabled).filter((n) => !(n in preDisabled));
    expect(added.length).toBe(1);
  });

  it('writes recognition metadata for every adopted mod', () => {
    expect(existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    for (const a of report.adopted) expect(meta[a.installedAs]).toBeDefined();
    // gameBananaId carried through so Grimoire recognizes them natively.
    const enabled = report.adopted.find((a) => a.submissionId === 111)!;
    expect(meta[enabled.installedAs].gameBananaId).toBe(111);
  });

  it('never deletes a source file (every pre-existing file still present)', () => {
    for (const n of Object.keys(preAddons)) expect(postAddons[n]).toBeDefined();
    for (const n of Object.keys(preDisabled)) expect(postDisabled[n]).toBeDefined();
    for (const n of Object.keys(preSeparate)) expect(postSeparate[n]).toBeDefined();
  });
});
