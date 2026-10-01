// Local cloth comparison. Game assets stay in the ignored .codex-run directory.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = join(root, '.codex-run/source2-physics');
const cases = {
  seven: { label: 'Seven', hero: 'gigawatt' },
  vindicta: { label: 'Vindicta', hero: 'hornet' },
  yamato: { label: 'Yamato', hero: 'yamato', entry: 'models/heroes_staging/yamato_v2/yamato.vmdl_c', clips: ['primary_stand_idle', 'primary_run275_n', 'primary_run275_e'] },
  necro: { label: 'Necro', hero: 'necro', clips: ['weapon_stand_idle', 'run_n', 'respawn_countdown_idle'] },
  dynamo: { label: 'Dynamo', hero: 'dynamo', entry: 'models/heroes_wip/dynamo/dynamo.vmdl_c', clips: ['primary_stand_idle', 'primary_run_250_n', 'primary_run_250_e'] },
  wraith: { label: 'Wraith', hero: 'wraith', entry: 'models/heroes_wip/wraith/wraith.vmdl_c' },
  mirage: { label: 'Mirage', hero: 'mirage', entry: 'models/heroes_staging/mirage_v2/mirage.vmdl_c' },
  bebop: { label: 'Bebop', hero: 'bebop' },
  doorman: { label: 'Doorman', hero: 'doorman' },
};
const caseArgument = process.argv.indexOf('--case');
const serveOnly = process.argv.includes('--serve-only');
const indexFile = join(outputRoot, 'cases.json');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const savedCases = serveOnly ? readJson(indexFile) : null;
if (serveOnly && (!Array.isArray(savedCases) || !savedCases.length
  || savedCases.some((item) => !item || typeof item.name !== 'string' || typeof item.label !== 'string')
  || new Set(savedCases.map((item) => item.name)).size !== savedCases.length)) {
  throw new Error('Fixture cases.json must contain unique { name, label } entries.');
}
const selected = caseArgument >= 0 ? (process.argv[caseArgument + 1] || '').split(',')
  : serveOnly ? savedCases.map((item) => item.name) : ['seven'];
