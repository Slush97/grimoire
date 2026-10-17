#!/usr/bin/env node
/*
 * perf.mjs
 * Per-tab performance numbers for a Grimoire checkout, measured in a fenced
 * throwaway app over CDP.
 *
 *   node scripts/qa/perf.mjs --repo ../grimoire-wt-perf-installed --build --label after
 *
 * Options:
 *   --repo <dir>        checkout to measure (default: cwd)
 *   --build             run electron-vite build in that checkout first
 *   --fixture <name>    base (14 mods) or stress (base + 240 disabled clones; default)
 *   --runs <n>          app launches to take the median over (default 3)
 *   --routes a,b        subset of route names (default: all)
 *   --label <name>      result name (default: timestamp)
 *   --visible           real window on the Wayland session with the real GPU,
 *                       one run at a time machine-wide. Use for reported
 *                       numbers; the default Xvfb mode is for iterating.
 *
 * Writes QA_HOME/results/<checkout>/perf-<label>.json and prints a summary.
 * Compare two results with compare.mjs.
 *
 * What each route records (all lower is better):
 *   first     first visit after boot: contentMs (90% of DOM changes landed),
 *             settleMs (hash change until the DOM goes quiet), imagesReadyMs
 *             (every in-view image fully loaded; network bound), layoutShift
 *             (CLS units, content jumping as images or data land), tbtMs (sum of long-task time over 50ms), longTasks,
 *             commits (React commits), layouts, styleRecalcs, scriptMs,
 *             nodes (elements in the live document)
 *   warm      the same, on the second visit
 *   idle      React commits and DOM mutations during 2s of doing nothing;
 *             anything above 0 is work burned on an idle screen
 *   scroll    synthetic mouse-wheel scroll of the page's main scroller,
 *             down then up: frame time p50/p95/max, jankFrames (>33ms),
 *             tbtMs, commits during the scroll
 *   type      typing 'ivy' into the page's search box: keyMaxMs/keyAvgMs
 *             (key to next paint, like INP), afterLastKeyMs (debounced work
 *             landing after the last key), tbtMs, commits
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { connect, Page, sleep } from './cdp.mjs';
import { context, launch, runFromFixture } from './app.mjs';

const { values: opts } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    build: { type: 'boolean', default: false },
    fixture: { type: 'string', default: 'stress' },
    runs: { type: 'string', default: '3' },
    routes: { type: 'string' },
    label: { type: 'string' },
    visible: { type: 'boolean', default: false },
  },
});

const ctx = context(opts.repo);
const label = opts.label ?? new Date().toISOString().replace(/[:.]/g, '-');

const ALL_ROUTES = [
  ['installed', '/'],
  ['browse', '/browse'],
  ['discover', '/discover'],
  ['servers', '/servers'],
  ['locker', '/locker'],
  ['locker-hero', '/locker/hero/:hero'],
  ['foundry', '/foundry'],
  ['conflicts', '/conflicts'],
  ['profiles', '/profiles'],
  ['crosshair', '/crosshair'],
  ['autoexec', '/autoexec'],
  ['stats', '/stats'],
  ['settings', '/settings'],
];
const wanted = opts.routes?.split(',');
const ROUTES = ALL_ROUTES.filter(([name]) => !wanted || wanted.includes(name));

/*
 * Installed before any app script runs: a React DevTools hook stub that only
 * counts commits, long-task and long-animation-frame observers, and a
 * MutationObserver that timestamps the last DOM change.
 */
