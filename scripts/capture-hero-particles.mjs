// Dev-only: captures the production hero viewer (hero-preview.html, served by
// scripts/hero-preview-server.mjs) with the curated overlay and the engine particle runtime, frame for
// frame alike, for review.
//
// usage: node scripts/capture-hero-particles.mjs <case>... [--scenes studio,midtown] [--at 2.0]
//        [--video 3.5] [--fps 30] [--out .codex-run/screenshots/final] [--url http://127.0.0.1:5183]
//        [--channel msedge]
//
// The page runs on a virtual clock: requestAnimationFrame and performance.now advance exactly one
// frame per tick, and only when the script says so. After loading, the clip is sought to 0, which
// restarts both particle paths, then both are advanced the same number of ticks, so the old and the
// engine capture show the same clip time and the same particle age. Studio is the studio scene without
// a backdrop, Midtown the Midtown scene on its default backdrop. Per case and scene it writes
// `<case>-<scene>-old.png`, `-engine.png`, `-side-by-side.png` and `-crop.png` (both paths, cropped
// on the engine's particles), and with --video `<case>-<scene>-side-by-side.mp4` (needs ffmpeg). The
// clips show simulated time at an even rate; they do not show how fast the browser renders.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const cases = [];
let scenes = ['studio', 'midtown'];
let at = 2.0;
let video = 0;
let fps = 30;
let out = join(root, '.codex-run', 'screenshots', 'final');
let url = 'http://127.0.0.1:5183';
let channel = 'msedge';

for (let i = 0; i < args.length; i++) {
  const value = () => args[++i];
  switch (args[i]) {
    case '--scenes': scenes = value().split(','); break;
    case '--at': at = Number(value()); break;
    case '--video': video = Number(value()); break;
    case '--fps': fps = Number(value()); break;
    case '--out': out = resolve(value()); break;
    case '--url': url = value(); break;
    case '--channel': channel = value(); break;
    default: cases.push(args[i]);
  }
}

const TICK = 1000 / 60;
const PATHS = [{ path: 'overlay', label: 'old (curated overlay)', file: 'old' }, { path: 'engine', label: 'engine particles', file: 'engine' }];
const VIEWPORT = { width: 720, height: 900 };

// The virtual clock, installed before any page script runs
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

async function openViewer(browser, name, path, scene) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (message) => {
    const text = message.text();
    if ((message.type() === 'error' || message.type() === 'warning') && !/X4000|X4122|THREE\.Clock|status of 404/.test(text)) logs.push(`${message.type()}: ${text.slice(0, 240)}`);
  });
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
  await page.addInitScript(installClock, TICK);
  await page.addInitScript(() => localStorage.setItem('grimoire.preview.presentation.autoRotate', '0'));
  const backdrop = scene === 'studio' ? 'none' : 'broadway';
  await page.goto(`${url}/hero-preview.html?source=cache&case=${encodeURIComponent(name)}&particles=${path}&scene=${scene}&backdrop=${backdrop}`);
  await page.waitForSelector('#hero-viewer canvas', { timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('[data-animation-availability]')?.getAttribute('data-animation-availability') !== 'pending', null, { timeout: 180000 });
  // Let the bundle, textures, backdrop and environment arrive and the shaders compile on the live clock
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__clock.manual());
  // Seek the clip to 0: the rig restarts, and so do both particle paths (they remount on a seek)
  // (a hero without a clip has no timeline; its paths keep the time they loaded with)
  const sought = await page.evaluate(() => {
    const slider = document.querySelector('#hero-viewer input[type="range"]');
    if (!slider || slider.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '0');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  if (!sought) logs.push('no timeline: not sought, paths not aligned');
  await page.waitForTimeout(500);
  // A seek pauses playback; resume it, then let the remounted particle paths start
  if (sought) await page.locator('#hero-viewer button[aria-label="Resume animation"]').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__clock.advance(1));
  await page.waitForTimeout(500);
  return { page, logs };
}

async function advanceTo(page, ticks) {
  await page.evaluate((count) => window.__clock.advance(count), ticks);
  // Let any texture that finished loading upload on the next tick, then present
  await page.waitForTimeout(50);
}

const shoot = (page, file) => page.locator('#hero-viewer canvas').screenshot({ path: file });

