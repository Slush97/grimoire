/*
 * net-shim.cjs
 * Preloaded into the throwaway app's main process (NODE_OPTIONS=--require)
 * so QA runs stay off the internet and never hammer GameBanana again: a stress
 * fixture of 240 fake mod ids once made every launch fire ~250 update-check
 * calls and got this machine a 429.
 *
 *   GameBanana API: never contacted (503 locally). Browse runs off the local
 *     catalog mirror in the fixture instead (app.mjs sets a hidden creator).
 *   GameBanana image CDN: each URL fetched once into QA_NET_CACHE, then
 *     replayed forever, so repeat runs send nothing. A 429 starts a 30 minute
 *     cooldown (shared by every run) during which new images fail fast.
 *   localhost: passed through (CDP, dev servers).
 *   Everything else reached through fetch or renderer https: blocked (503).
 *
 * Not covered: the Servers relay and downloads use node's https module, and
 * Servers pings game servers over UDP. Those are left alone.
 *
 * QA_NET=offline never records images; QA_NET=refresh re-records them.
 * QA_NET_LATENCY=150-900 delays each replayed image (see replay()).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CACHE = process.env.QA_NET_CACHE;
const MODE = process.env.QA_NET || 'record';
const COOLDOWN_MS = 30 * 60_000;
const MAX_PARALLEL = 6;

if (CACHE && typeof globalThis.fetch === 'function') {
  fs.mkdirSync(CACHE, { recursive: true });
  const realFetch = globalThis.fetch;
  const isGameBanana = (host) => host === 'gamebanana.com' || host.endsWith('.gamebanana.com');
  const cooldownFile = (host) => path.join(CACHE, `cooldown-${host}`);
  const cooling = (host) => {
    try {
      return Date.now() < Number(fs.readFileSync(cooldownFile(host), 'utf8'));
    } catch {
      return false;
    }
  };
  const fail = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/plain' } });

  // At most a browser's worth of parallel image fetches, and only on a cache miss.
  let active = 0;
  const waiting = [];
  const politely = async (fn) => {
    if (active >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };

  // QA_NET_LATENCY=min-max (ms) delays each replay by an amount fixed per URL,
  // so cold loads look like a CDN (skeletons, staggered arrival) yet repeat
  // exactly from run to run.
  const [latMin, latMax] = (process.env.QA_NET_LATENCY || '0-0').split('-').map(Number);
  const replay = async (file, hash) => {
    if (latMax > 0) await new Promise((r) => setTimeout(r, latMin + (parseInt(hash.slice(0, 8), 16) % (latMax - latMin + 1))));
    const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
    return new Response(fs.readFileSync(`${file}.body`), { status: meta.status, headers: meta.headers });
  };

  /** Serve a GET from the cache, recording it on first sight. `doFetch` performs the real request. */
  async function recorded(url, doFetch) {
    const hash = crypto.createHash('sha1').update(url).digest('hex');
    const file = path.join(CACHE, hash);
    if (MODE !== 'refresh' && fs.existsSync(`${file}.json`)) return replay(file, hash);
    const host = new URL(url).hostname;
    if (MODE === 'offline' || cooling(host)) return fail(503, 'grimoire-qa: not recorded and offline or cooling down');
    return politely(async () => {
      if (cooling(host)) return fail(503, 'grimoire-qa: cooling down');
      const res = await doFetch();
      if (res.status === 429) {
        fs.writeFileSync(cooldownFile(host), String(Date.now() + COOLDOWN_MS));
        console.warn(`[grimoire-qa] ${host} returned 429; no new requests to it for 30 minutes`);
        return res;
      }
      if (!res.ok) return res;
      const body = Buffer.from(await res.arrayBuffer());
      const headers = {};
      for (const name of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified']) {
        const v = res.headers.get(name);
        if (v) headers[name] = v;
      }
      fs.writeFileSync(`${file}.body`, body);
      fs.writeFileSync(`${file}.json`, JSON.stringify({ url, status: res.status, headers }));
      return new Response(body, { status: res.status, headers });
    });
  }

  function route(url, method, doFetch) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return doFetch();
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return doFetch();
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') return doFetch();
    if (u.hostname === 'images.gamebanana.com' && method === 'GET') return recorded(url, doFetch);
    if (isGameBanana(u.hostname)) return Promise.resolve(fail(503, 'grimoire-qa: GameBanana API is off in QA'));
    return Promise.resolve(fail(503, `grimoire-qa: blocked ${u.hostname}`));
  }

  if (!process.env.QA_NET_SHIM_QUIET) console.log(`[grimoire-qa] net shim active (mode ${MODE})`);
  process.env.QA_NET_SHIM_QUIET = '1';
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    return route(url, method, () => realFetch(input, init));
  };

  // Renderer requests (thumbnails and anything else over https) go through the
  // default session. Electron's built-in module is not resolvable while
  // --require preloads run, so retry until it is. Child Node processes
  // (workers, utilities) never get it and give up after a few seconds.
  const hookRenderer = (electron) =>
    electron.app.whenReady().then(() => {
      try {
        for (const scheme of ['https', 'http']) {
          electron.session.defaultSession.protocol.handle(scheme, (request) =>
            route(request.url, request.method, () => electron.net.fetch(request, { bypassCustomProtocolHandlers: true })),
          );
        }
        console.log('[grimoire-qa] intercepting renderer http(s)');
      } catch (err) {
        console.error('[grimoire-qa] could not intercept renderer http(s):', err);
      }
    });
  let tries = 0;
  const attach = () => {
    let electron = null;
    try {
      electron = require('electron');
    } catch {
      // Not available yet.
    }
    if (electron && typeof electron === 'object' && electron.app?.whenReady) return hookRenderer(electron);
    if (++tries < 500) setTimeout(attach, 10).unref();
  };
  attach();
}