const INSTRUMENT = String.raw`
(() => {
  const qa = { commits: 0, mutations: 0, lastMutation: 0, longTasks: [], frames: [], recording: false };
  window.__qa = qa;
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let nextId = 1;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      isDisabled: false,
      inject(renderer) { const id = nextId++; this.renderers.set(id, renderer); return id; },
      onScheduleFiberRoot() {},
      onCommitFiberRoot() { qa.commits++; },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  }
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) qa.longTasks.push([e.startTime, e.duration]);
  }).observe({ type: 'longtask', buffered: true });
  qa.shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) qa.shifts.push([e.startTime, e.value]);
  }).observe({ type: 'layout-shift', buffered: true });
  const describe = (r) => {
    const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    if (!el) return r.type;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (r.attributeName ? '[' + r.attributeName + ']' : ' ' + r.type);
  };
  qa.mutTimes = [];
  qa.lastSource = '';
  const watch = () => new MutationObserver((records) => {
    const now = performance.now();
    qa.mutations += records.length;
    qa.lastMutation = now;
    qa.lastSource = describe(records[records.length - 1]);
    if (qa.mutTimes.length < 20000) qa.mutTimes.push([now, records.length]);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) watch(); else document.addEventListener('readystatechange', watch, { once: true });
  qa.startFrames = () => {
    qa.frames = [];
    qa.recording = true;
    const tick = (t) => { qa.frames.push(t); if (qa.recording) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  qa.stopFrames = () => { qa.recording = false; return qa.frames; };
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  qa.imagesSettled = () => [...document.images].filter(inView).every((i) => i.complete);
  qa.mainScroller = () => {
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.clientHeight < 200 || el.scrollHeight < el.clientHeight + 200) continue;
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    if (!best) return null;
    const r = best.getBoundingClientRect();
    const top = Math.max(0, r.top);
    const bottom = Math.min(innerHeight, r.bottom);
    const left = Math.max(0, r.left);
    const right = Math.min(innerWidth, r.right);
    if (bottom - top < 50 || right - left < 50) return null;
    qa.scroller = best;
    return { x: (left + right) / 2, y: (top + bottom) / 2, travel: best.scrollHeight - best.clientHeight };
  };
  // Scroll the main scroller down by distance and back up at speed px/s,
  // one step per frame, recording frame times. Resolves with the timestamps.
  qa.scrollRun = (distance, speed) => new Promise((resolve) => {
    const el = qa.scroller;
    const start = el.scrollTop;
    const frames = [];
    let t0 = null;
    const legMs = (distance / speed) * 1000;
    const tick = (t) => {
      frames.push(t);
      if (t0 === null) t0 = t;
      const e = t - t0;
      const pos = e < legMs ? (e / legMs) * distance : Math.max(0, distance - ((e - legMs) / legMs) * distance);
      el.scrollTop = start + pos;
      if (e < legMs * 2) requestAnimationFrame(tick);
      else { el.scrollTop = start; resolve(frames); }
    };
    requestAnimationFrame(tick);
  });
  qa.searchBox = () => {
    const el = [...document.querySelectorAll('input[type=search], input[type=text], input:not([type])')].find(
      (i) => inView(i) && /search|filter/i.test((i.placeholder || '') + (i.getAttribute('aria-label') || '')),
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
})();
`;

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const round = (x, d = 1) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

async function counters(page) {
  const [qa, m] = await Promise.all([
    page.call(() => ({
      now: performance.now(),
      commits: window.__qa.commits,
      mutations: window.__qa.mutations,
      longTasks: window.__qa.longTasks.length,
      shifts: window.__qa.shifts.length,
      liveNodes: document.getElementsByTagName('*').length,
    })),
    page.metrics(),
  ]);
  return { ...qa, m };
}

async function since(page, before) {
  const after = await counters(page);
  const tasks = await page.call((n) => window.__qa.longTasks.slice(n), before.longTasks);
  const shifts = await page.call((n) => window.__qa.shifts.slice(n), before.shifts);
  return {
    tbtMs: round(tasks.reduce((s, [, d]) => s + Math.max(0, d - 50), 0)),
    longTasks: tasks.length,
    // Cumulative layout shift (CLS units): content jumping as images or data land.
    layoutShift: round(shifts.reduce((sum, [, v]) => sum + v, 0), 3),
    commits: after.commits - before.commits,
    mutations: after.mutations - before.mutations,
    layouts: after.m.LayoutCount - before.m.LayoutCount,
    styleRecalcs: after.m.RecalcStyleCount - before.m.RecalcStyleCount,
    scriptMs: round((after.m.ScriptDuration - before.m.ScriptDuration) * 1000),
    // Elements in the live document. Not Performance.getMetrics Nodes, which
    // counts detached nodes awaiting GC and so depends on the tour so far.
    nodes: after.liveNodes,
  };
}

/*
 * Wait until the DOM has changed at least once after `t0` (or 1s passed with
 * no change), then stayed quiet for `quietMs` with in-view images loaded.
 *   responseMs  first DOM change after t0
 *   contentMs   by when 90% of the DOM changes since t0 had happened
 *   settleMs    the last DOM change, and lastMutation names what it touched
 */
