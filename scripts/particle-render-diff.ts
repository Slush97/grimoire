// Compares the three.js particle renderer (src/lib/particles/render) with ValveResourceFormat's own
// OpenGL renderer through the render oracle (tools/particle-render-oracle): same system, seed, dt,
// control points, frames, camera and resolution. Writes, per captured frame, the oracle and ours side
// by side with a diff (x4) and prints the error.
//
// usage: pnpm exec tsx scripts/particle-render-diff.ts <particles/...vpcf> [--capture 96,192] [--size 512x512]
//        [--seed N] [--cp N=x,y,z]... [--lighting viewer|none] [--refresh] [--out dir] [--headed]
//        [--bundle .codex-run/hero-particles/<Hero>]
//
// Oracle runs are cached under .codex-run/render/<key>/; --refresh reruns. Textures are decoded once
// with vpkmerge into .codex-run/render/textures/ (read in place from the game's VPKs). --bundle draws
// ours from a hero particle bundle instead of the corpus: the definitions, formats and snapshots the
// hero viewer runs (the oracle reads the same files from the VPKs).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { readVpkEntryBytes, vpkHasEntry } from '../electron/main/services/vpk';
import type { KVObject, KVValue } from '../src/lib/particles/kv';
import type { ParticleBundle } from '../src/lib/particles/host/bundle';
import { postSettingsFromVpost } from '../src/lib/particles/render/post/sourcePostProcess';
import { readParticleTextureInfo, type ParticleTextureInfo } from '../src/lib/particles/render/sheet';
import { type ParticleMaterialData, type SerializedModelMesh, particleResourceKey, readParticleMaterial, serializeModelMesh } from '../src/lib/particles/render/particleModels';
import { PackageStack } from '../electron/main/services/heroParticleSources';
import { exportParticleModelMesh } from '../electron/main/services/particleMeshExport';
import { nodeVpkmerge } from './lib/nodeVpkmerge';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = process.env.DEADLOCK_GAME ?? 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game';
const paks = [join(game, 'citadel/pak01_dir.vpk'), join(game, 'core/pak01_dir.vpk')];
const corpus = process.env.PARTICLE_CORPUS ?? join(root, '.codex-run/fx-corpus/json');
const oracleExe = process.env.PARTICLE_RENDER_ORACLE ?? join(root, '.codex-run/particle-render-oracle/bin/Release/net10.0/Source2Viewer.exe');
const vpkmerge =
  process.env.VPKMERGE ??
  [join(root, 'resources/vpkmerge/vpkmerge.exe'), join(root, 'resources/vpkmerge/vpkmerge-windows-x86_64.exe'), join(root, 'resources/vpkmerge/vpkmerge-linux-x86_64')].find(existsSync)!;

/** The textures the renderers fall back to when a definition names none. */
const DEFAULT_TEXTURES = ['materials/particle/base_sprite.vtex', 'materials/particle/base_rope.vtex', 'materials/particle/base_trail.vtex'];

/** A light the oracle's light renderers keep in use (DescribeLights in tools/particle-render-oracle/Program.cs). */
interface OracleLight {
  renderer: string;
  color: number[];
  linearBrightness: number;
  brightnessScale: number;
  range: number;
  spotInnerAngle: number;
  spotOuterAngle: number;
  fallOff: number;
  position: number[];
  direction: number[];
}

/** The largest relative error of each light field, lights matched in draw order. */
function compareLights(oracle: OracleLight[], ours: OracleLight[]): string {
  if (oracle.length !== ours.length) return `count ${ours.length} (oracle ${oracle.length})`;
  const errors: Record<string, number> = {};
  const relative = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-6);
  oracle.forEach((light, i) => {
    for (const key of Object.keys(light) as (keyof OracleLight)[]) {
      const a = ours[i][key];
      const b = light[key];
      if (typeof b === 'string' || a === undefined) continue;
      const error = Array.isArray(b) ? Math.max(...b.map((value, c) => relative((a as number[])[c], value))) : relative(a as number, b);
      errors[key] = Math.max(errors[key] ?? 0, error);
    }
  });
  return `${oracle.length} (${oracle[0]?.renderer ?? ''}) max relative error ` + Object.entries(errors).map(([key, value]) => `${key} ${value.toExponential(2)}`).join(', ');
}