if (selected.some((name) => !Object.hasOwn(cases, name))) throw new Error(`Choose --case ${Object.keys(cases).join(',')}, or a comma-separated subset.`);
if (serveOnly && selected.some((name) => !savedCases.some((item) => item.name === name))) {
  throw new Error('Requested --case must be present in fixture cases.json.');
}
const portArgument = process.argv.indexOf('--port');
const port = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : 5176;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Pass --port <1-65535>.');
const origin = `http://127.0.0.1:${port}`;
const gameArgument = process.argv.indexOf('--game');
const s2vArgument = process.argv.indexOf('--s2v');
const grimoire = process.argv.includes('--grimoire');
const s2v = s2vArgument >= 0 ? process.argv[s2vArgument + 1] : process.env.S2V_CLI;
if (s2vArgument >= 0 && !s2v) throw new Error('Pass --s2v <Source2Viewer-CLI.dll or executable>.');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function exportFixtures() {
  const settingsPath = process.env.APPDATA && join(process.env.APPDATA, 'grimoire/settings.json');
  const savedGame = settingsPath && existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, 'utf8')).deadlockPath : null;
  const game = gameArgument >= 0 ? process.argv[gameArgument + 1] : savedGame;
  if (!game) throw new Error('Pass --game <Deadlock directory>.');
  const pak = resolve(game, 'game/citadel/pak01_dir.vpk');
  const binaries = {
    'win32-x64': 'vpkmerge-windows-x86_64.exe',
    'linux-x64': 'vpkmerge-linux-x86_64',
    'darwin-arm64': 'vpkmerge-macos-aarch64',
  };
  const binary = binaries[`${process.platform}-${process.arch}`];
  const exporter = process.env.VPKMERGE_PATH || (binary && join(root, 'resources/vpkmerge', binary));
  if (!exporter || !existsSync(exporter)) throw new Error('Run pnpm fetch-vpkmerge or set VPKMERGE_PATH.');
  const run = (args) => {
    const result = spawnSync(exporter, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000, windowsHide: true });
    if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || 'vpkmerge export failed');
    return result.stdout;
  };
  const exporterVersion = run(['--version']).trim();
  const vpk = { path: pak, modified: statSync(pak).mtime.toISOString(), directorySha256: sha256(pak) };
  if (s2v && !existsSync(s2v)) throw new Error(`S2V CLI not found: ${s2v}`);
  for (const name of new Set(selected)) {
    const output = join(outputRoot, name);
    mkdirSync(output, { recursive: true });
    console.log(`Exporting ${cases[name].label} from the installed base VPK...`);
    const entry = cases[name].entry ?? JSON.parse(run(['model', 'live-materials', '--vpk', pak, '--hero', cases[name].hero, '--json']))[0]?.model_entry;
    if (!entry) throw new Error(`No live model found for ${cases[name].hero}`);
    const select = ['--vpk', pak, '--entry', entry];
    const clipRows = JSON.parse(run(['model', 'clips', ...select, '--json']));
    const idle = clipRows.find((c) => /stand.*idle/.test(c.name)) ?? clipRows.find((c) => c.durationSeconds > 0.001);
    const clips = cases[name].clips ?? [idle?.name, ...clipRows.filter((c) => /ui_hero_pose|run.*_n$/.test(c.name)).slice(0, 3).map((c) => c.name)].filter(Boolean);
    const raw = run(['model', 'femodel', ...select]);
    if (!JSON.parse(raw)) throw new Error(`${entry} has no FeModel.`);
    writeFileSync(join(output, 'cloth.json'), raw);
    const clipList = run(['model', 'clips', ...select, '--json']);
    const availableClips = JSON.parse(clipList).map((clip) => clip.name);
    const missingClips = clips.filter((clip) => !availableClips.includes(clip));
    if (missingClips.length > 0) throw new Error(`${entry} is missing requested clips: ${missingClips.join(', ')}`);
    writeFileSync(join(output, 'clips.json'), clipList);
    run(['model', 'export', ...select, ...clips.flatMap((clip) => ['--clip', clip]), '--out', join(output, 'model.glb')]);
    let viewer = null;
    if (grimoire) {
      run(['model', 'export', ...select, '--clip', clips[0], ...clips.slice(1).flatMap((clip) => ['--clip', clip]), '--out', join(output, 'model-viewer.glb')]);
      let posed = null;
      try {
        run(['model', 'export', ...select, '--pose', '--require-pose', '--out', join(output, 'model-posed.glb')]);
        posed = { file: 'model-posed.glb', sha256: sha256(join(output, 'model-posed.glb')) };
      } catch (error) {
        console.warn(`${cases[name].label} has no usable static preview: ${error.message}`);
      }
      viewer = { rigged: { file: 'model-viewer.glb', sha256: sha256(join(output, 'model-viewer.glb')) }, posed };
    }
    let reference = null;
    if (s2v) {
      console.log(`Exporting ${cases[name].label} through Source 2 Viewer...`);
      const referenceDirectory = join(output, 's2v');
      const command = s2v.endsWith('.dll') ? 'dotnet' : s2v;
      const prefix = s2v.endsWith('.dll') ? [s2v] : [];
      const result = spawnSync(command, [...prefix, '-i', pak, '-f', entry, '-o', referenceDirectory, '-d',
        '--gltf_export_format', 'glb', '--gltf_export_animations', '--gltf_animation_list', clips.join(','),
        '--gltf_export_materials', '--gltf_textures_adapt'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, windowsHide: true });
      if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || result.stdout || 'S2V export failed');
      const referenceEntry = entry.replace(/\.vmdl_c$/, '.glb');
      reference = {
        label: 'S2V exported animation', url: `/.codex-run/source2-physics/${name}/s2v/${referenceEntry}`,
        cliSha256: sha256(s2v), modelSha256: sha256(join(referenceDirectory, referenceEntry)),
      };
    }
    writeFileSync(join(output, 'metadata.json'), JSON.stringify({
      exportedAt: new Date().toISOString(), name, label: cases[name].label, entry, clips, exporter: exporterVersion, vpk,
      files: Object.fromEntries(['model.glb', 'cloth.json'].map((file) => [file, sha256(join(output, file))])), reference, viewer,
    }, null, 2) + '\n');
  }
  writeFileSync(join(outputRoot, 'cases.json'), JSON.stringify([...new Set(selected)].map((name) => ({ name, label: cases[name].label })), null, 2));
}

