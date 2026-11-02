// Dev-only: captures the Foundry movement preview (hero-preview.html?movement=<bake>, served by
// scripts/hero-preview-server.mjs with exports from scripts/export-movement-preview.ts) with the old
// curated overlay and the engine runtime side by side, frame for frame alike, as a phone-friendly MP4
// (H.264, yuv420p, faststart, even size) and a contact sheet PNG.
//
// usage: node scripts/capture-movement-preview.mjs <bake key> <case>... [--name heavy-melee] [--video 3.5] [--fps 30]
//        [--out ../melee-clips] [--url http://127.0.0.1:5183] [--channel msedge] [--size 480x600] [--engine-only] [--no-bloom]
//
// The page runs on a virtual clock (requestAnimationFrame and performance.now advance one 60 Hz frame
// per tick, only when told), and both previews are started over together once loaded, so the two
// panels show the same moment of the loop.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const positional = [];
let name = 'movement';
let video = 3.5;
let fps = 30;
let out = resolve(root, '..', 'melee-clips');
let url = 'http://127.0.0.1:5183';
let channel = 'msedge';
let size = { width: 480, height: 600 };
let engineOnly = false;
let bloom = true;

for (let i = 0; i < args.length; i++) {
  const value = () => args[++i];
  switch (args[i]) {
    case '--name': name = value(); break;
    case '--video': video = Number(value()); break;
    case '--fps': fps = Number(value()); break;
    case '--out': out = resolve(value()); break;
    case '--url': url = value(); break;
    case '--channel': channel = value(); break;
    case '--engine-only': engineOnly = true; break;
    case '--no-bloom': bloom = false; break;
    case '--size': { const [w, h] = value().split('x').map(Number); size = { width: w, height: h }; break; }
    default: positional.push(args[i]);
  }
}
const [bake, ...cases] = positional;
if (!bake || cases.length === 0) throw new Error('usage: capture-movement-preview.mjs <bake key> <case>...');

const TICK = 1000 / 60;
const PATHS = [{ path: 'overlay', label: 'before (old preview)' }, { path: 'engine', label: 'after (game clips + engine)' }].filter((entry) => !engineOnly || entry.path === 'engine');

function installClock(tick) {
  let now = 0;
  let id = 0;
  let queue = [];
  const realFrame = window.requestAnimationFrame.bind(window);
  let auto = true;
  performance.now = () => now;
  window.requestAnimationFrame = (callback) => { queue.push({ id: ++id, callback }); return id; };
  window.cancelAnimationFrame = (cancel) => { queue = queue.filter((entry) => entry.id !== cancel); };
  const step = () => {
    now += tick;
    const due = queue;
    queue = [];
    for (const entry of due) entry.callback(now);
  };
  const loop = () => { if (auto) step(); realFrame(loop); };
  realFrame(loop);
  window.__clock = { advance(count) { for (let i = 0; i < count; i++) step(); }, manual() { auto = false; } };
}

async function openViewer(browser, caseName, path) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height + 60 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (message) => {
    const text = message.text();
    if ((message.type() === 'error' || message.type() === 'warning') && !/X4000|X4122|THREE\.Clock|status of 404/.test(text)) logs.push(`${message.type()}: ${text.slice(0, 240)}`);
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
  await page.addInitScript(installClock, TICK);
  await page.addInitScript(() => localStorage.setItem('grimoire.preview.presentation.autoRotate', '0'));
  if (!bloom) await page.addInitScript(() => localStorage.setItem('grimoire.preview.presentation.bloom', '0'));
  await page.goto(`${url}/hero-preview.html?source=cache&case=${encodeURIComponent(caseName)}&particles=${path}&scene=studio&backdrop=none&movement=${bake}`);
  await page.waitForSelector('#hero-viewer canvas', { timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('[data-animation-availability]')?.getAttribute('data-animation-availability') !== 'pending', null, { timeout: 180000 });
  if (path === 'engine') {
    await page.waitForFunction(() => document.querySelector('#hero-viewer canvas')?.dataset.movementEngine === 'ready', null, { timeout: 180000 })
      .catch(() => logs.push('engine preview did not load'));
  }
  // Let the textures arrive and the shaders compile on the live clock, then start over on the virtual one
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__clock.manual());
  await page.evaluate(() => window.__movementReplay());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__clock.advance(1));
  await page.waitForTimeout(300);
  return { page, logs };
}

