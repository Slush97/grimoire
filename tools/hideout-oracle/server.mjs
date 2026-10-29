import { createServer } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { readFileSync, appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const game = process.argv[2] === '--game' ? process.argv[3] : null;
let scene = game ? null : resolve(process.argv[2]);
const cacheName = process.env.HIDEOUT_ORACLE_CACHE_NAME ?? 'hideout-cache';
if (!/^[a-z0-9-]+$/.test(cacheName)) throw new Error('Invalid isolated cache name');
const run = promisify(execFile);
const server = await createServer({ root, configFile: false,
  esbuild: { jsx: 'automatic' }, cacheDir: join(root, '.codex-run/vite-hideout'),
  optimizeDeps: { entries: ['tools/hideout-oracle/viewer.html'] },
  plugins: [{ name: 'hideout-fixture', configureServer(vite) {
    vite.middlewares.use((req,res,next) => {
      if (req.url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
      if (!req.url?.startsWith('/@scene/')) return next();
      void (async()=>{
        if(game && req.url.split('?')[0] === '/@scene/scene.json') {
          const {stdout} = await run(process.execPath, ['tools/hideout-oracle/export.mjs', game], {cwd:root,env:process.env,windowsHide:true,maxBuffer:16*1024*1024});
          const result=JSON.parse(stdout.trim());
          if(!/^[a-f0-9]{24}$/.test(result.key)||result.failures.length)throw new Error(stdout);
          scene=join(root,'.codex-run',cacheName,'viewer-scenes',result.key);
          appendFileSync(join(root,'.codex-run',`${cacheName}-loads.jsonl`),JSON.stringify(result)+'\n');
          res.setHeader('Content-Type','application/json');res.end(readFileSync(join(scene,'scene.json')));return;
        }
        if(!scene) { res.statusCode=503;res.end();return; }
        const path = req.url.split('?')[0].slice('/@scene/'.length);
        if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').includes('..')) { res.statusCode=400;res.end();return; }
        const file = join(scene, path);
        if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
        createReadStream(file).pipe(res);
      })().catch(error=>{console.error(error);res.statusCode=500;res.end('Scene load failed');});
    });
  }}], server: { host: '127.0.0.1', port: 5196, strictPort: true, watch: { ignored: ['**/.codex-run/**'] } },
});
await server.listen();
console.log('ready http://127.0.0.1:5196/tools/hideout-oracle/viewer.html');
