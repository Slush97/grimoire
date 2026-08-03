/**
 * Integration test for the Global (priority root) placement, run against a real
 * temp sandbox rather than mocks, because every risk in this feature is a
 * filesystem risk: a VPK moved to the wrong folder, a metadata row left behind
 * under the old key, or a slot allocated over one of the Locker's own managed
 * VPKs.
 *
 * The move dep chain is electron/sqlite-free except app.getPath(), so we mock
 * just that (same pattern as dmmMigration.nondestructive.test.ts) and drive the
 * real service.
 *
 * The round trip is the case worth pinning: a Global mod that is disabled lands
 * in .disabled/ under a free-form name with no folder left to read, so the
 * metadata flag is the only thing that can put it back in the priority root on
 * the next enable. Get that wrong and marking a mod Global appears to work
 * until the first time the user toggles it off and on.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
// The loaded-mod guard asks the real process table (pgrep/tasklist) whether
// Deadlock is running, so an unmocked run fails on any machine where the game
// is open. Pin the sandbox's truth: no game, no vanilla stash.
vi.mock('./launch', () => ({
  isDeadlockRunning: async () => false,
  readStash: async () => null,
}));

import { scanMods, setModPriorityFolder, disableMod, enableMod } from './mods';
import { getModMetadata } from './metadata';

/** A VPK header the scanner accepts, padded so the file has a plausible size. */
function writeVpk(path: string): void {
  const header = Buffer.alloc(4096);
  header.writeUInt32LE(0x55aa1234, 0); // VPK magic
  header.writeUInt32LE(2, 4); // version
  writeFileSync(path, header);
}

const GRIMOIRE = ['game', 'citadel', 'grimoire'];
const ADDONS = ['game', 'citadel', 'addons'];

describe('setModPriorityFolder', () => {
  let dl: string;
  const names = (parts: string[]) => {
    const dir = join(dl, ...parts);
    return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.vpk')).sort() : [];
  };

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'prio-'));
    dl = join(root, 'dl');
    const userData = join(root, 'userdata');
    const addons = join(dl, ...ADDONS);
    const grimoire = join(dl, ...GRIMOIRE);
    for (const d of [addons, join(addons, '.disabled'), grimoire, userData]) {
      mkdirSync(d, { recursive: true });
    }
    writeFileSync(join(dl, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
    h.userData = userData;

    // Two ordinary mods in addons, plus the Locker's managed cards VPK
    // occupying the first reserved priority slot.
    writeVpk(join(addons, 'pak01_dir.vpk'));
    writeVpk(join(addons, 'pak02_dir.vpk'));
    writeVpk(join(grimoire, 'pak01_dir.vpk'));
  });

  it('hides the Locker-managed reserved slots from the mod list', async () => {
    const mods = await scanMods(dl);
    // grimoire/pak01 is the managed cards VPK. Surfacing it would invent a mod
    // the user never installed and let them delete a Locker artifact.
    expect(mods.map((m) => m.metaKey).sort()).toEqual(['pak01_dir.vpk', 'pak02_dir.vpk']);
  });

  it('moves a mod into the priority root above the reserved slots', async () => {
    const before = await scanMods(dl);
    const target = before.find((m) => m.metaKey === 'pak02_dir.vpk')!;
    const moved = await setModPriorityFolder(dl, target.id, true);

    expect(moved.metaKey).toBe('grimoire/pak05_dir.vpk');
    // Allocation starts at PRIORITY_FIRST_SLOT, so the managed pak01 survives.
    expect(names(GRIMOIRE)).toEqual(['pak01_dir.vpk', 'pak05_dir.vpk']);
    expect(names(ADDONS)).toEqual(['pak01_dir.vpk']);
  });

  // scanMods is the raw filesystem view; the priorityMod field is projected by
  // enrichMod at the ipc layer. What must hold HERE is that the sidecar row
  // followed the rename to the new key, since that flag is what survives a
  // disable and drives the next enable.
  it('carries the sidecar flag to the new metadata key', async () => {
    const mods = await scanMods(dl);
    const global = mods.find((m) => m.metaKey === 'grimoire/pak05_dir.vpk');
    expect(global?.enabled).toBe(true);
    expect(getModMetadata('grimoire/pak05_dir.vpk')?.priorityMod).toBe(true);
    // and nothing was left behind under the pre-move key
    expect(getModMetadata('pak02_dir.vpk')?.priorityMod).toBeUndefined();
  });

  it('restores the priority root across a disable/enable round trip', async () => {
    const mods = await scanMods(dl);
    const global = mods.find((m) => m.metaKey === 'grimoire/pak05_dir.vpk')!;

    const off = await disableMod(dl, global.id);
    expect(off.enabled).toBe(false);
    // Parked in .disabled/, so the folder no longer says anything about intent.
    expect(names(GRIMOIRE)).toEqual(['pak01_dir.vpk']);

    const back = await enableMod(dl, off.id);
    // The metadata flag, not the folder, is what put it back.
    expect(back.metaKey).toBe('grimoire/pak05_dir.vpk');
    expect(getModMetadata('grimoire/pak05_dir.vpk')?.priorityMod).toBe(true);
    expect(names(GRIMOIRE)).toEqual(['pak01_dir.vpk', 'pak05_dir.vpk']);
  });

  it('moves a mod back out to the addons folder', async () => {
    const mods = await scanMods(dl);
    const global = mods.find((m) => m.metaKey === 'grimoire/pak05_dir.vpk')!;
    const cleared = await setModPriorityFolder(dl, global.id, false);

    expect(cleared.metaKey).not.toContain('grimoire/');
    expect(getModMetadata(cleared.metaKey)?.priorityMod).toBeUndefined();
    expect(names(GRIMOIRE)).toEqual(['pak01_dir.vpk']);
    expect(names(ADDONS).length).toBe(2);

    // And the flag is really gone: a later disable/enable must not resurrect it.
    const off = await disableMod(dl, cleared.id);
    const back = await enableMod(dl, off.id);
    expect(back.metaKey).not.toContain('grimoire/');
  });
});
