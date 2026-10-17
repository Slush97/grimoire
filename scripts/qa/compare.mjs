#!/usr/bin/env node
/*
 * compare.mjs
 * Diff two perf.mjs results. Every metric is lower-is-better.
 *
 *   node scripts/qa/compare.mjs <before.json> <after.json> [--all]
 *
 * Shows only metrics that moved past the noise floor unless --all is given:
 * timings (ms, tbt, frame) need 15% and 5ms, counts need 5% and 1.
 */
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const all = process.argv.includes('--all');
if (!a || !b) {
  console.error('usage: compare.mjs <before.json> <after.json> [--all]');
  process.exit(1);
}
const A = JSON.parse(readFileSync(a, 'utf8'));
const B = JSON.parse(readFileSync(b, 'utf8'));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k === 'raw') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number') out[key] = v;
    else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

// The memory block and warm visits depend on which tabs the tour visited, so
// they only compare between runs over the same route set.
const sameTour = JSON.stringify(A.routeSet ?? Object.keys(A.routes)) === JSON.stringify(B.routeSet ?? Object.keys(B.routes));
const pick = (R) => ({
  startup: R.startup,
  bundle: R.bundle,
  ...(sameTour ? { memory: R.memory } : {}),
  routes: Object.fromEntries(
    Object.entries(R.routes).map(([k, v]) => [k, sameTour ? v : Object.fromEntries(Object.entries(v).filter(([p]) => p !== 'warm'))]),
  ),
});
const fa = flatten(pick(A));
const fb = flatten(pick(B));
const isTiming = (k) => /(Ms|ms|frame|MB|KB)/.test(k.split('.').pop());

let better = 0;
let worse = 0;
const rows = [];
for (const key of Object.keys({ ...fa, ...fb })) {
  const x = fa[key];
  const y = fb[key];
  if (x === undefined || y === undefined || x === null || y === null) continue;
  const delta = y - x;
  const rel = x === 0 ? (y === 0 ? 0 : Infinity) : delta / x;
  const floorAbs = isTiming(key) ? 5 : 1;
  const floorRel = isTiming(key) ? 0.15 : 0.05;
  const moved = Math.abs(delta) >= floorAbs && Math.abs(rel) >= floorRel;
  if (moved) delta < 0 ? better++ : worse++;
  if (moved || all) rows.push({ key, x, y, delta, rel, moved });
}

console.log(`${A.label} (${A.head}, load ${A.loadavg1m?.before})  ->  ${B.label} (${B.head}, load ${B.loadavg1m?.before})`);
console.log(`fixture ${A.fixture}/${B.fixture}, mode ${A.mode}/${B.mode}, runs ${A.runs}/${B.runs}\n`);
if (!sameTour) {
  console.log('note: different route sets, so memory.* and routes.*.warm.* are left out; first visits still compare\n');
}
if (A.mode !== B.mode || A.fixture !== B.fixture || (A.netLatency ?? null) !== (B.netLatency ?? null)) {
  console.log('warning: different mode, fixture or QA_NET_LATENCY; these two results are not comparable\n');
}
console.log('metric'.padEnd(44) + 'before'.padStart(10) + 'after'.padStart(10) + 'change'.padStart(10));
for (const r of rows) {
  const change = Number.isFinite(r.rel) ? `${r.rel > 0 ? '+' : ''}${Math.round(r.rel * 100)}%` : 'new';
  const tag = r.moved ? (r.delta < 0 ? '  better' : '  WORSE') : '';
  console.log(r.key.padEnd(44) + String(r.x).padStart(10) + String(r.y).padStart(10) + change.padStart(10) + tag);
}
console.log(`\n${better} better, ${worse} worse past the noise floor`);
if (Math.abs((A.loadavg1m?.before ?? 0) - (B.loadavg1m?.before ?? 0)) > 4) {
  console.log('warning: machine load differed a lot between the two runs; timings are suspect, counts are not');
}
