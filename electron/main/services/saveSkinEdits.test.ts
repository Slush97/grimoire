/**
 * Save & enable against a temp game folder: the order and replacement rules are
 * filesystem outcomes (which pakNN each VPK lands in, which sidecar rows remain),
 * so the real mod service runs and only the vpkmerge build is faked.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
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

import { resumeSkinEdit, saveSkinEdits } from './saveSkinEdits';
import { scanMods } from './mods';
import { getModMetadata } from './metadata';
import { resolveVpkIdentity } from './vpkIdentity';

function vpkBytes(marker: number): Buffer {
  const bytes = Buffer.alloc(4096);
  bytes.writeUInt32LE(0x55aa1234, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(marker, 64);
  return bytes;
}

type Edit = { material: string; hidden: boolean; tint: string | null };
const save = (dl: string, heroName: string, skinSources: Array<{ metaKey: string; priority: number }>, name: string, edits: Edit[] = [], thumbnailDataUrl?: string) =>
  saveSkinEdits(dl, { heroName, skinSources, fingerprint: 'f'.repeat(64), edits, name, thumbnailDataUrl });
const thumbnail = 'data:image/webp;base64,UklGRg==';

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
    const { renamed, overlay } = await save(dl, 'Abrams', [{ metaKey: 'pak02_dir.vpk', priority: 2 }], 'First', [], thumbnail);
    expect(await order()).toEqual(['pak01_dir.vpk', 'First', 'pak03_dir.vpk', 'pak04_dir.vpk']);
    expect(renamed['pak02_dir.vpk']).toEqual({ metaKey: 'pak03_dir.vpk', priority: 3 });
    expect(getModMetadata(overlay.metaKey)?.thumbnailUrl).toBe(thumbnail);
  });

  it('replaces the earlier overlay when the same source is saved again', async () => {
    const { renamed, overlay } = await save(dl, 'Abrams', [{ metaKey: 'pak03_dir.vpk', priority: 3 }], 'Second');
    // The old overlay held pak02 through the reorder and was then deleted.
    expect(await order()).toEqual(['pak01_dir.vpk', 'Second', 'pak04_dir.vpk', 'pak05_dir.vpk']);
    expect(renamed['pak03_dir.vpk']).toEqual({ metaKey: 'pak04_dir.vpk', priority: 4 });
    expect(getModMetadata(overlay.metaKey)?.thumbnailUrl).toBe(thumbnail);
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

  it('resumes an overlay named as a source instead of stacking another', async () => {
    const located = async (name: string) => {
      const mod = (await scanMods(dl)).find((item) => getModMetadata(item.metaKey)?.modName === name);
      if (!mod) throw new Error(`${name} is not installed`);
      return { metaKey: mod.metaKey, priority: mod.priority };
    };
    let source = { metaKey: 'pak07_dir.vpk', priority: 7 };
    const first = [{ material: 'materials/bebop/body.vmat', hidden: true, tint: null }];
    // Locker's stack: the earlier overlay plus its source.
    source = (await save(dl, 'Bebop', [await located('Bebop edit'), source], 'Bebop tinted', first)).renamed[source.metaKey] ?? source;
    expect((await order()).slice(-2)).toEqual(['Bebop tinted', source.metaKey]);

    const overlay = await located('Bebop tinted');
    const resumed = await resumeSkinEdit(dl, { heroName: 'Bebop', skinSources: [overlay, source] });
    expect(resumed).toMatchObject({ skinSources: [source], overlay, name: 'Bebop tinted', edits: first, missing: 0 });

    const second = [...first, { material: 'materials/bebop/arm.vmat', hidden: false, tint: '#ff0000' }];
    source = (await save(dl, 'Bebop', [overlay, source], 'Bebop tinted', second)).renamed[source.metaKey] ?? source;
    const enabled = await order();
    expect(enabled.filter((name) => name.startsWith('Bebop'))).toEqual(['Bebop tinted']);
    expect(enabled.slice(-2)).toEqual(['Bebop tinted', source.metaKey]);
    expect(getModMetadata((await located('Bebop tinted')).metaKey)?.skinEdit?.edits).toEqual(second);
  });

  it('refuses before touching any file while the game has the old overlay loaded', async () => {
    const before = await scanMods(dl);
    h.gameRunning = true;
    try {
      await expect(save(dl, 'Abrams', [], 'Blocked')).rejects.toThrow('Game is running');
    } finally { h.gameRunning = false; }
    expect((await scanMods(dl)).map((mod) => mod.metaKey)).toEqual(before.map((mod) => mod.metaKey));
  });
  it('keeps the saved overlay when one of its source skins is missing', async () => {
    const mods = await scanMods(dl);
    const overlay = mods.find((mod) => getModMetadata(mod.metaKey)?.modName === 'Bebop tinted');
    if (!overlay) throw new Error('Saved test skin missing');
    const hash = getModMetadata(overlay.metaKey)?.skinEdit?.sources[0];
    const identities = await Promise.all(mods.map(async (mod) => ({ mod, hash: (await resolveVpkIdentity(mod.path)).sha256 })));
    const source = identities.find((item) => item.hash === hash)?.mod;
    if (!source) throw new Error('Test source missing');
    unlinkSync(source.path);
    const builds = h.builds;
    await expect(save(dl, 'Bebop', [{ metaKey: overlay.metaKey, priority: overlay.priority }], 'Incomplete')).rejects.toThrow('source skins');
    expect(h.builds).toBe(builds);
    expect(getModMetadata(overlay.metaKey)?.modName).toBe('Bebop tinted');
  });
});