async function advance(page, ticks) {
  await page.evaluate((count) => window.__clock.advance(count), ticks);
  await page.waitForTimeout(30);
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const perFrame = Math.round(60 / fps);
const frames = Math.round(video * fps);

for (const caseName of cases) {
  const hero = caseName.replace(/_vanilla$/, '');
  const stem = join(out, `${hero}-${name}`);
  const viewers = [];
  for (const entry of PATHS) viewers.push({ ...entry, ...(await openViewer(browser, caseName, entry.path)) });
  const dir = mkdtempSync(join(out, '.frames-'));
  try {
    for (let frame = 0; frame < frames; frame++) {
      for (const [index, viewer] of viewers.entries()) {
        if (frame > 0) await advance(viewer.page, perFrame);
        await viewer.page.locator('#hero-viewer canvas').screenshot({ path: join(dir, `${index}-${String(frame).padStart(4, '0')}.png`) });
      }
    }
    const labelPage = await browser.newPage({ viewport: { width: size.width * viewers.length, height: 40 } });
    await labelPage.setContent(`<style>body{margin:0;display:flex;background:#111;color:#eee;font:600 17px system-ui,sans-serif}div{width:${size.width}px;padding:10px 12px;box-sizing:border-box}</style>${viewers.map((viewer) => `<div>${hero} ${name}: ${viewer.label}</div>`).join('')}`);
    await labelPage.screenshot({ path: join(dir, 'label.png') });
    await labelPage.close();
    const scale = `scale=${size.width}:${size.height}`;
    const inputs = viewers.flatMap((_, index) => ['-framerate', String(fps), '-i', join(dir, `${index}-%04d.png`)]);
    const panels = viewers.length === 2 ? `[0:v]${scale}[a];[1:v]${scale}[b];[a][b]hstack=inputs=2[pair]` : `[0:v]${scale}[pair]`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-i', join(dir, 'label.png'),
      '-filter_complex', `${panels};[${viewers.length}:v][pair]vstack=inputs=2,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p`,
      '-r', String(fps), '-c:v', 'libx264', '-profile:v', 'high', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', `${stem}.mp4`]);
    // A contact sheet: four moments of the loop, both paths
    if (viewers.length !== 2) continue;
    const picks = [0.2, 0.4, 0.6, 0.8].map((fraction) => Math.min(frames - 1, Math.round(fraction * frames)));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
      ...picks.flatMap((frame) => ['-i', join(dir, `0-${String(frame).padStart(4, '0')}.png`), '-i', join(dir, `1-${String(frame).padStart(4, '0')}.png`)]),
      '-filter_complex', `${picks.map((_, i) => `[${i * 2}:v]${scale},scale=iw/2:ih/2[o${i}];[${i * 2 + 1}:v]${scale},scale=iw/2:ih/2[e${i}]`).join(';')};`
        + `${picks.map((_, i) => `[o${i}]`).join('')}hstack=inputs=${picks.length}[old];${picks.map((_, i) => `[e${i}]`).join('')}hstack=inputs=${picks.length}[new];[old][new]vstack=inputs=2`,
      '-frames:v', '1', `${stem}.sheet.png`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const viewer of viewers) {
    console.log(`${hero} ${name} ${viewer.path}${viewer.logs.length ? `\n  ${viewer.logs.slice(0, 6).join('\n  ')}` : ''}`);
    await viewer.page.close();
  }
}

await browser.close();
