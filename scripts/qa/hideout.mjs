#!/usr/bin/env node
/*
 * hideout.mjs
 * Times a hideout open on the real GPU and says what froze: the renderer's main
 * thread (the hero stops) or the GPU process (every window stops, because
 * CrGpuMain also rasters and draws the UI).
 *
 *   VITE_GRIMOIRE_VIEWER_BENCH=1 GRIMOIRE_SOCIAL_BASE_URL=https://example.invalid pnpm exec electron-vite build
 *   node scripts/qa/hideout.mjs --binary ../vpkmerge-wt-pr79/target/release/vpkmerge --label baseline
 *
 * Options:
 *   --repo <dir>      checkout to measure (default: cwd)
 *   --binary <path>   vpkmerge the scene cache was built with; it is part of the cache key
 *   --hero <id>       hero category (default 33312, Infernus)
 *   --runs <n>        opens, first one dropped from the median as the cold GPU cache (default 3)
 *   --label <name>    result name (default: timestamp)
 *   --keep-trace      leave the raw trace beside the result
 *   --fresh-caches <name>  empty Chromium GPU caches and a new driver cache named <name>, for fair A/B runs
 *   --flag <switch>   extra Chromium switch, repeatable
 *   --active          move the mouse through the load, as a user would
 *
 * Runs offscreen on the real GPU under gamescope. --visible opens a real Wayland
 * window instead, which must stay on a visible workspace. Either way it reads the
 * real game (settings come from ~/.config/grimoire) but uses its own userData, so
 * the user's profile and GPU cache stay as they are.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connect, Page, sleep } from './cdp.mjs';
import { QA_HOME } from './app.mjs';

const { values: opts } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    binary: { type: 'string' },
    hero: { type: 'string', default: '33312' },
    runs: { type: 'string', default: '3' },
    label: { type: 'string' },
    'keep-trace': { type: 'boolean', default: false },
    flag: { type: 'string', multiple: true, default: [] },
    'fresh-caches': { type: 'string' },
    visible: { type: 'boolean', default: false },
    active: { type: 'boolean', default: false },
  },
});

const REPO = resolve(opts.repo);
const REAL = join(homedir(), '.config', 'grimoire');
const RUN = join(QA_HOME, 'run-hideout');
const PROFILE = join(RUN, 'profile');
const RESULTS = join(QA_HOME, 'results', 'hideout');
const label = opts.label ?? new Date().toISOString().replace(/[:.]/g, '-');
const HERE = dirname(fileURLToPath(import.meta.url));

const CATEGORIES = [
  'toplevel', 'gpu', 'gpu.angle', 'viz', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'blink.user_timing', '__metadata',
];

function seedProfile() {
  mkdirSync(PROFILE, { recursive: true });
  const settings = JSON.parse(readFileSync(join(REAL, 'settings.json'), 'utf8'));
  writeFileSync(join(PROFILE, 'settings.json'), JSON.stringify({
    ...settings, experimentalHideoutDefault: true, discordRpcEnabled: false, contributeMatchSalts: false,
    autoCheckAppUpdates: false, autoCheckModUpdates: false, zoomFactor: 1,
    windowBounds: { x: 0, y: 0, width: 1600, height: 900, isMaximized: false },
  }, null, 2));
  // The Locker's hero list comes from this catalog. A fresh one would ask GameBanana, and the net shim answers 503.
  // A recent sync time stops the boot sync, which would load the main process during the measurement.
  const catalog = join(PROFILE, 'mods-cache.db');
  if (!existsSync(catalog)) {
    cpSync(join(REAL, 'mods-cache.db'), catalog);
    const db = new DatabaseSync(catalog);
    db.prepare('UPDATE sync_state SET last_sync = ?').run(Math.floor(Date.now() / 1000));
    db.close();
  }
  // A rebuild writes snapshots and resources in place, so the scene caches are copies.
  const scenes = join(REAL, 'viewer-scenes');
  for (const key of readdirSync(scenes)) {
    const target = join(PROFILE, 'viewer-scenes', key);
    if (!existsSync(target)) cpSync(join(scenes, key), target, { recursive: true });
  }
}

async function launch() {
  const electron = createRequire(join(REPO, 'package.json'))('electron');
  const portFile = join(PROFILE, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  const shim = join(QA_HOME, 'net-shim.cjs');
  mkdirSync(QA_HOME, { recursive: true });
  cpSync(join(HERE, 'net-shim.cjs'), shim);
  const env = { ...process.env, QA_NET: 'offline', QA_NET_CACHE: join(QA_HOME, 'net-cache'), NODE_OPTIONS: `--require ${shim}` };
  delete env.ELECTRON_RENDERER_URL;
  if (opts.binary) env.VPKMERGE_BINARY = resolve(opts.binary);
  if (opts['fresh-caches']) {
    env.__GL_SHADER_DISK_CACHE_PATH = join(homedir(), '.cache', 'nvidia', `qa-${opts['fresh-caches']}`);
    env.__GL_SHADER_DISK_CACHE_SKIP_CLEANUP = '1';
    mkdirSync(env.__GL_SHADER_DISK_CACHE_PATH, { recursive: true });
  }
  const out = openSync(join(RUN, 'app.log'), 'a');
  const appArgs = [REPO, `--user-data-dir=${PROFILE}`, '--remote-debugging-port=0',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', ...opts.flag];
  // Offscreen on the real GPU: gamescope's headless backend keeps sending frames, where a window on
  // the desktop gets none while another workspace is showing, and the load waits for it.
  const [command, args] = opts.visible ? [electron, [...appArgs, '--ozone-platform=wayland']]
    : ['gamescope', ['--backend', 'headless', '-W', '1600', '-H', '900', '-w', '1600', '-h', '900', '-r', '60', '--', electron, ...appArgs, '--ozone-platform=x11']];
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', out, out] });
  let port = null;
  for (let i = 0; i < 480 && !port; i++) {
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || null;
    if (!port) await sleep(125);
  }
  if (!port) throw new Error('app did not start');
  const stop = async () => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
    await sleep(1500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
  };
  return { port, stop };
}

/** The browser target: tracing every process needs it, a page target only sees its renderer. */
async function browser(port) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = () => fail(new Error('browser websocket failed')); });
  let id = 0;
  const waiting = new Map(), listeners = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) entry?.reject(new Error(message.error.message)); else entry?.resolve(message.result);
    } else listeners.get(message.method)?.(message.params);
  };
  const send = (method, params = {}) => new Promise((done, fail) => { waiting.set(++id, { resolve: done, reject: fail }); ws.send(JSON.stringify({ id, method, params })); });
  return { send, on: (method, fn) => listeners.set(method, fn), close: () => ws.close() };
}

