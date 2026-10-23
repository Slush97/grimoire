import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '', version: 'vpkmerge 0.25.0', failing: new Set<string>(), exported: [] as string[] }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./modMerger', async () => {
  const { writeFileSync: write } = await import('fs');
  const decoded: Record<string, unknown> = {
    'maps/dl_hideout/world.vwrld_c': { m_worldNodes: [{ m_worldNodePrefix: 'maps/dl_hideout/node000' }], m_entityLumps: ['maps/dl_hideout/ents.vents'] },
    'maps/dl_hideout/ents.vents_c': { m_entityKeyValues: [{ keyValues3Data: { values: { classname: 'info_team_spawn', targetname: 'player_spawn', origin: [1, 2, 3] } } }] },
    'maps/dl_hideout/node000.vwnod_c': { m_sceneObjects: [{ m_renderableModel: 'models/a.vmdl' }, { m_renderableModel: 'models/b.vmdl' }], m_aggregateSceneObjects: [] },
  };
  return {
    runVpkmergeStdout: async (args: string[]) => args[0] === '--version' ? `${h.version}\n` : JSON.stringify(decoded[args[1]]),
    runVpkmerge: async (args: string[]) => {
      const entry = args[args.indexOf('--entry') + 1];
      h.exported.push(entry);
      if (h.failing.has(entry)) throw new Error('export failed');
      const glb = Buffer.alloc(20);
      glb.write('glTF', 0, 'ascii');
      glb.writeUInt32LE(2, 4);
      glb.writeUInt32LE(glb.length, 8);
      write(args[args.indexOf('--out') + 1], glb);
    },
  };
});

describe('hideout scene cache', () => {
  let dl: string;

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'hideout-'));
    dl = join(root, 'dl');
    h.userData = join(root, 'userdata');
    mkdirSync(join(dl, 'game', 'citadel', 'maps'), { recursive: true });
    writeFileSync(join(dl, 'game', 'citadel', 'maps', 'dl_hideout.vpk'), 'map');
    writeFileSync(join(dl, 'game', 'citadel', 'pak01_dir.vpk'), 'base');
  });

  it('retries a failed model export on the next load and reuses the models that exported', async () => {
    const { loadHideoutScene } = await import('./hideoutScene');
    h.failing.add('models/b.vmdl_c');
    const first = await loadHideoutScene(dl);
    expect(first.failures).toEqual(['models/b.vmdl_c']);
    expect(first.instances).toHaveLength(1);

    h.failing.clear();
    h.exported = [];
    const second = await loadHideoutScene(dl);
    expect(h.exported).toEqual(['models/b.vmdl_c']);
    expect(second.failures).toEqual([]);
    expect(second.instances).toHaveLength(2);

    h.exported = [];
    expect((await loadHideoutScene(dl)).instances).toHaveLength(2);
    expect(h.exported).toEqual([]);
  });

  it('rebuilds every model for a different vpkmerge version', async () => {
    const { loadHideoutScene: before } = await import('./hideoutScene');
    const oldKey = (await before(dl)).key;
    vi.resetModules();
    h.version = 'vpkmerge 0.26.0';
    h.exported = [];
    const { loadHideoutScene } = await import('./hideoutScene');
    const scene = await loadHideoutScene(dl);
    expect(scene.key).not.toBe(oldKey);
    expect(h.exported.sort()).toEqual(['models/a.vmdl_c', 'models/b.vmdl_c']);
  });
});