// A fixture pack replaces only asset transport. It runs the actual viewer and
// needs neither Steam, user settings nor a platform-specific exporter binary.
function fixtureManifest() {
  const files = new Map();
  const artifact = (name, filename, required = true) => {
    if (typeof filename !== 'string' || !filename || /^[A-Za-z]:|^[/\\]/.test(filename)
      || filename.split(/[/\\]/).includes('..')) throw new Error(`Invalid fixture path for ${name}: ${filename}`);
    const file = join(outputRoot, name, filename);
    if (!existsSync(file)) {
      if (!required) return null;
      throw new Error(`Missing ${name} fixture: ${filename}`);
    }
    const stat = statSync(file);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Empty or invalid ${name} fixture: ${filename}`);
    const path = relative(root, file).replaceAll('\\', '/');
    if (!files.has(path)) files.set(path, { path, bytes: stat.size, sha256: sha256(file) });
    return path;
  };
  const list = [...new Set(selected)].map((name) => {
    const metadataFile = artifact(name, 'metadata.json');
    const metadata = readJson(join(root, metadataFile));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || metadata.name !== name || typeof metadata.label !== 'string'
      || !Number.isFinite(Date.parse(metadata.exportedAt))) {
      throw new Error(`Invalid ${name} metadata.json identity or exportedAt.`);
    }
    let rigged = null;
    let posed = null;
    if (grimoire) {
      if (!metadata.viewer?.rigged?.file || !Object.hasOwn(metadata.viewer, 'posed')) {
        throw new Error(`${name} metadata must declare viewer.rigged and nullable viewer.posed.`);
      }
      rigged = artifact(name, metadata.viewer.rigged.file);
      if (metadata.viewer.posed !== null) posed = artifact(name, metadata.viewer.posed?.file);
    }
    const cloth = artifact(name, 'cloth.json', !grimoire);
    const raw = cloth ? readJson(join(root, cloth)) : null;
    if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
      throw new Error(`${name} cloth.json must be an FeModel object or null.`);
    }
    if (!grimoire && !raw) throw new Error(`${name} has no cloth data for the comparison testbed; use --grimoire.`);
    const comparison = artifact(name, 'model.glb', !grimoire);
    const clips = artifact(name, 'clips.json', false);
    const descriptor = artifact(name, 'effect.json', false);
    const textures = new Set();
    if (descriptor) {
      const visit = (node) => {
        if (!node || typeof node !== 'object' || !Array.isArray(node.renderers) || !Array.isArray(node.children)) {
          throw new Error(`Invalid ${name} particle descriptor.`);
        }
        for (const renderer of node.renderers) {
          if (renderer.mode !== 'sprite') continue;
          for (const texture of renderer.textures ?? []) {
            if (typeof texture !== 'string') throw new Error(`Invalid ${name} particle texture reference.`);
            textures.add(artifact(name, `effect-tex/${texture.replace(/[^a-zA-Z0-9]/g, '_')}.png`));
          }
        }
        node.children.forEach(visit);
      };
      visit(readJson(join(root, descriptor)));
    }
    return { name, label: metadata.label, inputs: {
      metadata: metadataFile, static: posed, rigged, cloth, clothAvailable: raw !== null,
      comparison, clips, particles: descriptor ? { descriptor, textures: [...textures] } : null,
    } };
  });
  const index = { path: relative(root, indexFile).replaceAll('\\', '/'), bytes: statSync(indexFile).size, sha256: sha256(indexFile) };
  files.set(index.path, index);
  const manifest = {
    version: 1, generatedAt: new Date().toISOString(),
    command: `node scripts/preview-cloth.mjs --serve-only${grimoire ? ' --grimoire' : ''} --case ${selected.join(',')}`,
    assetRoot: '.codex-run/source2-physics',
    entryPoint: grimoire ? 'hero-preview.html' : 'cloth-preview.html',
    transport: {
      scheme: 'grimoire-hero://m/<case>/<filename>',
      routes: { 'model.glb': 'metadata.viewer.posed.file', 'model-rigged.glb': 'metadata.viewer.rigged.file',
        'cloth-rigged.json': 'cloth.json (object, null or absent)', 'effect.json': 'effect.json', 'effect-tex/*': 'effect-tex/*' },
      repositoryAssets: ['public/ibl/px.hdr', 'public/ibl/nx.hdr', 'public/ibl/py.hdr', 'public/ibl/ny.hdr', 'public/ibl/pz.hdr', 'public/ibl/nz.hdr'],
    },
    cases: list, files: [...files.values()],
  };
  const path = join(outputRoot, 'fixture-pack-manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Validated ${list.length} fixture cases and ${files.size} files. Pack manifest: ${path}`);
  return list.map(({ name, label }) => ({ name, label }));
}
if (!serveOnly) exportFixtures();
const servedCases = fixtureManifest();
async function saveReport(request, response) {
  if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json'
    || (request.headers.origin && request.headers.origin !== origin)) {
    response.writeHead(400).end('Expected a local JSON report.');
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) throw new Error('Report exceeds 2 MB.');
    }
    const report = JSON.parse(body);
    const directory = join(outputRoot, 'reports');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ file }));
  } catch (error) {
    response.writeHead(400).end(error instanceof Error ? error.message : 'Invalid report.');
  }
}
const server = await createServer({
  configFile: false, root,
  esbuild: { jsx: 'automatic' },
  cacheDir: join(outputRoot, 'vite-testbed'),
  optimizeDeps: { entries: ['cloth-preview.html', 'hero-preview.html'] },
  plugins: [tailwindcss(), { name: 'cloth-local-reports', configureServer(server) {
    server.middlewares.use('/__cloth/report', saveReport);
    if (serveOnly) server.middlewares.use('/.codex-run/source2-physics/cases.json', (request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(request.method === 'HEAD' ? '' : JSON.stringify(servedCases));
    });
  } }],
  server: { host: '127.0.0.1', port, strictPort: true, watch: { ignored: ['**/.codex-run/**', '**/.flatpak-builder/**'] } },
});
await server.listen();
console.log(`Cloth comparison: ${origin}/cloth-preview.html`);
if (grimoire) console.log(`Grimoire viewer: ${origin}/hero-preview.html`);