async function saveTrace(target, file) {
  const complete = new Promise(done => target.on('Tracing.tracingComplete', done));
  await target.send('Tracing.end');
  const { stream } = await complete;
  const out = createWriteStream(file);
  for (;;) {
    const { data, eof, base64Encoded } = await target.send('IO.read', { handle: stream, size: 16 * 1024 * 1024 });
    out.write(base64Encoded ? Buffer.from(data, 'base64') : data);
    if (eof) break;
  }
  await new Promise(done => out.end(done));
  await target.send('IO.close', { handle: stream });
}

const INSTRUMENT = String.raw`(() => {
  const bench = { frames: [], longTasks: [], slowGl: [] };
  window.__hideoutBench = bench;
  for (const name of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'getUniformLocation', 'getActiveUniform', 'getActiveAttrib', 'getAttribLocation']) {
    const original = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...args) {
      const started = performance.now();
      const result = original.apply(this, args);
      const ms = performance.now() - started;
      if (ms > 25) {
        const program = args[0] instanceof WebGLProgram ? args[0] : null;
        const fragment = program ? this.getAttachedShaders(program)?.map(shader => this.getShaderSource(shader)).find(source => source.includes('gl_FragColor') || source.includes('pc_fragColor')) : null;
        Error.stackTraceLimit = 40;
        bench.slowGl.push({ at: Math.round(started), ms: Math.round(ms), name, shader: fragment?.match(/#define SHADER_NAME (.*)/)?.[1] ?? null, chars: fragment?.length ?? 0, stack: new Error().stack });
      }
      return result;
    };
  }
  const tick = t => { bench.frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new PerformanceObserver(list => { for (const e of list.getEntries()) bench.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
})();`;

