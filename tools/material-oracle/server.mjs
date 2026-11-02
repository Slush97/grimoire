// Dev-only server for the material oracle page.
//
// usage: node tools/material-oracle/server.mjs [--port 5191] [--cache <hero-poses dir>]
//        [--reference <reference.frag.glsl>] [--vpk <citadel pak01_dir.vpk>] [--probe <probe.exe>]
//        [--source-ref <commit>]
//
// Serves tools/material-oracle/oracle.html with:
//   /@hero-cache/<hero>_vanilla/model-rigged.glb  the app's cached hero GLBs, in place
//   /@game-tex?path=<entry.vtex_c>&max=1024       raw game texture pixels, decoded in memory by
//                                                 the probe (never written to disk)
//   /@reference                                   the reference fragment shader (kept outside git)
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { sourceRefPlugin } from '../../scripts/lib/sourceRef.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const cacheDir = resolve(option('--cache', join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'grimoire', 'hero-poses')));
const referencePath = resolve(option('--reference', join(root, '.codex-run', 'oracle', 'reference.frag.glsl')));
const gameRoot = 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game';
const vpks = option('--vpk', `${gameRoot}/citadel/pak01_dir.vpk,${gameRoot}/core/pak01_dir.vpk`).split(',');
const probe = resolve(option('--probe', join(root, '.codex-run', 'probe-bin', process.platform === 'win32' ? 'probe.exe' : 'probe')));
const port = Number(option('--port', '5191'));

function readProbe(vpk, entry, maxEdge) {
  return new Promise((resolvePromise) => {
    const child = spawn(probe, ['raw', vpk, entry, String(maxEdge)]);
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => resolvePromise(code === 0 ? Buffer.concat(chunks) : null));
    child.on('error', () => resolvePromise(null));
  });
}

const server = await createServer({
  configFile: false,
  root,
  esbuild: { jsx: 'automatic' },
  cacheDir: join(root, '.codex-run', 'vite-material-oracle'),
  optimizeDeps: { entries: ['tools/material-oracle/oracle.html'] },
  server: { port, strictPort: true, host: '127.0.0.1', fs: { allow: [root] } },
  plugins: [sourceRefPlugin(root, option('--source-ref', '')), {
    name: 'material-oracle-assets',
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const path = decodeURIComponent(url.pathname);
        if (path.startsWith('/@hero-cache/')) {
          const file = normalize(join(cacheDir, path.slice('/@hero-cache/'.length)));
          if (!file.startsWith(cacheDir + sep) || !existsSync(file)) { response.statusCode = 404; response.end(); return; }
          response.setHeader('Content-Type', 'model/gltf-binary');
          createReadStream(file).pipe(response);
          return;
        }
        if (path === '/@game-tex') {
          const entry = url.searchParams.get('path') ?? '';
          const maxEdge = Number(url.searchParams.get('max') ?? '1024');
          for (const vpk of vpks) {
            const bytes = await readProbe(vpk, entry, maxEdge);
            if (bytes) { response.setHeader('Content-Type', 'application/octet-stream'); response.end(bytes); return; }
          }
          response.statusCode = 404; response.end(); return;
        }
        if (path === '/@reference') {
          response.setHeader('Content-Type', 'text/plain');
          response.end(await fs.readFile(referencePath, 'utf8'));
          return;
        }
        next();
      });
    },
  }],
});
await server.listen();
console.log(`material oracle: http://127.0.0.1:${port}/tools/material-oracle/oracle.html`);
