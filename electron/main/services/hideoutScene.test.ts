import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '', binary: '', version: 'vpkmerge 0.25.0', failing: new Set<string>(), exported: [] as string[], overrides: false,
  props: false, clipExports: [] as string[][],
  requests: [] as { entry: string; out: string; materialOverrides?: { meshIndex: number; drawCallIndex: number; material: string }[] }[] }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./modMerger', async () => {
  const { writeFileSync: write, readFileSync: read } = await import('fs');
  const decoded: Record<string, unknown> = {
    'maps/dl_hideout/world.vwrld_c': { m_worldNodes: [{ m_worldNodePrefix: 'maps/dl_hideout/node000' }], m_entityLumps: ['maps/dl_hideout/ents.vents'] },
    'maps/dl_hideout/ents.vents_c': { m_entityKeyValues: [{ keyValues3Data: { values: { classname: 'info_team_spawn', targetname: 'player_spawn', origin: [1, 2, 3] } } }] },
    'maps/dl_hideout/node000.vwnod_c': { m_sceneObjects: [{ m_renderableModel: 'models/a.vmdl' }, { m_renderableModel: 'models/b.vmdl' }], m_aggregateSceneObjects: [] },
  };
  const exportOne = (entry: string, out: string, animated = false) => {
      h.exported.push(entry);
      if (h.failing.has(entry)) throw new Error('export failed');
      const json = Buffer.from(animated
        ? '{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}],"accessors":[{"max":[4.8]}],"animations":[{"samplers":[{"input":0}]}]}'
        : '{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}]} ');
      const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
      const glb = Buffer.alloc(28 + padded.length);
      glb.write('glTF', 0, 'ascii');
      glb.writeUInt32LE(2, 4);
      glb.writeUInt32LE(glb.length, 8);
      glb.writeUInt32LE(padded.length, 12);
      glb.writeUInt32LE(0x4e4f534a, 16);
      padded.copy(glb, 20);
      glb.writeUInt32LE(0x004e4942, 24 + padded.length);
      write(out, glb);
  };
  return {
    vpkmergeBinaryPath: () => h.binary,
    runVpkmergeStdout: async (args: string[]) => {
      if (args[0] === '--version') return `${h.version}\n`;
      if (args.includes('--help')) return '';
      if (args[0] === 'model' && args[1] === 'export-scene') {
        const requests: { entry: string; out: string }[] = JSON.parse(read(args[args.indexOf('--manifest') + 1], 'utf8'));
        h.requests.push(...requests);
        return JSON.stringify(requests.map(request => { try { exportOne(request.entry, request.out); return null; } catch { return 'export failed'; } }));
      }
      if (h.props && args[1] === 'maps/dl_hideout/ents.vents_c') return JSON.stringify({ m_entityKeyValues: [
        { keyValues3Data: { values: { classname: 'info_team_spawn', targetname: 'player_spawn', origin: [1, 2, 3] } } },
        ...[[0, 0], [10, 0]].map(origin => ({ keyValues3Data: { values: { classname: 'prop_dynamic', model: 'models/ghost.vmdl', origin: [...origin, 0], renderamt: 255,
          StartingAnim: 'pace', StartingAnimationLoopMode: 'ANIM_LOOP_MODE_LOOPING' } } })),
        { keyValues3Data: { values: { classname: 'prop_dynamic', model: 'models/door.vmdl', origin: [5, 5, 0], renderamt: 255,
          StartingAnim: 'open', StartingAnimationLoopMode: 'ANIM_LOOP_MODE_NOT_LOOPING' } } },
      ] });
      if (h.overrides && args[1] === 'maps/dl_hideout/node000.vwnod_c') return JSON.stringify({
        m_sceneObjects: Array.from({ length: 3 }, () => ({ m_renderableModel: 'models/a.vmdl' })), m_aggregateSceneObjects: [],
        m_materialOverrides: [1, 2].map(m_nSceneObjectIndex => ({ m_nSceneObjectIndex, m_nSubSceneObject: 1, m_nDrawCallIndex: 2, m_pMaterial: 'models/effects/steam.vmat' })),
      });
      return JSON.stringify(decoded[args[1]]);
    },
    runVpkmerge: async (args: string[]) => {
      if (args.includes('--clip')) {
        h.clipExports.push(args);
      }
      exportOne(args[args.indexOf('--entry') + 1], args[args.indexOf('--out') + 1], args.includes('--clip'));
    },
  };

});