async function openHideout(page) {
  await page.waitFor(() => document.querySelectorAll('nav a').length > 3, { timeoutMs: 60_000, what: 'sidebar' });
  await page.call(hero => { location.hash = `#/locker/hero/${hero}`; }, opts.hero);
  await page.waitFor(() => !!document.querySelector('button[title="Show live 3D model"]'), { timeoutMs: 30_000, what: '3D button' });
  await sleep(2000);
  const clicked = await page.call(() => {
    const button = document.querySelector('button[title="Show live 3D model"]');
    performance.mark('hideout-bench-click');
    button.click();
    return performance.now();
  });
  // A hidden window gets no frames, so the load waits for it: say so instead of looking hung.
  let moving = opts.active;
  const mouse = (async () => {
    for (let step = 0; moving; step++) {
      await page.mouse('mouseMoved', 700 + step % 200, 500).catch(() => {});
      await sleep(33);
    }
  })();
  const heartbeat = setInterval(() => {
    page.call(() => ({ frames: window.__hideoutBench.frames.length, hidden: document.visibilityState })).then(({ frames, hidden }) => console.log(`waiting for the room: ${frames} frames, ${hidden}`), () => {});
  }, 10_000);
  await page.waitFor(() => !!window.__grimoireViewer?.get?.()?.scene?.userData?.source2MapTimings || !!window.__grimoireViewer?.scene?.userData?.source2MapTimings, { timeoutMs: 180_000, what: 'room load' }).finally(() => { clearInterval(heartbeat); moving = false; });
  await mouse;
  // The crossfade, the particle layer's first frames and the first saved-frame capture.
  await sleep(4000);
  return clicked;
}

