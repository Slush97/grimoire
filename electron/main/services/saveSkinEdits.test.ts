/**
 * Save & enable against a temp game folder: the order and replacement rules are
 * filesystem outcomes (which pakNN each VPK lands in, which sidecar rows remain),
 * so the real mod service runs and only the vpkmerge build is faked.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '', gameRunning: false, builds: 0 }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => h.gameRunning, readStash: async () => null }));
vi.mock('./heroPoseModels', () => ({ heroSkinSourceFingerprint: async () => 'f'.repeat(64) }));
vi.mock('./skinEditor', async () => {
  const { writeFileSync: write } = await import('fs');
  return {
    buildSkinEditVpk: async (_deadlockPath: string, _request: unknown, out: string) => {
      write(out, vpkBytes(++h.builds));
      return 'models/heroes/hero.vmdl_c';
    },
  };
});

import { saveSkinEdits } from './saveSkinEdits';
import { scanMods } from './mods';
import { getModMetadata } from './metadata';

function vpkBytes(marker: number): Buffer {
  const bytes = Buffer.alloc(4096);
  bytes.writeUInt32LE(0x55aa1234, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(marker, 64);
  return bytes;
}

const save = (dl: string, heroName: string, skinSources: Array<{ metaKey: string; priority: number }>, name: string) =>
  saveSkinEdits(dl, { heroName, skinSources, fingerprint: 'f'.repeat(64), edits: [], name });

describe('saveSkinEdits', () => {
  let dl: string;
  const order = async () => (await scanMods(dl)).filter((mod) => mod.enabled)
    .map((mod) => getModMetadata(mod.metaKey)?.modName ?? mod.metaKey);

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'skin-save-'));
    dl = join(root, 'dl');
    h.userData = join(root, 'userdata');
    const addons = join(dl, 'game', 'citadel', 'addons');
    for (const dir of [join(addons, '.disabled'), join(dl, 'game', 'citadel', 'grimoire'), h.userData]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dl, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
    writeFileSync(join(addons, 'pak01_dir.vpk'), vpkBytes(1001));
    writeFileSync(join(addons, 'pak02_dir.vpk'), vpkBytes(1002));
    writeFileSync(join(addons, 'pak03_dir.vpk'), vpkBytes(1003));
    writeFileSync(join(addons, '.disabled', 'Parked_dir.vpk'), vpkBytes(1004));
  });

  it('loads the overlay directly ahead of its source and reports where the source went', async () => {
    const { renamed } = await save(dl, 'Abrams', [{ metaKey: 'pak02_dir.vpk', priority: 2 }], 'First');
    expect(await order()).toEqual(['pak01_dir.vpk', 'First', 'pak03_dir.vpk', 'pak04_dir.vpk']);
    expect(renamed['pak02_dir.vpk']).toEqual({ metaKey: 'pak03_dir.vpk', priority: 3 });
  });

  it('replaces the earlier overlay when the same source is saved again', async () => {
    const { renamed } = await save(dl, 'Abrams', [{ metaKey: 'pak03_dir.vpk', priority: 3 }], 'Second');
    // The old overlay held pak02 through the reorder and was then deleted.
    expect(await order()).toEqual(['pak01_dir.vpk', 'Second', 'pak04_dir.vpk', 'pak05_dir.vpk']);
    expect(renamed['pak03_dir.vpk']).toEqual({ metaKey: 'pak04_dir.vpk', priority: 4 });
  });

  it('keeps an overlay made from another source', async () => {
    await save(dl, 'Abrams', [], 'Default');
    expect(await order()).toEqual(['Default', 'pak02_dir.vpk', 'Second', 'pak04_dir.vpk', 'pak05_dir.vpk']);
  });

  it('enables a disabled source and loads the overlay ahead of it', async () => {
    const { renamed } = await save(dl, 'Bebop', [{ metaKey: 'Parked_dir.vpk', priority: 50 }], 'Bebop edit');
    expect(renamed['Parked_dir.vpk']).toEqual({ metaKey: 'pak07_dir.vpk', priority: 7 });
    expect((await order()).slice(-2)).toEqual(['Bebop edit', 'pak07_dir.vpk']);
  });

  it('refuses before touching any file while the game has the old overlay loaded', async () => {
    const before = await scanMods(dl);
    h.gameRunning = true;
    try {
      await expect(save(dl, 'Abrams', [], 'Blocked')).rejects.toThrow('Game is running');
    } finally { h.gameRunning = false; }
    expect((await scanMods(dl)).map((mod) => mod.metaKey)).toEqual(before.map((mod) => mod.metaKey));
  });
});
