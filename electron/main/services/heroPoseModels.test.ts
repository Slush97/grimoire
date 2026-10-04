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
}));
vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  protocol: { handle: h.handle },
  net: { fetch: h.fetch },
}));
vi.mock('./modMerger', () => ({
  runVpkmerge: h.run, runVpkmergeStdout: h.stdout, verifyVpkOutput: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./heroParticleExport', () => ({ exportParticleBundle: h.particles }));
vi.mock('./heroPortraits', () => ({ codenamesForHero: (name: string) => name === 'Seven' ? ['gigawatt'] : ['yamato'] }));
vi.mock('./deadlock', () => ({
  getCitadelPath: (path: string) => join(path, 'game', 'citadel'),
  getAddonsPath: (path: string) => join(path, 'game', 'citadel', 'addons'),
  getDisabledPath: (path: string) => join(path, 'game', 'citadel', '.disabled'),
}));

vi.mock('./heroAnimationMetadata', () => ({ readHeroAnimationMetadata: async () => new Map() }));
import { choosePreviewClips, exportHeroEffect, getHeroEffectInfo, exportRiggedHeroPose, getRiggedHeroPose, registerHeroPoseProtocol, sweepHeroPoseCache } from './heroPoseModels';

const container = resolve('.codex-run', 'hero-preview-tests');
const clips = JSON.stringify([{ name: 'primary_stand_idle', frameCount: 31, fps: 30, durationSeconds: 1, looping: true, default: true }]);
const argument = (args: string[], name: string) => args[args.indexOf(name) + 1];
const game = () => join(h.userData, 'game-install');
const cacheDir = (key: string) => join(h.userData, 'hero-poses', key.toLowerCase().replace(/[^a-zA-Z0-9_-]+/g, '_'));

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
  await fs.mkdir(container, { recursive: true });
  h.userData = await fs.mkdtemp(join(container, 'run-'));
  h.run.mockImplementation(async (args) => {
    const out = args[0] === 'model' ? argument(args, '--out') : args[0];
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
    const meshArgs = h.run.mock.calls.at(-1)![0];
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
    expect(h.stdout.mock.calls.filter(([args]) => args[1] === 'femodel')).toHaveLength(1);
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
    const response = await handler(new Request(`grimoire-hero://m/${encodeURIComponent(info.key)}/cloth-rigged.json?v=42`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ selector: 'models/heroes_staging/yamato_v2/yamato.vmdl_c' });
    expect(fileURLToPath(h.fetch.mock.calls.at(-1)![0])).toBe(join(cacheDir(info.key), 'cloth-rigged.json'));
  });
});