const readout = () => {
  const viewer = window.__grimoireViewer;
  const state = viewer.get?.() ?? viewer;
  const { gl, scene } = state;
  const context = gl.getContext();
  const programs = gl.info.programs.map(program => {
    const fragment = program.fragmentShader && context.getShaderSource(program.fragmentShader);
    const vertex = program.vertexShader && context.getShaderSource(program.vertexShader);
    return { name: program.name, used: program.usedTimes, id: program.id, fragmentChars: fragment?.length ?? 0, vertexChars: vertex?.length ?? 0, key: program.cacheKey };
  });
  const snapshot = scene.userData.hideoutSnapshot;
  return {
    marks: scene.userData.source2MapTimings,
    loadAt: window.__benchHideoutLoadAt,
    snapshotShownAt: snapshot?.marks?.shown ?? null,
    snapshot: snapshot ? { loaded: snapshot.loaded, shown: snapshot.shown, snapped: snapshot.snapped, saved: snapshot.saved, checked: snapshot.checked, sizes: [snapshot.savedPose?.width, snapshot.renderPose?.width] } : null,
    frames: window.__hideoutBench.frames,
    longTasks: window.__hideoutBench.longTasks,
    slowGl: window.__hideoutBench.slowGl,
    programs,
    memory: gl.info.memory,
    render: gl.info.render,
    renderer: context.getParameter(context.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
  };
};

/** Outermost slices per thread: nested trace events collapse into the task that holds them. */
function analyzeTrace(file) {
  const { traceEvents } = JSON.parse(readFileSync(file, 'utf8'));
  const fromTs = traceEvents.find(event => event.name === 'hideout-bench-click')?.ts;
  if (fromTs === undefined) throw new Error('no click mark in the trace');
  const threads = new Map(), processes = new Map();
  for (const event of traceEvents) {
    if (event.ph !== 'M') continue;
    if (event.name === 'thread_name') threads.set(`${event.pid}:${event.tid}`, event.args.name);
    if (event.name === 'process_name') processes.set(event.pid, event.args.name);
  }
  const byThread = new Map();
  for (const event of traceEvents) {
    if (event.ph !== 'X' || !event.dur) continue;
    const key = `${event.pid}:${event.tid}`;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key).push(event);
  }
  const named = wanted => [...byThread.entries()].filter(([key]) => threads.get(key) === wanted).sort((a, b) => b[1].length - a[1].length)[0]?.[1] ?? [];
  const tasks = events => {
    const sorted = [...events].sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const out = [];
    let end = 0;
    for (const event of sorted) {
      if (event.ts >= end) { out.push({ ts: event.ts, dur: event.dur, name: event.name, children: new Map() }); end = event.ts + event.dur; continue; }
      const top = out[out.length - 1];
      top.children.set(event.name, (top.children.get(event.name) ?? 0) + event.dur);
    }
    return out;
  };
  const summarize = events => {
    const all = tasks(events).filter(task => task.ts >= fromTs);
    const long = all.filter(task => task.dur >= 50_000).sort((a, b) => b.dur - a.dur);
    return {
      busyMs: Math.round(all.reduce((sum, task) => sum + task.dur, 0) / 1000),
      over50ms: long.length,
      over100ms: long.filter(task => task.dur >= 100_000).length,
      worstMs: Math.round((long[0]?.dur ?? 0) / 1000),
      blockedOver50Ms: Math.round(long.reduce((sum, task) => sum + task.dur, 0) / 1000),
      worst: long.slice(0, 8).map(task => ({
        atMs: Math.round((task.ts - fromTs) / 1000), ms: Math.round(task.dur / 1000), name: task.name,
        inside: [...task.children].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, us]) => `${name} ${Math.round(us / 1000)}`),
      })),
    };
  };
  const gpu = named('CrGpuMain'), renderer = named('CrRendererMain'), viz = named('VizCompositorThread');
  const draws = [...gpu, ...viz].filter(event => event.name === 'Display::DrawAndSwap' || event.name === 'DisplayScheduler::DrawAndSwap').map(event => event.ts).sort((a, b) => a - b).filter(ts => ts >= fromTs);
  const gaps = draws.slice(1).map((ts, i) => (ts - draws[i]) / 1000);
  const programLoads = gpu.filter(event => event.ts >= fromTs && /^ProgramGL::/.test(event.name));
  const longestDraws = gpu.filter(event => event.ts >= fromTs && /glDraw|DoDraw|DrawElements|DrawArrays/i.test(event.name)).sort((a, b) => b.dur - a.dur).slice(0, 5).map(event => `${event.name} ${Math.round(event.dur / 1000)}`);
  return {
    threads: [...new Set(threads.values())].length,
    renderer: summarize(renderer),
    gpu: summarize(gpu),
    screen: { presents: draws.length, worstGapMs: Math.round(Math.max(0, ...gaps)), gapsOver100ms: gaps.filter(gap => gap > 100).length, frozenMs: Math.round(gaps.filter(gap => gap > 100).reduce((sum, gap) => sum + gap, 0)) },
    programWork: { count: programLoads.length, ms: Math.round(programLoads.reduce((sum, event) => sum + event.dur, 0) / 1000) },
    longestDraws,
  };
}