async function compose(browser, file, panels, width, height) {
  const page = await browser.newPage({ viewport: { width: width * panels.length, height: height + 34 } });
  const html = panels.map(({ image, label }) => `<figure><img src="data:image/png;base64,${readFileSync(image).toString('base64')}" style="width:${width}px;height:${height}px;object-fit:contain"><figcaption>${label}</figcaption></figure>`).join('');
  await page.setContent(`<style>body{margin:0;display:flex;background:#111;color:#ddd;font:14px system-ui,sans-serif}figure{margin:0}figcaption{padding:8px 12px}img{display:block;background:#000}</style>${html}`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
}

function cropBox(bounds, size) {
  const [left, top, right, bottom] = bounds;
  const half = Math.max(90, Math.max(right - left, bottom - top) / 2 + 60);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const x = Math.max(0, Math.round(cx - half));
  const y = Math.max(0, Math.round(cy - half));
  return { x, y, width: Math.min(size.width - x, Math.round(half * 2)), height: Math.min(size.height - y, Math.round(half * 2)) };
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const atTicks = Math.round(at * 60);
const perVideoFrame = Math.round(60 / fps);
const videoFrames = Math.round(video * fps);

for (const name of cases) {
  for (const scene of scenes) {
    const stem = join(out, `${name}-${scene}`);
    const viewers = [];
    for (const entry of PATHS) viewers.push({ ...entry, ...(await openViewer(browser, name, entry.path, scene)) });

    for (const viewer of viewers) await advanceTo(viewer.page, atTicks);
    const engine = viewers.find((viewer) => viewer.path === 'engine');
    const bounds = (await engine.page.evaluate(() => document.querySelector('#hero-viewer canvas')?.dataset.particleBounds ?? '')).split(',').map(Number);
    const canvasBox = await engine.page.locator('#hero-viewer canvas').boundingBox();
    const size = { width: Math.round(canvasBox.width), height: Math.round(canvasBox.height) };

    for (const viewer of viewers) await shoot(viewer.page, `${stem}-${viewer.file}.png`);
    await compose(browser, `${stem}-side-by-side.png`, viewers.map((viewer) => ({ image: `${stem}-${viewer.file}.png`, label: `${name} ${scene} @ ${at.toFixed(2)} s: ${viewer.label}` })), size.width, size.height);

    if (bounds.length === 4 && bounds.every(Number.isFinite)) {
      const box = cropBox(bounds, size);
      const crops = [];
      for (const viewer of viewers) {
        const file = `${stem}-${viewer.file}.crop.png`;
        await viewer.page.screenshot({ path: file, clip: { ...box, x: canvasBox.x + box.x, y: canvasBox.y + box.y } });
        crops.push({ image: file, label: `${viewer.label}` });
      }
      await compose(browser, `${stem}-crop.png`, crops, 480, 480);
      for (const crop of crops) rmSync(crop.image, { force: true });
    }

    if (videoFrames > 0) {
      const frames = mkdtempSync(join(out, '.frames-'));
      try {
        for (let frame = 0; frame < videoFrames; frame++) {
          for (const viewer of viewers) {
            if (frame > 0) await advanceTo(viewer.page, perVideoFrame);
            await shoot(viewer.page, join(frames, `${viewer.file}-${String(frame).padStart(4, '0')}.png`));
          }
        }
        const label = join(frames, 'label.png');
        const labelPage = await browser.newPage({ viewport: { width: size.width * 2, height: 34 } });
        await labelPage.setContent(`<style>body{margin:0;display:flex;background:#111;color:#ddd;font:14px system-ui,sans-serif}div{width:${size.width}px;padding:8px 12px;box-sizing:border-box}</style>${viewers.map((viewer) => `<div>${name} ${scene}: ${viewer.label}</div>`).join('')}`);
        await labelPage.screenshot({ path: label });
        await labelPage.close();
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(frames, 'old-%04d.png'), '-framerate', String(fps), '-i', join(frames, 'engine-%04d.png'), '-i', label,
          '-filter_complex', '[0:v][1:v]hstack=inputs=2[pair];[2:v][pair]vstack=inputs=2,format=yuv420p,pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-r', String(fps), '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', `${stem}-side-by-side.mp4`]);
      } finally {
        rmSync(frames, { recursive: true, force: true });
      }
    }

    for (const viewer of viewers) {
      console.log(`${name} ${scene} ${viewer.path}${viewer.logs.length ? `\n  ${viewer.logs.slice(0, 6).join('\n  ')}` : ''}`);
      await viewer.page.close();
    }
    writeFileSync(`${stem}.bounds.json`, JSON.stringify({ at, bounds }));
  }
}

await browser.close();