describe('hideout scene cache', () => {
  let dl: string;

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'hideout-'));
    dl = join(root, 'dl');
    h.userData = join(root, 'userdata');
    h.binary = join(root, 'vpkmerge.exe');
    writeFileSync(h.binary, 'test exporter');
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

  it('invalidates prepared resources when a local exporter changes at the same version', async () => {
    const { loadHideoutScene } = await import('./hideoutScene');
    const previous = await loadHideoutScene(dl);
    writeFileSync(h.binary, 'different exporter build at the same version');
    h.exported = [];
    const current = await loadHideoutScene(dl);
    expect(current.key).not.toBe(previous.key);
    expect(h.exported.sort()).toEqual(['models/a.vmdl_c', 'models/b.vmdl_c']);
    expect(current.bundle.models).toBe(2);
  });
  it('exports a looping prop rigged with its clip outside the bundle, and bakes any other prop', async () => {
    h.props = true; h.requests = []; h.clipExports = [];
    writeFileSync(h.binary, 'animated prop exporter');
    const { loadHideoutScene } = await import('./hideoutScene');
    try {
      const scene = await loadHideoutScene(dl);
      const animated = scene.instances.filter(instance => instance.animation);
      expect(animated).toHaveLength(2);
      expect(animated[0].animation).toEqual({ clip: 'pace' });
      expect(animated[0].model).toBe(animated[1].model);
      expect(animated[0].matrix.slice(12, 15)).not.toEqual(animated[1].matrix.slice(12, 15));
      expect(h.clipExports).toHaveLength(1);
      expect(h.clipExports[0]).toEqual(expect.arrayContaining(['--entry', 'models/ghost.vmdl_c', '--clip', 'pace']));
      expect(h.requests.map(request => request.entry)).toContain('models/door.vmdl_c');
      expect(h.requests.map(request => request.entry)).not.toContain('models/ghost.vmdl_c');
      expect(scene.bundle.models).toBe(3);
      expect(existsSync(join(h.userData, 'viewer-scenes', scene.key, animated[0].model))).toBe(true);

      // A cached open reuses the rigged model.
      h.clipExports = [];
      expect((await loadHideoutScene(dl)).instances.filter(instance => instance.animation)).toHaveLength(2);
      expect(h.clipExports).toEqual([]);
    } finally { h.props = false; }
  });

  it('exports a separate material-aware variant and reuses matching overrides', async () => {
    h.overrides = true; h.requests = [];
    writeFileSync(h.binary, 'world material override exporter');
    const { loadHideoutScene } = await import('./hideoutScene');
    try {
      const current = await loadHideoutScene(dl);
      expect(current.instances).toHaveLength(3);
      expect(current.instances[0].model).not.toBe(current.instances[1].model);
      expect(current.instances[1].model).toBe(current.instances[2].model);
      expect(h.requests).toHaveLength(2);
      expect(h.requests[0].materialOverrides).toBeUndefined();
      expect(h.requests[1].materialOverrides).toEqual([{ meshIndex: 1, drawCallIndex: 2, material: 'models/effects/steam.vmat' }]);
    } finally { h.overrides = false; }
  });
});

it('does not recreate fully baked direct lighting, while keeping stationary lights', async () => {
  const { isRealtimeMapLight } = await import('./hideoutScene');
  expect(isRealtimeMapLight(0, 1)).toBe(false);
  expect(isRealtimeMapLight(1)).toBe(false);
  expect(isRealtimeMapLight(1, 4)).toBe(false);
  expect(isRealtimeMapLight(1, 0)).toBe(true);
  expect(isRealtimeMapLight(3, 2)).toBe(true);
  expect(isRealtimeMapLight(2)).toBe(true);
  expect(isRealtimeMapLight()).toBe(true);
});

