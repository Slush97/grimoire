import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userData: '',
  run: vi.fn<(args: string[]) => Promise<void>>(),
  stdout: vi.fn<(args: string[]) => Promise<string>>(),
  handle: vi.fn(),
  fetch: vi.fn<(url: string) => Promise<Response>>(),
  particles: vi.fn(),
  resources: new Map<string, unknown>(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => h.userData, isPackaged: true },
  protocol: { handle: h.handle },
  net: { fetch: h.fetch },
}));
vi.mock('./modMerger', () => ({
  runVpkmerge: h.run, runVpkmergeStdout: h.stdout, verifyVpkOutput: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./heroParticleExport', () => ({ exportParticleBundle: h.particles }));
vi.mock('./heroCodenames', () => ({
  codenamesForHero: (name: string) => name === 'Seven' ? ['gigawatt'] : name === 'Twin' ? ['twin_a', 'twin_b'] : ['yamato'],
}));
vi.mock('./deadlock', () => ({
  getCitadelPath: (path: string) => join(path, 'game', 'citadel'),
  getAddonsPath: (path: string) => join(path, 'game', 'citadel', 'addons'),
  getDisabledPath: (path: string) => join(path, 'game', 'citadel', '.disabled'),
}));

vi.mock('./heroAnimationMetadata', () => ({ readHeroAnimationMetadata: async () => new Map() }));
vi.mock('./vpk', async importOriginal => {
  const original = await importOriginal<typeof import('./vpk')>();
  return { ...original,
    parseVpkDirectoryCached: (path: string) => h.resources.size ? [...h.resources.keys()] : original.parseVpkDirectoryCached(path),
    vpkHasEntry: (path: string, entry: string) => h.resources.has(entry) || original.vpkHasEntry(path, entry),
  };
});
import { choosePreviewClips, exportHeroEffect, getHeroEffectInfo, exportRiggedHeroPose, getRiggedHeroPose, registerHeroPoseProtocol, sweepHeroPoseCache } from './heroPoseModels';

const container = resolve('.codex-run', 'hero-preview-tests');
const clips = JSON.stringify([{ name: 'primary_stand_idle', frameCount: 31, fps: 30, durationSeconds: 1, looping: true, default: true }]);
const argument = (args: string[], name: string) => args[args.indexOf(name) + 1];
const game = () => join(h.userData, 'game-install');
const cacheDir = (key: string) => join(h.userData, 'hero-poses', key.toLowerCase().replace(/[^a-zA-Z0-9_-]+/g, '_'));

function rigGlb(animated: boolean, compatible = true, duration = 1): Buffer {
  const nodes = [{ name: 'root_motion', children: [1] }, { name: compatible ? 'pelvis' : 'other_pelvis' }];
  const data = JSON.stringify({ nodes, accessors: [{ max: [duration] }], animations: animated ? [{ samplers: [{ input: 0 }], channels: [0, 1].map((node) => ({ target: { node } })) }] : [] });
  const json = Buffer.from(data.padEnd(Math.ceil(data.length / 4) * 4, ' '));
  const glb = Buffer.alloc(20 + json.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  return glb;
}

async function skinFixture() {
  const dir = join(game(), 'game', 'citadel', 'addons');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'skin_dir.vpk'), 'selected skin');
  return [{ metaKey: 'skin_dir.vpk', priority: 0 }];
}

describe('animation menu exports', () => {
  const clip = (name: string, frames = 100) => ({ name, frameCount: frames, fps: 30, durationSeconds: frames / 30, looping: true, default: false });
  it('exports reviewed whole actions rather than raw category matches', () => {
    const menu = choosePreviewClips([clip('primary_stand_idle'), clip('primary_run_n'), clip('ui_hero_pose'),
      clip('reload'), clip('additive_aim_reload'), clip('bind_pose', 1)]);
    expect(menu.map((c) => c.name)).toEqual(['primary_stand_idle', 'ui_hero_pose']);
  });
  it('bounds decoded animation frames and refuses clipless meshes', () => {
    const menu = choosePreviewClips([clip('primary_stand_idle'), ...Array.from({ length: 100 }, (_, i) => clip(`attack_${i}`, 6000))]);
    expect(menu.reduce((sum, c) => sum + c.frameCount, 0)).toBeLessThanOrEqual(10000);
    expect(choosePreviewClips([clip('bind_pose', 1)])).toEqual([]);
  });
  it('exports Mirage from the reworked body, including its matching physics', async () => {
    await exportRiggedHeroPose(game(), 'Mirage');
    expect(h.run.mock.calls[0][0]).toContain('models/heroes_staging/mirage_v2/mirage.vmdl_c');
    const physics = h.stdout.mock.calls.find(([args]) => args[1] === 'femodel')?.[0];
    expect(physics).toContain('models/heroes_staging/mirage_v2/mirage.vmdl_c');
  });
});

describe('mounted ambient particle textures', () => {
  it('keys selected skin textures by content and passes skin before Citadel before core', async () => {
    const addons = join(game(), 'game', 'citadel', 'addons');
    await fs.mkdir(addons, { recursive: true });
    const skin = join(addons, 'one_dir.vpk');
    await fs.writeFile(skin, 'first texture version');
    h.particles.mockImplementation(async (_pak, _entry, descriptor: string) => fs.writeFile(descriptor, '{}'));
    const sources = [{ metaKey: 'one_dir.vpk', priority: 0 }];
    const info = await exportHeroEffect(game(), 'Rem', sources);
    expect(info.hasEffect).toBe(true);
    expect(h.particles.mock.calls[0][1]).toBe('particles/abilities/familiar/familiar_ambient_candle.vpcf_c');
    expect(h.particles.mock.calls[0][6]).toBe('preview');
    expect(JSON.parse(await fs.readFile(join(cacheDir(info.key), 'effect.json'), 'utf8')).previewControlPointComponents).toEqual({2:1});
    expect(h.particles.mock.calls[0][5]).toEqual([skin, join(game(), 'game', 'citadel', 'pak01_dir.vpk'), join(game(), 'game', 'core', 'pak01_dir.vpk')]);
    expect((await getHeroEffectInfo(game(), 'Rem', sources)).hasEffect).toBe(true);
    expect((await getHeroEffectInfo(game(), 'Rem')).hasEffect).toBe(false);
    await fs.writeFile(skin, 'changed texture version with a different size');
    const changed = await getHeroEffectInfo(game(), 'Rem', sources);
    expect(changed.key).not.toBe(info.key);
    expect(changed.hasEffect).toBe(false);
    h.particles.mockRejectedValue(new Error('decode failed'));
    await expect(exportHeroEffect(game(), 'Rem', sources)).rejects.toThrow('decode failed');
    expect((await getHeroEffectInfo(game(), 'Rem', sources)).hasEffect).toBe(false);
  });
});

beforeEach(async () => {
  vi.resetAllMocks();
  h.resources.clear();
  await fs.mkdir(container, { recursive: true });
  h.userData = await fs.mkdtemp(join(container, 'run-'));
  h.run.mockImplementation(async (args) => {
    const out = args.includes('--out') ? argument(args, '--out') : args[0];
    await fs.writeFile(out, 'synthetic model');
  });
  h.stdout.mockImplementation(async (args) => args[1] === 'clips' ? clips : JSON.stringify({
    source: argument(args, '--vpk'), selector: argument(args, args.includes('--entry') ? '--entry' : '--hero'),
  }));
  h.fetch.mockImplementation(async (url) => new Response(await fs.readFile(fileURLToPath(url), 'utf8')));
});

afterEach(async () => {
  await sweepHeroPoseCache();
  if (dirname(resolve(h.userData)) !== container) throw new Error('Test cleanup escaped its directory');
  await fs.rm(h.userData, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('rigged preview physics bundle', () => {
  it('exports an external idle on the base rig and retries an old no-clip marker', async () => {
    const entry = 'models/heroes_wip/deadpack/deadpack.vmdl_c';
    const resource = 'models/heroes_wip/deadpack/clips/ui_shop.vnmclip_c';
    h.resources.set(entry, {});
    h.resources.set(resource, { m_nNumFrames: 61, m_flDuration: 2, m_bIsAdditive: false,
      m_rootMotion: { m_flAverageLinearVelocity: 0, m_flAverageAngularVelocityRadians: 0 } });
    h.stdout.mockImplementation(async args => args[1] === 'clips' ? '[]' : args[0] === 'soundevents'
      ? JSON.stringify(h.resources.get(args[1]) ?? null) : 'null');
    h.run.mockImplementation(async args => fs.writeFile(argument(args, '--out'), rigGlb(args[0] === 'workshop')));
    const dir = cacheDir('Deadman Danny::vanilla');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, '.rigged-no-clips'), '23.x1');
    const info = await exportRiggedHeroPose(game(), 'Deadman Danny');
    expect(info).toMatchObject({ hasModel: true, hasAnimationFallback: true });
    expect(h.run.mock.calls.find(([args]) => args[1] === 'export')?.[0]).toContain('--no-anim');
    const donor = h.run.mock.calls.find(([args]) => args[1] === 'motions' && args.includes(`ui_shop=${resource}`))?.[0];
    expect(donor).toContain(entry);
    expect(donor?.filter(arg => arg === '--vpk')).toHaveLength(1);
    expect((await getRiggedHeroPose(game(), 'Deadman Danny')).hasModel).toBe(true);
    expect(await fs.stat(join(dir, '.rigged-no-clips')).catch(() => null)).toBeNull();
  });

  it('takes the base rig motions when the skin rig is refused', async () => {
    const sources = await skinFixture();
    const entry = 'models/heroes_wip/deadpack/deadpack.vmdl_c';
    const resource = 'models/heroes_wip/deadpack/clips/ui_shop.vnmclip_c';
    h.resources.set(entry, {});
    h.resources.set(resource, { m_nNumFrames: 61, m_flDuration: 2, m_bIsAdditive: false,
      m_rootMotion: { m_flAverageLinearVelocity: 0, m_flAverageAngularVelocityRadians: 0 } });
    h.stdout.mockImplementation(async args => args[1] === 'clips' ? '[]' : args[0] === 'soundevents'
      ? JSON.stringify(h.resources.get(args[1]) ?? null) : 'null');
    h.run.mockImplementation(async (args) => {
      if (args[0] === 'workshop' && args.filter(arg => arg === '--vpk').length > 1) throw new Error('Motion does not match the selected rig');
      await fs.writeFile(argument(args, '--out'), rigGlb(args[0] === 'workshop'));
    });
    const info = await exportRiggedHeroPose(game(), 'Deadman Danny', sources);
    expect(info).toMatchObject({ hasModel: true, hasAnimationFallback: true });
    const donors = h.run.mock.calls.filter(([args]) => args[0] === 'workshop' && argument(args, '--out').endsWith('.animation-donor.glb'));
    expect(donors.map(([args]) => args.filter(arg => arg === '--vpk').length)).toEqual([2, 1]);
    expect(argument(donors[1][0], '--vpk')).toBe(join(game(), 'game', 'citadel', 'pak01_dir.vpk'));
  });

  it('rejects a donor whose animation duration cannot play in the viewer', async () => {
    const sources = await skinFixture();
    h.run.mockImplementation(async args => fs.writeFile(argument(args, '--out'), rigGlb(args[0] === 'workshop', true, 0.001)));
    expect((await exportRiggedHeroPose(game(), 'Lash', sources)).hasModel).toBe(false);
  });

  it('resolves the live entry for heroes selected by codename', async () => {
    const sources = await skinFixture();
    h.stdout.mockImplementation(async (args) => args[1] === 'clips' ? clips
      : args[1] === 'live-materials' ? JSON.stringify([{ model_entry: 'models/heroes_wip/other/other.vmdl_c' }]) : 'null');
    h.run.mockImplementation(async (args) => fs.writeFile(argument(args, '--out'), rigGlb(args[0] === 'workshop')));
    expect((await exportRiggedHeroPose(game(), 'Other', sources)).hasAnimationFallback).toBe(true);
    expect(h.run.mock.calls.find(([args]) => args[0] === 'workshop')![0]).toContain('models/heroes_wip/other/other.vmdl_c');
  });

  it.each([false, true])('recovers base animations when a skin has unrelated clips: %s', async (unrelated) => {
    const sources = await skinFixture();
    h.stdout.mockImplementation(async (args) => args[1] === 'clips'
      ? unrelated && argument(args, '--vpk').endsWith('skin_dir.vpk') ? '[]' : clips
      : 'null');
    h.run.mockImplementation(async (args) => fs.writeFile(argument(args, '--out'), rigGlb(args[0] === 'workshop')));
    const info = await exportRiggedHeroPose(game(), 'Lash', sources);
    expect(info).toMatchObject({ hasModel: true, hasAnimationFallback: true });
    expect(info.key).toContain('skin_dir.vpk');
    if (unrelated) expect(h.run.mock.calls.find(([args]) => args[0] === 'model')![0]).toContain('--no-anim');
    const donor = h.run.mock.calls.find(([args]) => args[0] === 'workshop' && argument(args, '--out').endsWith('.animation-donor.glb'))![0];
    expect(argument(donor, '--vpk')).toBe(join(game(), 'game', 'citadel', 'pak01_dir.vpk'));
    expect(donor).toContain('primary_stand_idle=legacy:primary_stand_idle');
    expect(await getRiggedHeroPose(game(), 'Lash', sources)).toMatchObject({ hasModel: true, hasAnimationFallback: true });
    await fs.unlink(join(cacheDir(info.key), 'animation-fallback.glb'));
    expect((await getRiggedHeroPose(game(), 'Lash', sources)).hasModel).toBe(false);
  });

  it('refuses an incompatible animation donor and leaves static fallback available', async () => {
    const sources = await skinFixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.run.mockImplementation(async (args) => fs.writeFile(argument(args, '--out'), rigGlb(args[0] === 'workshop', args[0] === 'workshop')));
    const info = await exportRiggedHeroPose(game(), 'Lash', sources);
    expect(info.hasModel).toBe(false);
    expect(await fs.stat(join(cacheDir(info.key), 'animation-fallback.glb')).catch(() => null)).toBeNull();
    expect(await fs.stat(join(cacheDir(info.key), '.animation-donor.glb')).catch(() => null)).toBeNull();
  });

  it('retries transient donor failures instead of recording them as clipless', async () => {
    const sources = await skinFixture();
    h.run.mockImplementation(async (args) => {
      if (args[0] === 'workshop') throw new Error('donor interrupted');
      await fs.writeFile(argument(args, '--out'), rigGlb(false));
    });
    await expect(exportRiggedHeroPose(game(), 'Lash', sources)).rejects.toThrow('donor interrupted');
    h.run.mockImplementation(async (args) => fs.writeFile(argument(args, '--out'), rigGlb(args[0] === 'workshop')));
    expect((await exportRiggedHeroPose(game(), 'Lash', sources)).hasModel).toBe(true);
  });

  it('extracts physics using the successful mesh selector', async () => {
    const write = h.run.getMockImplementation()!;
    h.run.mockImplementation(async (args) => {
      if (argument(args, '--hero') === 'gigawatt_prisoner') throw new Error('old model unavailable');
      await write(args);
    });
    const info = await exportRiggedHeroPose(game(), 'Seven');
    await sweepHeroPoseCache();
    expect(info.hasModel).toBe(true);
    const cloth = JSON.parse(await fs.readFile(join(cacheDir(info.key), 'cloth-rigged.json'), 'utf8'));
    expect(cloth.selector).toBe('models/heroes_staging/gigawatt_prisoner/gigawatt_prisoner.vmdl_c');
    const meshArgs = h.run.mock.calls.findLast(([args]) => args[0] === 'model' && args[1] === 'export')![0];
    const clothArgs = h.stdout.mock.calls.filter(([args]) => args[1] === 'femodel');
    expect(clothArgs).toHaveLength(1);
    expect(cloth.source).toBe(argument(meshArgs, '--vpk'));
    expect(argument(clothArgs[0][0], '--base')).toBe(argument(meshArgs, '--base'));
    expect(argument(clothArgs[0][0], '--entry')).toBe(argument(meshArgs, '--entry'));
  });

  it('keeps the single-skin fallback model and physics on the same source', async () => {
    const addons = join(game(), 'game', 'citadel', 'addons');
    await fs.mkdir(addons, { recursive: true });
    for (const name of ['one_dir.vpk', 'two_dir.vpk']) await fs.writeFile(join(addons, name), name);
    const write = h.run.getMockImplementation()!;
    h.run.mockImplementation(async (args) => {
      if (args[0] === 'model' && argument(args, '--vpk').endsWith('stack_dir.vpk')) throw new Error('stack cannot export');
      await write(args);
    });
    const info = await exportRiggedHeroPose(game(), 'Yamato', [
      { metaKey: 'one_dir.vpk', priority: 1 }, { metaKey: 'two_dir.vpk', priority: 2 },
    ], 'one_dir.vpk');
    expect(info.hasModel).toBe(true);
    expect(info.key).toContain('::one_dir.vpk::');
    const cloth = JSON.parse(await fs.readFile(join(cacheDir(info.key), 'cloth-rigged.json'), 'utf8'));
    expect(cloth.source).toBe(join(addons, 'one_dir.vpk'));
    const physics = h.stdout.mock.calls.filter(([args]) => args[1] === 'femodel');
    expect(argument(physics.at(-1)![0], '--vpk')).toBe(join(addons, 'one_dir.vpk'));
  });

  it('retains animation with an explicit null sidecar when physics extraction fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.stdout.mockImplementation(async (args) => {
      if (args[1] === 'femodel') throw new Error('no physics');
      return clips;
    });
    const info = await exportRiggedHeroPose(game(), 'Yamato');
    expect(info.hasModel).toBe(true);
    expect(await fs.readFile(join(cacheDir(info.key), 'cloth-rigged.json'), 'utf8')).toBe('null');
    expect((await getRiggedHeroPose(game(), 'Yamato')).hasModel).toBe(true);
  });

  it('requires a complete pair and invalidates the marker before a failed refresh', async () => {
    const info = await exportRiggedHeroPose(game(), 'Yamato');
    await sweepHeroPoseCache();
    await fs.unlink(join(cacheDir(info.key), 'cloth-rigged.json'));
    expect((await getRiggedHeroPose(game(), 'Yamato')).hasModel).toBe(false);
    await exportRiggedHeroPose(game(), 'Yamato');
    await sweepHeroPoseCache();
    h.run.mockRejectedValue(new Error('export interrupted'));
    await expect(exportRiggedHeroPose(game(), 'Yamato')).rejects.toThrow('export interrupted');
    expect((await getRiggedHeroPose(game(), 'Yamato')).hasModel).toBe(false);
  });

  it('records a clipless rigged export once and skips re-exporting it', async () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, animations: [] }).padEnd(48, ' '));
    const glb = Buffer.alloc(20 + json.length);
    glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
    h.run.mockImplementation(async (args) => fs.writeFile(argument(args, '--out'), glb));
    expect((await exportRiggedHeroPose(game(), 'Yamato')).hasModel).toBe(false);
    expect(await fs.readFile(join(cacheDir((await getRiggedHeroPose(game(), 'Yamato')).key), 'cloth-rigged.json'), 'utf8').catch(() => null)).toBeNull();
    const spawns = h.run.mock.calls.length + h.stdout.mock.calls.length;
    expect((await getRiggedHeroPose(game(), 'Yamato')).hasModel).toBe(false);
    expect((await exportRiggedHeroPose(game(), 'Yamato')).hasModel).toBe(false);
    expect(h.run.mock.calls.length + h.stdout.mock.calls.length).toBe(spawns);
  });

  it('shares one rigged export between concurrent requests for the same stack', async () => {
    const [first, second] = await Promise.all([exportRiggedHeroPose(game(), 'Yamato'), exportRiggedHeroPose(game(), 'Yamato')]);
    expect(second).toEqual(first);
    expect(h.run.mock.calls.filter(([args]) => args[0] === 'model' && args[1] === 'export')).toHaveLength(1);
  });

  it('does not record a clipless marker when another selector failed to list clips', async () => {
    h.stdout.mockImplementation(async (args) => {
      if (args[1] !== 'clips') return 'null';
      if (argument(args, '--hero') === 'twin_a') throw new Error('transient read failure');
      return '[]';
    });
    expect((await exportRiggedHeroPose(game(), 'Twin')).hasModel).toBe(false);
    const listings = () => h.stdout.mock.calls.filter(([args]) => args[1] === 'clips').length;
    const before = listings();
    expect((await exportRiggedHeroPose(game(), 'Twin')).hasModel).toBe(false);
    expect(listings()).toBeGreaterThan(before);
  });

  it('preserves a current rigged-only cache when sweeping old static entries', async () => {
    const info = await exportRiggedHeroPose(game(), 'Yamato');
    await sweepHeroPoseCache();
    const dir = cacheDir(info.key);
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    for (const file of await fs.readdir(dir)) await fs.utimes(join(dir, file), past, past);
    await sweepHeroPoseCache();
    expect((await getRiggedHeroPose(game(), 'Yamato')).hasModel).toBe(true);
  });

  it('serves the matching sidecar through the preview protocol', async () => {
    const info = await exportRiggedHeroPose(game(), 'Yamato');
    registerHeroPoseProtocol();
    const handler = h.handle.mock.calls.at(-1)![1] as (request: Request) => Promise<Response>;
    const request = Object.assign(new Request(`grimoire-hero://m/${encodeURIComponent(info.key)}/cloth-rigged.json?v=42`), { initiatorOrigin: 'file://' });
    const response = await handler(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ selector: 'models/heroes_staging/yamato_v2/yamato.vmdl_c' });
    expect(fileURLToPath(h.fetch.mock.calls.at(-1)![0])).toBe(join(cacheDir(info.key), 'cloth-rigged.json'));
  });
});
