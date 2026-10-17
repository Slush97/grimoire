#!/usr/bin/env node
/*
 * shots.mjs
 * Screenshot every tab of a Grimoire checkout in a fenced throwaway app, for
 * before/after design review.
 *
 *   node scripts/qa/shots.mjs --repo <dir> [--build] [--fixture base] [--label before] [--width 1280 --height 800] [--visible]
 *
 * Writes QA_HOME/results/<checkout>/shots-<label>/<route>.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { connect, Page, sleep } from './cdp.mjs';
import { context, launch, runFromFixture } from './app.mjs';

const { values: opts } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    build: { type: 'boolean', default: false },
    fixture: { type: 'string', default: 'base' },
    label: { type: 'string', default: 'current' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '800' },
    routes: { type: 'string' },
    visible: { type: 'boolean', default: false },
  },
});

const ctx = context(opts.repo);
const ROUTES = [
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
].filter(([name]) => !opts.routes || opts.routes.split(',').includes(name));

const FREEZE = `
*, *::before, *::after {
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  animation-delay: -1ms !important;
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  caret-color: transparent !important;
}`;

if (opts.build) {
  execFileSync(join(ctx.REPO, 'node_modules', '.bin', 'electron-vite'), ['build'], {
    cwd: ctx.REPO,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, GRIMOIRE_SOCIAL_BASE_URL: process.env.GRIMOIRE_SOCIAL_BASE_URL || 'https://example.invalid' },
  });
}

runFromFixture(ctx, opts.fixture);
const meta = JSON.parse(readFileSync(join(ctx.PROFILE, 'mod-metadata.json'), 'utf8'));
const counts = new Map();
for (const m of Object.values(meta)) if (m.categoryId) counts.set(m.categoryId, (counts.get(m.categoryId) ?? 0) + 1);
const hero = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

const out = join(ctx.RESULTS, `shots-${opts.label}`);
mkdirSync(out, { recursive: true });
const app = await launch(ctx, { visible: opts.visible });
try {
  const page = new Page(await connect(app.port), { width: Number(opts.width), height: Number(opts.height) });
  await page.init();
  await page.waitFor(() => document.querySelectorAll('nav a').length > 3, { timeoutMs: 60_000, what: 'sidebar' });
  await sleep(1500);
  for (const [name, raw] of ROUTES) {
    await page.key('Escape');
    await page.call((p) => {
      location.hash = '#' + p;
    }, raw.replace(':hero', String(hero)));
    await sleep(2500);
    await page.call((css) => {
      let el = document.getElementById('__qa-freeze');
      if (!el) {
        el = document.createElement('style');
        el.id = '__qa-freeze';
        document.head.appendChild(el);
      }
      el.textContent = css;
    }, FREEZE);
    await page.mouse('mouseMoved', page.width - 2, page.height - 2);
    await sleep(600);
    writeFileSync(join(out, `${name}.png`), await page.screenshot());
    console.log(`  ${name}.png`);
  }
} finally {
  await app.stop();
}
console.log(`wrote ${out}`);