interface Options {
  system: string;
  captures: number[];
  size: [number, number];
  seed?: number;
  cps: string[];
  lighting: string;
  refresh: boolean;
  out?: string;
  headed: boolean;
  fov: number;
  only?: string;
  post?: string;
  exposure?: number;
  bundle?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { system: '', captures: [96, 192], size: [512, 512], cps: [], lighting: 'viewer', refresh: false, headed: false, fov: 60 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];

    switch (arg) {
      case '--capture':
        options.captures = value().split(',').map(Number);
        break;
      case '--size':
        options.size = value().split('x').map(Number) as [number, number];
        break;
      case '--seed':
        options.seed = Number(value());
        break;
      case '--cp':
        options.cps.push(value());
        break;
      case '--lighting':
        options.lighting = value();
        break;
      case '--post':
        options.post = value().replace(/_c$/, '');
        break;
      case '--exposure':
        options.exposure = Number(value());
        break;
      case '--only':
        options.only = value();
        break;
      case '--fov':
        options.fov = Number(value());
        break;
      case '--refresh':
        options.refresh = true;
        break;
      case '--out':
        options.out = value();
        break;
      case '--headed':
        options.headed = true;
        break;
      case '--bundle':
        options.bundle = resolve(value());
        break;
      default:
        if (arg.startsWith('--') || options.system !== '') {
          throw new Error(`Unknown argument ${arg}`);
        }
        options.system = arg.replace(/_c$/, '');
    }
  }

  if (options.system === '') {
    throw new Error('usage: particle-render-diff.ts <particles/...vpcf> [--capture 96,192]');
  }

  return options;
}

function runOracle(options: Options, dir: string): Record<string, unknown> {
  const meta = join(dir, 'meta.json');

  if (options.refresh || !existsSync(meta)) {
    mkdirSync(dir, { recursive: true });
    const args = [
      '--vpk', paks[0], '--system', options.system, '--out', dir,
      '--capture', options.captures.join(','), '--size', options.size.join('x'),
      '--camera', 'auto', '--fov', String(options.fov), '--lighting', options.lighting,
    ];

    if (options.seed !== undefined) {
      args.push('--seed', String(options.seed));
    }

    for (const cp of options.cps) {
      args.push('--cp', cp);
    }

    if (options.only !== undefined) {
      args.push('--only', options.only);
    }

    if (options.post !== undefined) {
      args.push('--post', options.post);
    }

    if (options.exposure !== undefined) {
      args.push('--exposure', String(options.exposure));
    }

    execFileSync(oracleExe, args, { stdio: 'inherit' });
  }

  return JSON.parse(readFileSync(meta, 'utf8')) as Record<string, unknown>;
}

/** Every definition of the tree, read from the decoded corpus. */
function loadDefinitions(system: string, out: Record<string, KVObject> = {}): Record<string, KVObject> {
  const key = system.replace(/\.vpcf(_c)?$/, '.vpcf');

  if (key in out) {
    return out;
  }

  const file = join(corpus, `${key.replace(/\.vpcf$/, '')}.json`);

  if (!existsSync(file)) {
    return out;
  }

  const definition = JSON.parse(readFileSync(file, 'utf8')) as KVObject;
  out[key] = definition;

  for (const child of (definition.m_Children as KVObject[] | undefined) ?? []) {
    if (typeof child.m_ChildRef === 'string') {
      loadDefinitions(child.m_ChildRef, out);
    }
  }

  return out;
}

function collectTextures(value: KVValue | undefined, out: Set<string>): void {
  if (typeof value === 'string') {
    if (/^materials\/.+\.vtex$/.test(value)) {
      out.add(value);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectTextures(item, out));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => collectTextures(item, out));
  }
}