async function quiet(page, t0, { quietMs = 400, timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let imagesReady = null;
  for (;;) {
    const st = await page.call(
      (q, t0) => {
        const now = performance.now();
        const changed = window.__qa.lastMutation > t0 || now - t0 > 1000;
        const images = window.__qa.imagesSettled();
        return { now, images: changed && images, ok: changed && now - window.__qa.lastMutation >= q && images };
      },
      quietMs,
      t0,
    );
    if (st.images && imagesReady === null) imagesReady = st.now - t0;
    if (!st.images) imagesReady = null;
    if (st.ok) break;
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    await sleep(50);
  }
  const s = await page.call((t0) => {
    const times = window.__qa.mutTimes.filter(([t]) => t > t0);
    const total = times.reduce((n, [, c]) => n + c, 0);
    let seen = 0;
    let p90 = null;
    for (const [t, c] of times) {
      seen += c;
      if (p90 === null && seen >= total * 0.9) p90 = t;
    }
    return { now: performance.now(), first: times[0]?.[0] ?? null, p90, last: times.at(-1)?.[0] ?? null, source: window.__qa.lastSource };
  }, t0);
  const rel = (t) => (t === null ? 0 : round(t - t0));
  return {
    responseMs: rel(s.first),
    contentMs: rel(s.p90),
    settleMs: timedOut ? round(s.now - t0) : rel(s.last),
    settleTimedOut: timedOut,
    // When every in-view image had finished loading (polled every ~50ms).
    imagesReadyMs: imagesReady === null ? null : round(imagesReady),
    lastMutation: s.source,
  };
}

/*
 * Every measured visit starts from a neutral tab, so a route's numbers do not
 * depend on which tab the tour came from or which routes were selected.
 */
async function visit(page, path) {
  await page.key('Escape');
  const neutral = path === '/settings' ? '/autoexec' : '/settings';
  const at = await page.call(() => performance.now());
  await page.call((p) => {
    location.hash = '#' + p;
  }, neutral);
  await quiet(page, at, { timeoutMs: 10_000 });
  const before = await counters(page);
  await page.call((p) => {
    location.hash = '#' + p;
  }, path);
  const settle = await quiet(page, before.now);
  return { ...settle, ...(await since(page, before)) };
}

async function idle(page) {
  const before = await counters(page);
  await sleep(2000);
  const d = await since(page, before);
  return { commits: d.commits, mutations: d.mutations, tbtMs: d.tbtMs };
}

async function scroll(page) {
  const target = await page.call(() => window.__qa.mainScroller());
  if (!target) return null;
  const distance = Math.min(target.travel, 6000);
  const before = await counters(page);
  const frames = await page.call((d, v) => window.__qa.scrollRun(d, v), distance, 2500);
  const d = await since(page, before);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  return {
    distancePx: distance,
    frameP50: round(pct(gaps, 50)),
    frameP95: round(pct(gaps, 95)),
    frameMax: round(Math.max(0, ...gaps)),
    jankFrames: gaps.filter((g) => g > 33.4).length,
    tbtMs: d.tbtMs,
    commits: d.commits,
    layouts: d.layouts,
    styleRecalcs: d.styleRecalcs,
  };
}

async function type(page) {
  const box = await page.call(() => window.__qa.searchBox());
  if (!box) return null;
  await page.mouse('mousePressed', box.x, box.y, { button: 'left', clickCount: 1 });
  await page.mouse('mouseReleased', box.x, box.y, { button: 'left', clickCount: 1 });
  await sleep(300);
  const before = await counters(page);
  // Key-to-next-paint per keystroke (what INP measures), then whatever
  // debounced work lands after the last key.
  const keyMs = [];
  for (const ch of 'ivy') {
    await page.call(() => {
      window.__qa.keyStart = performance.now();
    });
    await page.cdp.send('Input.insertText', { text: ch });
    keyMs.push(
      await page.call(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - window.__qa.keyStart))),
          ),
      ),
    );
    await sleep(80);
  }
  const typedAt = await page.call(() => performance.now());
  const value = await page.call(() => document.activeElement?.value ?? null);
  if (value !== 'ivy') console.warn(`  typing did not land in the search box (value: ${JSON.stringify(value)})`);
  const settle = await quiet(page, typedAt);
  const d = await since(page, before);
  // Clear the query so the next route does not inherit a filtered store.
  await page.call(() => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.blur();
    }
  });
  await sleep(500);
  return {
    keyMaxMs: round(Math.max(...keyMs)),
    keyAvgMs: round(keyMs.reduce((a, b) => a + b, 0) / keyMs.length),
    afterLastKeyMs: settle.settleMs,
    tbtMs: d.tbtMs,
    commits: d.commits,
    layouts: d.layouts,
  };
}

