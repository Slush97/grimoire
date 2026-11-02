// Dev-only server for hero-preview.html (the production hero viewer outside Electron).
//
// usage: node scripts/hero-preview-server.mjs [--port 5183] [--cache <hero-poses dir>]
//        [--particles <bundle dir>] [--source-ref <commit>]
//
// Serves the app's own hero pose cache in place at /@hero-cache/ (default: the Electron userData
// hero-poses of a Windows, macOS or Linux install), with /@hero-cache/index.json listing each vanilla
// hero entry, and particle bundles from scripts/export-hero-particles.ts at /@hero-particles/.
// Open http://127.0.0.1:5183/hero-preview.html?source=cache&case=abrams_vanilla&particles=engine
// --movement <dir> serves movement previews (scripts/export-movement-preview.ts) at /@movement/.

import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { readHeroPostBloom } from '../electron/main/services/heroParticleVideo.ts';
import { sourceRefPlugin } from './lib/sourceRef.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const defaultCache = process.platform === 'win32'
  ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'grimoire', 'hero-poses')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'grimoire', 'hero-poses')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'grimoire', 'hero-poses');
const cacheDir = resolve(option('--cache', defaultCache));
const particlesDir = resolve(option('--particles', join(root, '.codex-run', 'hero-particles')));
// Movement previews from scripts/export-movement-preview.ts, at /@movement/
const movementDir = resolve(option('--movement', join(root, '.codex-run', 'movement-preview', 'bakes')));
const port = Number(option('--port', '5183'));
const videoPath = option('--video', join(process.env.DEADLOCK_PATH ?? 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock', 'game/citadel/cfg/video.txt'));
const sourceRef = option('--source-ref', '');

// Display names by the cache's sanitized lowercase key (heroPoseModels.sanitize over `<hero>::vanilla`)
const codenameSource = await fs.readFile(join(root, 'electron/main/services/heroCodenames.ts'), 'utf8');
const heroNames = [...codenameSource.matchAll(/^\s+'?([A-Z][A-Za-z &.']*?)'?: '[a-z]+',$/gm)].map((match) => match[1]);
const labelByDir = new Map(heroNames.map((name) => [`${name.toLowerCase().replace(/[^a-zA-Z0-9_-]+/g, '_')}_vanilla`, name]));

const TYPES = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };

/** Sends `file` when it lies inside `base`, else 404. */
function send(response, base, relative) {
  const file = normalize(join(base, relative));
  if (!file.startsWith(base + sep) || !existsSync(file)) {
    response.statusCode = 404;
    response.end();
    return;
  }
  response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(response);
}

async function cacheIndex() {
  const entries = [];
  const postBloomEnabled = await readHeroPostBloom(videoPath);
  for (const name of await fs.readdir(cacheDir).catch(() => [])) {
    const label = labelByDir.get(name);
    if (!label) continue;
    const files = await fs.readdir(join(cacheDir, name)).catch(() => []);
    const stat = await fs.stat(join(cacheDir, name, 'model-rigged.glb')).catch(() => null);
    const particles = existsSync(join(particlesDir, label.replace(/[^a-zA-Z0-9_-]+/g, '_'), 'bundle.json'));
    entries.push({ name, label, files, mtimeMs: stat ? Math.round(stat.mtimeMs) : 0, particles, postBloomEnabled });
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

const server = await createServer({
  configFile: false,
  root,
  esbuild: { jsx: 'automatic' },
  cacheDir: join(root, '.codex-run', 'vite-hero-preview'),
  optimizeDeps: { entries: ['hero-preview.html'] },
  plugins: [
    sourceRefPlugin(root, sourceRef),
    tailwindcss(),
    {
      name: 'hero-preview-assets',
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          const path = decodeURIComponent((request.url ?? '').split('?')[0]);
          if (path === '/@hero-cache/index.json') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(await cacheIndex()));
          } else if (path.startsWith('/@hero-cache/')) {
            send(response, cacheDir, path.slice('/@hero-cache/'.length));
          } else if (path.startsWith('/@movement/')) {
            send(response, movementDir, path.slice('/@movement/'.length));
          } else if (path.startsWith('/@hero-particles/')) {
            send(response, particlesDir, path.slice('/@hero-particles/'.length));
          } else {
            next();
          }
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port, strictPort: true, watch: { ignored: ['**/.codex-run/**'] } },
});
await server.listen();
console.log(`ready http://127.0.0.1:${port}/hero-preview.html?source=cache (cache: ${cacheDir})`);