/** Decodes each texture once into the shared cache, reading its header in place from the VPK. */
function prepareTextures(paths: Iterable<string>): Record<string, { info: ParticleTextureInfo; png: string | null; mips: string[] }> {
  const cache = join(root, '.codex-run/render/textures');
  const result: Record<string, { info: ParticleTextureInfo; png: string | null; mips: string[] }> = {};

  for (const path of paths) {
    const entry = `${path}_c`;
    const owner = paks.find((pak) => vpkHasEntry(pak, entry));

    if (owner === undefined) {
      continue;
    }

    const info = readParticleTextureInfo(new Uint8Array(readVpkEntryBytes(owner, entry)!));

    if (info === null) {
      continue;
    }

    const png = join(cache, path.replace(/\.vtex$/, '.png'));

    if (!existsSync(png)) {
      const scratch = join(cache, '_decode');
      rmSync(scratch, { recursive: true, force: true });
      execFileSync(vpkmerge, ['panorama', 'dump', '--vpk', owner, '--out-dir', scratch, '--prefix', entry], { stdio: 'ignore' });
      const decoded = join(scratch, path.replace(/\.vtex$/, '.png'));

      if (existsSync(decoded)) {
        mkdirSync(dirname(png), { recursive: true });
        writeFileSync(png, readFileSync(decoded));
      }

      // The raw copy vpkmerge leaves is a game file; nothing of it is kept
      rmSync(scratch, { recursive: true, force: true });
    }

    result[path] = { info, png: existsSync(png) ? `/data/textures/${path.replace(/\.vtex$/, '.png')}` : null, mips: [] };
  }

  // With PARTICLE_MIPS=vrf every level of each texture is VRF's decode of the stored mip chain
  if (process.env.PARTICLE_MIPS === 'vrf') {
    const exportDir = join(root, '.codex-run/render/vrftex');
    const missing = Object.keys(result).filter((path) => !existsSync(join(exportDir, path.replace(/\.vtex$/, '.mip0.png'))));

    for (const pak of paks) {
      if (missing.length > 0) {
        const list = join(root, '.codex-run/render/texlist.txt');
        writeFileSync(list, missing.join(EOL));
        execFileSync(oracleExe, ['--export-textures', pak, list, exportDir], { stdio: 'inherit' });
      }
    }

    for (const [path, entry] of Object.entries(result)) {
      for (let mip = 0; existsSync(join(exportDir, path.replace(/\.vtex$/, `.mip${mip}.png`))); mip++) {
        entry.mips.push(`/data/vrftex/${path.replace(/\.vtex$/, `.mip${mip}.png`)}`);
      }
    }
  }

  return result;
}