it('serves scene particle bundles and stored mips without allowing directory traversal', async () => {
  const { hideoutCacheFile } = await import('./hideoutScene');
  const key = '0123456789abcdef01234567';
  expect(hideoutCacheFile(key, 'particles/bundle.json')).toBe(join(h.userData, 'viewer-scenes', key, 'particles', 'bundle.json'));
  expect(hideoutCacheFile(key, 'particles/tex/materials_test.mip2.png')).toBe(join(h.userData, 'viewer-scenes', key, 'particles', 'tex', 'materials_test.mip2.png'));
  expect(hideoutCacheFile(key, 'particles/../scene.json')).toBeNull();
  expect(hideoutCacheFile(key, 'particles/tex/../../settings.json')).toBeNull();
  expect(hideoutCacheFile(key, 'cookies/hideout_projector_watch_00.png')).toBe(join(h.userData, 'viewer-scenes', key, 'cookies', 'hideout_projector_watch_00.png'));
  expect(hideoutCacheFile(key, 'cookies/../scene.json')).toBeNull();
  // Every file the renderer requests from a scene cache is served, including the fog's light shadows.
  for (const file of ['models.glb', 'irradiance.hdr', 'direction.png', 'shadows.png', 'reflection.bin', 'probes.bin', 'probe-shadows.bin', 'color-correction.bin', 'sky.bin', 'fog.bin', 'fog-shadows.bin']) {
    expect(hideoutCacheFile(key, file)).toBe(join(h.userData, 'viewer-scenes', key, file));
  }
});

it('clips a shadowed barn light to its precomputed illumination box', async () => {
  const { lightIlluminationBounds } = await import('./hideoutScene');
  const projector = { precomputedfieldsvalid: '1', castshadows: '1', precomputedobborigin: '12248.35 -5452.82 -224.34',
    precomputedobbangles: '0 90 0', precomputedobbextent: '127.5 153.7 126' };
  const bounds = lightIlluminationBounds(projector);
  if (!('bounds' in bounds)) throw new Error('Expected bounds.');
  // The box's +X axis is yawed onto Source +Y, scaled by its half extent, around its origin.
  expect(bounds.bounds[0]).toBeCloseTo(0, 6);
  expect(bounds.bounds[1]).toBeCloseTo(127.5, 6);
  expect(bounds.bounds.slice(12, 15)).toEqual([12248.35, -5452.82, -224.34]);
  expect(lightIlluminationBounds({ ...projector, castshadows: '0' })).toEqual({});
  expect(lightIlluminationBounds({ ...projector, castshadows: '0', bakedshadowindex: 2 })).toHaveProperty('bounds');
  expect(lightIlluminationBounds({ ...projector, precomputedfieldsvalid: '0' })).toEqual({});
});

it('reads a fixed master exposure in linear or log2 units with compensation', async () => {
  const { fixedMapExposure } = await import('./hideoutScene');
  expect(fixedMapExposure({ minlogexposure: 0, maxlogexposure: 0 })).toBe(1);
  expect(fixedMapExposure({ minlogexposure: -2, maxlogexposure: -2, exposurecompensation: 1 })).toBe(0.5);
  expect(fixedMapExposure({ minexposure: 0.25, maxexposure: 0.25 })).toBe(0.25);
  expect(fixedMapExposure({ minlogexposure: -2, maxlogexposure: 2 })).toBe(null);
  expect(fixedMapExposure({ enableexposure: false, exposurecompensation: 2 })).toBe(4);
});

it('decodes the authored logarithmic white point instead of treating it as linear', async () => {
  const { parseMapTonemap } = await import('./hideoutScene');
  expect(parseMapTonemap({ m_bHasTonemapParams: true, m_toneMapParams: {
    m_flExposureBias: 1, m_flShoulderStrength: 0.2, m_flLinearStrength: 0.3, m_flLinearAngle: 0.1,
    m_flToeStrength: 0.2, m_flToeNum: 0.02, m_flToeDenom: 0.3, m_flWhitePoint: 4,
  } })).toMatchObject({ exposureBias: 1, white: 16 });
});