function busiestHero() {
  const meta = JSON.parse(readFileSync(join(ctx.PROFILE, 'mod-metadata.json'), 'utf8'));
  const counts = new Map();
  for (const m of Object.values(meta)) if (m.categoryId) counts.set(m.categoryId, (counts.get(m.categoryId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

async function oneRun(n) {
  runFromFixture(ctx, opts.fixture);
  const hero = busiestHero();
  const app = await launch(ctx, { visible: opts.visible });
  try {
    const cdp = await connect(app.port);
    const page = new Page(cdp);
    await page.init(INSTRUMENT);

    // Cold start: wall clock from spawn until the sidebar is up and the
    // renderer's own navigation timing for the first document.
    await page.waitFor(() => document.querySelectorAll('nav a').length > 3, { timeoutMs: 60_000, what: 'sidebar' });
    const launchToSidebarMs = Date.now() - app.startedAt;
    const nav = await page.call(() => {
      const e = performance.getEntriesByType('navigation')[0];
      return { dcl: e?.domContentLoadedEventEnd };
    });

    // Warm renderer boot, instrumented, into Installed like a real launch.
    // Installed's "first" visit in the tour is then a remount with warm
    // stores, the way users come back to it.
    await page.call(() => {
      location.hash = '#/';
    });
    await page.reload();
    await page.waitFor(() => document.querySelectorAll('nav a').length > 3, { timeoutMs: 30_000, what: 'sidebar' });
    const boot = await quiet(page, 0, { timeoutMs: 20_000 });
    const bootTasks = await page.call(() => window.__qa.longTasks);
    // A hidden or occluded window gets no frame callbacks, which would turn
    // every frame metric into noise.
    const frameMs = await page.call(
      () =>
        new Promise((resolve) => {
          const ts = [];
          const tick = (t) => (ts.push(t) < 31 ? requestAnimationFrame(tick) : resolve((ts[30] - ts[0]) / 30));
          requestAnimationFrame(tick);
        }),
    );
    if (frameMs > 20) console.warn(`  warning: frames arrive every ${round(frameMs)}ms; is the window hidden or throttled?`);
    const startup = {
      displayFrameMs: round(frameMs),
      launchToSidebarMs,
      domContentLoadedMs: round(nav.dcl),
      reloadSettleMs: boot.settleMs,
      reloadContentMs: boot.contentMs,
      reloadNeverQuiet: boot.settleTimedOut,
      reloadLastMutation: boot.lastMutation,
      reloadTbtMs: round(bootTasks.reduce((s, [, d]) => s + Math.max(0, d - 50), 0)),
      reloadCommits: await page.call(() => window.__qa.commits),
    };

    const routes = {};
    for (const [name, raw] of ROUTES) {
      const path = raw.replace(':hero', String(hero));
      const first = await visit(page, path);
      routes[name] = { first, idle: await idle(page), scroll: await scroll(page), type: await type(page) };
      console.log(`  run ${n} ${name}: ${first.settleMs}ms${first.settleTimedOut ? ' (never quiet)' : ''}`);
    }
    await page.gc();
    const pass1 = await page.metrics();
    for (const [name, raw] of ROUTES) routes[name].warm = await visit(page, raw.replace(':hero', String(hero)));
    await page.gc();
    const pass2 = await page.metrics();
    const memory = {
      afterTour1HeapMB: round(pass1.JSHeapUsedSize / 1048576),
      afterTour2HeapMB: round(pass2.JSHeapUsedSize / 1048576),
      tourHeapGrowthMB: round((pass2.JSHeapUsedSize - pass1.JSHeapUsedSize) / 1048576),
      tourNodeGrowth: pass2.Nodes - pass1.Nodes,
      listenerGrowth: pass2.JSEventListeners - pass1.JSEventListeners,
    };
    cdp.close();
    return { startup, routes, memory };
  } finally {
    await app.stop();
  }
}

/** Median of every numeric leaf across runs; non-numeric leaves come from the first run. */
function aggregate(runs) {
  const walk = (nodes) => {
    const first = nodes.find((x) => x !== null && x !== undefined);
    if (first === undefined) return null;
    if (typeof first === 'number') return round(median(nodes));
    if (typeof first !== 'object') return first;
    // A route counts as never quiet if any run timed out.
    const out = {};
    for (const k of Object.keys(first)) {
      out[k] = k === 'settleTimedOut' ? nodes.some((n) => n?.[k]) : walk(nodes.map((x) => x?.[k] ?? null));
    }
    return out;
  };
  return walk(runs);
}

function bundleStats() {
  const dir = join(ctx.REPO, 'dist', 'renderer', 'assets');
  const files = readdirSync(dir).map((f) => ({ f, size: statSync(join(dir, f)).size }));
  const js = files.filter((x) => x.f.endsWith('.js'));
  const css = files.filter((x) => x.f.endsWith('.css'));
  const entry = js.filter((x) => /^index-/.test(x.f)).reduce((s, x) => s + x.size, 0);
  const kb = (b) => round(b / 1024);
  return {
    jsKB: kb(js.reduce((s, x) => s + x.size, 0)),
    entryJsKB: kb(entry),
    largestJsKB: kb(Math.max(0, ...js.map((x) => x.size))),
    jsChunks: js.length,
    cssKB: kb(css.reduce((s, x) => s + x.size, 0)),
  };
}

function git(...args) {
  try {
    return execFileSync('git', ['-C', ctx.REPO, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

if (opts.build) {
  console.log(`building ${ctx.REPO}...`);
  execFileSync(join(ctx.REPO, 'node_modules', '.bin', 'electron-vite'), ['build'], {
    cwd: ctx.REPO,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, GRIMOIRE_SOCIAL_BASE_URL: process.env.GRIMOIRE_SOCIAL_BASE_URL || 'https://example.invalid' },
  });
}

const runs = [];
const loadBefore = loadavg()[0];
for (let i = 1; i <= Number(opts.runs); i++) runs.push(await oneRun(i));
const result = {
  label,
  repo: ctx.REPO,
  head: git('rev-parse', '--short', 'HEAD'),
  dirtyFiles: git('status', '--porcelain')?.split('\n').filter(Boolean).length ?? null,
  fixture: opts.fixture,
  routeSet: ROUTES.map(([name]) => name),
  mode: opts.visible ? 'visible-gpu' : 'xvfb-swiftshader',
  netLatency: process.env.QA_NET_LATENCY || null,
  runs: runs.length,
  date: new Date().toISOString(),
  loadavg1m: { before: round(loadBefore, 2), after: round(loadavg()[0], 2) },
  bundle: bundleStats(),
  ...aggregate(runs),
  raw: runs,
};
mkdirSync(ctx.RESULTS, { recursive: true });
const file = join(ctx.RESULTS, `perf-${label}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));

console.log(`\nstartup: ${JSON.stringify(result.startup)}`);
console.log(`bundle:  ${JSON.stringify(result.bundle)}`);
console.log(`memory:  ${JSON.stringify(result.memory)}`);
console.log('\nroute          content  settle   warm  first tbt  idle commits  scroll p95  jank  key max  last mutation');
for (const [name] of ROUTES) {
  const r = result.routes[name];
  const cell = (v, w) => String(v ?? '-').padStart(w);
  console.log(
    name.padEnd(14) +
      cell(r.first.contentMs, 7) +
      cell(r.first.settleMs + (r.first.settleTimedOut ? '!' : ''), 8) +
      cell(r.warm?.settleMs, 7) +
      cell(r.first.tbtMs, 11) +
      cell(r.idle.commits, 14) +
      cell(r.scroll?.frameP95, 12) +
      cell(r.scroll?.jankFrames, 6) +
      cell(r.type?.keyMaxMs, 9) +
      '  ' +
      (r.first.lastMutation ?? ''),
  );
}
console.log(`\n! = never went quiet within 15s (something keeps mutating the DOM)`);
console.log(`wrote ${file}`);