/** The vpost's settings as our post process reads them, the oracle's images, and the blue noise it dithers with. */
function postJob(options: Options, key: string, frames: number[]) {
  const vpost = `${options.post!}_c`;
  const owner = paks.find((pak) => vpkHasEntry(pak, vpost))!;
  const text = execFileSync(vpkmerge, ['soundevents', vpost, '--from-vpk', owner], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const decoded = JSON.parse(text.slice(text.indexOf('\n{') + 1)) as KVObject;
  const settings = { ...postSettingsFromVpost(decoded), exposure: options.exposure ?? 1, fullScreenGamma: 2.2 };
  const blueNoise = prepareTextures(['textures/dev/blue_noise_256.vtex'])['textures/dev/blue_noise_256.vtex']?.png ?? null;

  return {
    settings,
    oraclePng: Object.fromEntries(frames.map((frame) => [frame, `/data/${key}/oracle/frame${String(frame).padStart(4, '0')}.png`])),
    blueNoise,
  };
}

interface FrameResult {
  frame: number;
  metrics: Record<string, number>;
  image: string;
  hdr: string;
  particles: { path: string; count: number }[];
  lights: OracleLight[];
  post?: { isolated: Record<string, number>; endToEnd: Record<string, number>; image: string };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const key = [options.system.replace(/[^a-z0-9]+/gi, '_'), options.captures.join('_'), options.size.join('x'), `fov${options.fov}`, options.lighting, options.seed ?? 'sname', ...options.cps, ...(options.only === undefined ? [] : [`only${options.only}`]), ...(options.post === undefined ? [] : [`post${options.post.replace(/[^a-z0-9]+/gi, '_')}`, `e${options.exposure ?? 1}`])].join('__');
  const dir = join(root, '.codex-run/render', key);
  const oracleDir = join(dir, 'oracle');
  const meta = runOracle(options, oracleDir) as {
    dt: number;
    width: number;
    height: number;
    camera: Record<string, unknown>;
    sun: { color: number[] };
    formats: Record<string, string>;
    frames: { frame: number; hdr: string; systems: { path: string; name: string; count: number }[]; lights?: OracleLight[] }[];
  };

  const bundle = options.bundle === undefined ? null : (JSON.parse(readFileSync(join(options.bundle, 'bundle.json'), 'utf8')) as ParticleBundle);
  const definitions = bundle === null ? loadDefinitions(options.system) : Object.fromEntries(Object.entries(bundle.systems).map(([path, system]) => [path, system.data]));
  const textures = new Set<string>(DEFAULT_TEXTURES);

  for (const definition of Object.values(definitions)) {
    collectTextures(definition.m_Renderers, textures);
  }

  // The models C_OP_RenderModels draws and their override materials, read the way the bundle reads them
  const models: Record<string, SerializedModelMesh> = {};
  const materials: Record<string, ParticleMaterialData> = {};
  const stack = new PackageStack(paks, nodeVpkmerge(vpkmerge), join(root, '.codex-run/render/.models'));

  for (const definition of Object.values(definitions)) {
    for (const renderer of (Array.isArray(definition.m_Renderers) ? definition.m_Renderers : []) as KVObject[]) {
      if (renderer._class !== 'C_OP_RenderModels') continue;
      for (const entry of (Array.isArray(renderer.m_ModelList) ? renderer.m_ModelList : []) as KVObject[]) {
        const path = typeof entry.m_model === 'string' ? entry.m_model : '';
        if (path !== '' && !(particleResourceKey(path) in models)) {
          models[particleResourceKey(path)] = serializeModelMesh(await exportParticleModelMesh(stack, nodeVpkmerge(vpkmerge), `${path}_c`, join(root, '.codex-run/render/.models')));
        }
      }
      const material = typeof renderer.m_hOverrideMaterial === 'string' ? renderer.m_hOverrideMaterial : '';
      const data = material === '' ? null : await stack.decode(`${material}_c`);
      if (data !== null) {
        const read = readParticleMaterial(data);
        materials[particleResourceKey(material)] = read;
        Object.values(read.textureParams).forEach((texture) => textures.add(texture));
      }
    }
  }

  const formats: Record<string, string> = {};
  const first = meta.frames[0];

  for (const system of first?.systems ?? []) {
    formats[system.name] = meta.formats[system.path];
  }

  const job = {
    system: options.system,
    dt: meta.dt,
    seed: options.seed ?? null,
    width: meta.width,
    height: meta.height,
    captures: options.captures,
    controlPoints: options.cps.map((cp) => {
      const [index, xyz] = cp.split('=');
      return { cp: Number(index), value: xyz.split(',').map(Number) };
    }),
    frameInputs: null,
    camera: meta.camera,
    sunColor: meta.sun.color.slice(0, 3),
    formats,
    definitions,
    snapshots: bundle?.snapshots ?? {},
    models,
    materials,
    textures: prepareTextures(textures),
    only: options.only === undefined ? null : options.only.split(',').map(Number),
    post: options.post === undefined ? null : postJob(options, key, meta.frames.map((frame) => frame.frame)),
    oracle: Object.fromEntries(meta.frames.map((frame) => [frame.frame, `/data/${key}/oracle/${frame.hdr}`])),
  };

  const server = await createServer({
    root: join(root, 'tools/particle-render-oracle/harness'),
    configFile: false,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    plugins: [
      {
        name: 'particle-render-job',
        configureServer(dev) {
          dev.middlewares.use((request, response, next) => {
            const url = decodeURIComponent((request.url ?? '').split('?')[0]);

            if (url === '/job.json') {
              response.setHeader('content-type', 'application/json');
              response.end(JSON.stringify(job));
              return;
            }

            if (url.startsWith('/data/')) {
              const file = join(root, '.codex-run/render', url.slice('/data/'.length));

              if (existsSync(file)) {
                response.end(readFileSync(file));
                return;
              }
            }

            next();
          });
        },
      },
    ],
  });

  await server.listen();
  const address = server.httpServer!.address();
  const port = typeof address === 'object' && address !== null ? address.port : 5173;

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: !options.headed,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: meta.width, height: meta.height } });
    const logs: string[] = [];
    page.on('console', (message) => {
      if ((message.type() === 'error' || message.type() === 'warning') && !message.text().startsWith('Failed to load resource')) {
        logs.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
        logs.push(`http ${response.status()}: ${response.url()}`);
      }
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.__result !== undefined, undefined, { timeout: 600000 });
    const result = (await page.evaluate(() => window.__result)) as
      | { frames: FrameResult[]; diagnostics: string[]; skipped: string[] }
      | { error: string };

    if (logs.length > 0) {
      console.log(logs.slice(0, 20).join('\n'));
    }

    if ('error' in result) {
      throw new Error(result.error);
    }

    const out = options.out ?? join(dir, 'ours');
    mkdirSync(out, { recursive: true });
    console.log(`${options.system}`);

    if (result.skipped.length > 0) {
      console.log(`  skipped renderers: ${result.skipped.join(', ')}`);
    }

    for (const frame of result.frames) {
      const png = join(out, `frame${String(frame.frame).padStart(4, '0')}.compare.png`);
      writeFileSync(png, Buffer.from(frame.image.split(',')[1], 'base64'));
      writeFileSync(join(out, `frame${String(frame.frame).padStart(4, '0')}.hdr.f32`), Buffer.from(frame.hdr, 'base64'));

      const oracleCounts = meta.frames.find((f) => f.frame === frame.frame)?.systems.map((s) => s.count).join(',');
      const ourCounts = frame.particles.map((s) => s.count).join(',');
      const m = frame.metrics;
      console.log(
        `  frame ${frame.frame}: hdrMAE ${m.hdrMae.toExponential(3)} hdrRel ${m.hdrRelative.toFixed(4)} ldrMAE ${m.ldrMae.toFixed(3)} ` +
          `active ${m.activePixels} activeLdrMAE ${m.activeLdrMae.toFixed(3)} dE ${m.activeDeltaE.toFixed(3)} >JND ${(m.overJnd * 100).toFixed(2)}% max ${m.ldrMax.toFixed(0)} ` +
          `particles ${ourCounts}${ourCounts === oracleCounts ? '' : ` (oracle ${oracleCounts})`}`,
      );
      console.log(`    ${png}`);

      const oracleLights = meta.frames.find((f) => f.frame === frame.frame)?.lights ?? [];
      if (oracleLights.length > 0 || frame.lights.length > 0) console.log(`    lights: ${compareLights(oracleLights, frame.lights)}`);

      if (frame.post) {
        const postPng = join(out, `frame${String(frame.frame).padStart(4, '0')}.post.png`);
        writeFileSync(postPng, Buffer.from(frame.post.image.split(',')[1], 'base64'));
        const show = (label: string, p: Record<string, number>) =>
          `${label} mae ${p.mae.toFixed(3)} activeMae ${p.activeMae.toFixed(3)} max ${p.max} >2/255 ${(p.over2 * 100).toFixed(3)}%`;
        console.log(`    post: ${show('isolated', frame.post.isolated)} | ${show('end to end', frame.post.endToEnd)}`);
        console.log(`    ${postPng}`);
      }
    }

    writeFileSync(join(out, 'metrics.json'), JSON.stringify(result.frames.map(({ frame, metrics, particles }) => ({ frame, metrics, particles })), null, 2));

    if (result.diagnostics.length > 0) {
      console.log('  diagnostics:');
      result.diagnostics.slice(0, 20).forEach((line) => console.log(`    ${line}`));
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