describe('hideout scene prebuild', () => {
  it('waits for a first open, then rebuilds after a game update and removes the old fingerprint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hideout-prebuild-'));
    const dl = join(root, 'dl');
    h.userData = join(root, 'userdata');
    h.binary = join(root, 'vpkmerge.exe');
    writeFileSync(h.binary, 'test exporter');
    mkdirSync(join(dl, 'game', 'citadel', 'maps'), { recursive: true });
    writeFileSync(join(dl, 'game', 'citadel', 'maps', 'dl_hideout.vpk'), 'map');
    writeFileSync(join(dl, 'game', 'citadel', 'pak01_dir.vpk'), 'base');
    vi.resetModules();
    const { loadHideoutScene, prebuildHideoutScene } = await import('./hideoutScene');
    h.exported = [];
    await prebuildHideoutScene(dl);
    expect(h.exported).toEqual([]);
    expect(existsSync(join(h.userData, 'viewer-scenes'))).toBe(false);

    const opened = await loadHideoutScene(dl);
    writeFileSync(join(dl, 'game', 'citadel', 'maps', 'dl_hideout.vpk'), 'updated map');
    h.exported = [];
    await prebuildHideoutScene(dl);
    expect(h.exported.sort()).toEqual(['models/a.vmdl_c', 'models/b.vmdl_c']);
    expect(readdirSync(join(h.userData, 'viewer-scenes'))).not.toContain(opened.key);

    h.exported = [];
    const next = await loadHideoutScene(dl);
    expect(h.exported).toEqual([]);
    expect(readdirSync(join(h.userData, 'viewer-scenes'))).toEqual([next.key]);
  });
});

describe('hideout as the default scene', () => {
  it('builds for a player who never opened it, and only then reports the scene ready', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hideout-default-'));
    const dl = join(root, 'dl');
    h.userData = join(root, 'userdata');
    h.binary = join(root, 'vpkmerge.exe');
    writeFileSync(h.binary, 'test exporter');
    mkdirSync(join(dl, 'game', 'citadel', 'maps'), { recursive: true });
    writeFileSync(join(dl, 'game', 'citadel', 'maps', 'dl_hideout.vpk'), 'map');
    writeFileSync(join(dl, 'game', 'citadel', 'pak01_dir.vpk'), 'base');
    vi.resetModules();
    const { hideoutSceneReady, prebuildHideoutScene } = await import('./hideoutScene');
    expect(await hideoutSceneReady(dl)).toBe(false);
    h.exported = [];
    await prebuildHideoutScene(dl, { everyone: true });
    expect(h.exported.sort()).toEqual(['models/a.vmdl_c', 'models/b.vmdl_c']);
    expect(await hideoutSceneReady(dl)).toBe(true);
    writeFileSync(join(dl, 'game', 'citadel', 'maps', 'dl_hideout.vpk'), 'updated map');
    expect(await hideoutSceneReady(dl)).toBe(false);
  });

  it('keeps the most recent room snapshots inside the scene cache it was drawn from', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hideout-snapshot-'));
    const dl = join(root, 'dl');
    h.userData = join(root, 'userdata');
    h.binary = join(root, 'vpkmerge.exe');
    writeFileSync(h.binary, 'test exporter');
    mkdirSync(join(dl, 'game', 'citadel', 'maps'), { recursive: true });
    writeFileSync(join(dl, 'game', 'citadel', 'maps', 'dl_hideout.vpk'), 'map');
    writeFileSync(join(dl, 'game', 'citadel', 'pak01_dir.vpk'), 'base');
    vi.resetModules();
    const { hideoutCacheFile, loadHideoutScene, saveHideoutSnapshot } = await import('./hideoutScene');
    const { key } = await loadHideoutScene(dl);
    const name = (i: number) => `${i.toString(16).padStart(16, '0')}.bin`;
    expect(hideoutCacheFile(key, `snapshots/${name(1)}`)).toBe(join(h.userData, 'viewer-scenes', key, 'snapshots', name(1)));
    expect(hideoutCacheFile(key, 'snapshots/../scene.json')).toBeNull();
    await expect(saveHideoutSnapshot(key, '../scene.json', new Uint8Array(4))).rejects.toThrow();
    await expect(saveHideoutSnapshot('0123456789abcdef01234567', name(1), new Uint8Array(4))).rejects.toThrow();
    for (let i = 0; i < 10; i++) {
      await saveHideoutSnapshot(key, name(i), new Uint8Array([i]));
      // Distinct modification times order the eviction.
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    expect(readdirSync(join(h.userData, 'viewer-scenes', key, 'snapshots')).sort()).toEqual([2, 3, 4, 5, 6, 7, 8, 9].map(name));
  });
});
