// Runs the production scene exporter with a strictly isolated cache, outside Electron.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..');
const cacheName = process.env.HIDEOUT_ORACLE_CACHE_NAME ?? 'hideout-cache';
if (!/^[a-z0-9-]+$/.test(cacheName)) throw new Error('Invalid isolated cache name');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const output = resolve(root, '.codex-run/hideout-export.mjs');
mkdirSync(resolve(root, '.codex-run'), { recursive: true });
await build({
  stdin: { contents: `import { loadHideoutScene } from './electron/main/services/hideoutScene';
    const start = performance.now(); const scene = await loadHideoutScene(process.argv[2]);
    console.log(JSON.stringify({ key: scene.key, instances: scene.instances.length, failures: scene.failures, omissions: scene.omissions, bundle: scene.bundle, seconds: (performance.now()-start)/1000, commands: globalThis.hideoutCommands ?? [] }));`, resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', outfile: output,
  // No built bundle worker sits here, so the scene bundle merges in process.
  define: { __dirname: JSON.stringify(resolve(root, '.codex-run')) },
  plugins: [{ name: 'isolated-export', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'isolated' }));
    builder.onResolve({ filter: /\/modMerger$/ }, () => ({ path: 'exporter', namespace: 'isolated' }));
    builder.onResolve({ filter: /\/deadlock$/ }, () => ({ path: 'game', namespace: 'isolated' }));
    builder.onLoad({ filter: /.*/, namespace: 'isolated' }, ({ path }) => ({ contents: path === 'electron'
      ? `export const app = { getPath: () => ${JSON.stringify(resolve(root, '.codex-run', cacheName))} };`
      : path === 'game' ? `import { join } from 'node:path'; export const getCitadelPath = p => join(p, 'game/citadel');`
      : `import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
        const run = promisify(execFile); export const vpkmergeBinaryPath = () => process.env.VPKMERGE_BINARY; export async function runVpkmergeStdout(args) {
          const start = performance.now();
          try { const {stdout} = await run(process.env.VPKMERGE_BINARY, args, {maxBuffer: 128*1024*1024, windowsHide: true}); return stdout; }
          finally { (globalThis.hideoutCommands ??= []).push({args, ms:performance.now()-start}); }
        } export const runVpkmerge = runVpkmergeStdout;` }));
  } }],
});
await import(pathToFileURL(output).href);
