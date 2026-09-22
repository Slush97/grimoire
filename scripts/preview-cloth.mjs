// Local cloth comparison. Game assets stay in the ignored .codex-run directory.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
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
  yamato: { label: 'Yamato', hero: 'yamato', clips: ['primary_stand_idle', 'primary_run275_n', 'primary_run275_e'] },
  necro: { label: 'Necro', hero: 'necro', clips: ['weapon_stand_idle', 'run_n', 'respawn_countdown_idle'] },
  dynamo: { label: 'Dynamo', hero: 'dynamo', clips: ['primary_stand_idle', 'primary_run_250_n', 'primary_run_250_e'] },
  bebop: { label: 'Bebop', hero: 'bebop' },
  doorman: { label: 'Doorman', hero: 'doorman' },
};
const caseArgument = process.argv.indexOf('--case');
const selected = (caseArgument >= 0 ? process.argv[caseArgument + 1] || '' : 'seven').split(',');
if (selected.some((name) => !Object.hasOwn(cases, name))) throw new Error(`Choose --case ${Object.keys(cases).join(',')}, or a comma-separated subset.`);
const gameArgument = process.argv.indexOf('--game');
const s2vArgument = process.argv.indexOf('--s2v');
const grimoire = process.argv.includes('--grimoire');
const s2v = s2vArgument >= 0 ? process.argv[s2vArgument + 1] : process.env.S2V_CLI;
if (s2vArgument >= 0 && !s2v) throw new Error('Pass --s2v <Source2Viewer-CLI.dll or executable>.');
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
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
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
  const live = JSON.parse(run(['model', 'live-materials', '--vpk', pak, '--hero', cases[name].hero, '--json']));
  const entry = live[0]?.model_entry;
  if (!entry) throw new Error(`No live model found for ${cases[name].hero}`);
  const select = ['--vpk', pak, '--entry', entry];
  const clips = cases[name].clips ?? ['primary_stand_idle', 'primary_run_n', 'primary_run_e'];
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
    run(['model', 'export', ...select, '--clip', clips[0], '--out', join(output, 'model-viewer.glb')]);
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
async function saveReport(request, response) {
  if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json'
    || (request.headers.origin && request.headers.origin !== 'http://127.0.0.1:5176')) {
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
  plugins: [tailwindcss(), { name: 'cloth-local-reports', configureServer(server) { server.middlewares.use('/__cloth/report', saveReport); } }],
  server: { host: '127.0.0.1', port: 5176, strictPort: true, watch: { ignored: ['**/.codex-run/**', '**/.flatpak-builder/**'] } },
});
await server.listen();
console.log('Cloth comparison: http://127.0.0.1:5176/cloth-preview.html');
if (grimoire) console.log('Grimoire viewer: http://127.0.0.1:5176/hero-preview.html');