async function oneRun(index) {
  const app = await launch();
  // A killed bench must not leave its detached app behind.
  const abandon = () => app.stop().finally(() => process.exit(1));
  process.once('SIGTERM', abandon);
  process.once('SIGINT', abandon);
  const trace = join(RUN, `trace-${label}-${index}.json`);
  try {
    const target = await browser(app.port);
    const cdp = await connect(app.port);
    const page = new Page(cdp, { width: 1600, height: 900 });
    await page.init(INSTRUMENT);
    await page.reload();
    await page.waitFor(() => document.querySelectorAll('nav a').length > 3, { timeoutMs: 60_000, what: 'sidebar' });
    await target.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: CATEGORIES } });
    const clicked = await openHideout(page).catch(async (error) => { await page.screenshot().then(png => writeFileSync(join(RUN, 'failed.png'), png), () => {}); throw error; });
    const result = await page.call(readout);
    await saveTrace(target, trace);
    target.close();
    cdp.close();
    const analysis = analyzeTrace(trace);
    const gaps = result.frames.slice(1).map((t, i) => t - result.frames[i]).filter((_, i) => result.frames[i] >= clicked);
    const marks = result.marks ?? {};
    return {
      renderer: result.renderer,
      fromClick: {
        savedFrameMs: result.snapshotShownAt === null ? null : Math.round(result.snapshotShownAt - clicked),
        roomMs: Math.round((marks.startedAt ?? 0) + (marks.metadataMs ?? 0) + (marks.resourcesMs ?? 0) + (marks.materialsMs ?? 0) + (marks.compileMs ?? 0) - clicked),
      },
      phases: { resourcesMs: Math.round(marks.resourcesMs ?? 0), materialsMs: Math.round(marks.materialsMs ?? 0), compileMs: Math.round(marks.compileMs ?? 0) },
      stages: Object.fromEntries(Object.entries(marks).filter(([key]) => !/At$|Ms$/.test(key)).map(([key, value]) => [key, Math.round(value)])),
      snapshot: result.snapshot,
      rafGaps: { over50ms: gaps.filter(gap => gap > 50).length, over100ms: gaps.filter(gap => gap > 100).length, worstMs: Math.round(Math.max(0, ...gaps)) },
      longTasksTotalMs: Math.round(result.longTasks.filter(([at]) => at >= clicked).reduce((sum, [, ms]) => sum + ms, 0)),
      programs: { count: result.programs.length, fragmentMb: +(result.programs.reduce((sum, p) => sum + p.fragmentChars, 0) / 1e6).toFixed(2), list: result.programs },
      memory: result.memory,
      slowGl: result.slowGl.filter(({ at }) => at >= clicked).map(call => ({ ...call, at: Math.round(call.at - clicked) })),
      trace: analysis,
    };
  } finally {
    process.off('SIGTERM', abandon);
    process.off('SIGINT', abandon);
    await app.stop();
    if (!opts['keep-trace']) rmSync(trace, { force: true });
  }
}

seedProfile();
if (opts['fresh-caches']) {
  for (const name of ['GPUCache', 'GPUPersistentCache', 'DawnGraphiteCache']) rmSync(join(PROFILE, name), { recursive: true, force: true });
  rmSync(join(homedir(), '.cache', 'nvidia', `qa-${opts['fresh-caches']}`), { recursive: true, force: true });
}
mkdirSync(RESULTS, { recursive: true });
const runs = [];
for (let i = 0; i < Number(opts.runs); i++) {
  const run = await oneRun(i);
  runs.push(run);
  console.log(`run ${i}: saved frame ${run.fromClick.savedFrameMs} ms, room ${run.fromClick.roomMs} ms | renderer blocked ${run.trace.renderer.blockedOver50Ms} ms (worst ${run.trace.renderer.worstMs}) | gpu blocked ${run.trace.gpu.blockedOver50Ms} ms (worst ${run.trace.gpu.worstMs}) | screen frozen ${run.trace.screen.frozenMs} ms (worst ${run.trace.screen.worstGapMs}) | ${run.programs.count} programs, ${run.programs.fragmentMb} MB fragment`);
}
const file = join(RESULTS, `${label}.json`);
writeFileSync(file, JSON.stringify({ label, repo: REPO, date: new Date().toISOString(), runs }, null, 2));
console.log(`wrote ${file}`);
