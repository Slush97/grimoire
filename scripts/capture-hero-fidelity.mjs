// One browser, one page, one capture at a time. Run before edits and again after.
// node scripts/capture-hero-fidelity.mjs before|after [hero,...] [--url http://127.0.0.1:5185] [--out dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw new Error('Expected before or after');
const heroes = (process.argv[3] ?? 'viscous,infernus,dynamo').split(',');
const urlIndex = process.argv.indexOf('--url');
const base = urlIndex < 0 ? 'http://127.0.0.1:5185' : process.argv[urlIndex + 1];
const outIndex = process.argv.indexOf('--out');
const out = outIndex < 0 ? '.codex-run/screenshots/materials/fidelity' : process.argv[outIndex + 1];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const hero of heroes) {
    const page = await browser.newPage({ viewport: { width: 720, height: 980 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 400)); });
    await page.addInitScript(() => {
      let now = 0, id = 0, queue = [], auto = true;
      const realFrame = requestAnimationFrame.bind(window);
      performance.now = () => now;
      window.requestAnimationFrame = (fn) => { queue.push({ id: ++id, fn }); return id; };
      window.cancelAnimationFrame = (cancel) => { queue = queue.filter((entry) => entry.id !== cancel); };
      const step = () => { now += 1000 / 60; const due = queue; queue = []; due.forEach(({ fn }) => fn(now)); };
      const loop = () => { if (auto) step(); realFrame(loop); };
      realFrame(loop);
      window.__clock = { manual() { auto = false; }, advance(n) { for (let i = 0; i < n; i++) step(); } };
      localStorage.setItem('grimoire.preview.presentation.autoRotate', '0');
      localStorage.setItem('grimoire.preview.presentation.cloth', '0');
    });
    await page.goto(`${base}/hero-preview.html?source=cache&case=${hero}_vanilla&particles=engine&scene=studio&backdrop=none`);
    await page.waitForSelector('#hero-viewer canvas', { timeout: 180000 });
    await page.waitForFunction(() => document.querySelector('[data-animation-availability]')?.dataset.animationAvailability === 'ready', null, { timeout: 180000 });
    await page.waitForTimeout(7000);
    await page.evaluate(() => window.__clock.manual());
    await page.evaluate(() => {
      const slider = document.querySelector('#hero-viewer input[type="range"]');
      if (slider && !slider.disabled) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0');
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);
    const resume = page.locator('#hero-viewer button[aria-label="Resume animation"]');
    if (await resume.count()) await resume.click();
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const { viewerState } = await import('/src/dev/heroFidelityCapture.ts');
      viewerState().clock.elapsedTime = 0;
      window.__clock.advance(121);
    });
    await page.waitForTimeout(500);
    const state = await page.evaluate(async () => {
      const { viewerState } = await import('/src/dev/heroFidelityCapture.ts');
      const { camera, scene, clock } = viewerState();
      const meshes = [], particles = [];
      scene.traverse((o) => {
        if (o.isMesh) meshes.push({ name: o.name, visible: o.visible, order: o.renderOrder,
          materials: (Array.isArray(o.material) ? o.material : [o.material]).map((m) => ({ name: m.name, transparent: m.transparent, depthWrite: m.depthWrite, transmission: m.transmission, citadel: m.uniforms?.uCitadelLighting?.value })) });
        if (o.name.startsWith('particles:')) particles.push(o.name);
      });
      return { camera: camera.position.toArray(), home: camera.userData.previewHome, shaderTime: clock.elapsedTime, meshes, particles };
    });
    await page.evaluate(() => {
      const canvas = document.querySelector('#hero-viewer canvas');
      for (const node of document.querySelectorAll('#hero-viewer *')) if (!node.contains(canvas)) node.style.visibility = 'hidden';
    });
    await page.locator('#hero-viewer canvas').screenshot({ path: join(out, `${hero}-${stage}.png`) });
    // Fixed close-up relative to the saved full-body camera. Both stages use the same transform.
    await page.locator('#hero-viewer canvas').focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('q');
    for (let i = 0; i < 13; i++) await page.keyboard.press('Shift+w');
    await page.evaluate(() => window.__clock.advance(1));
    await page.waitForTimeout(100);
    await page.locator('#hero-viewer canvas').screenshot({ path: join(out, `${hero}-${stage}-face.png`) });
    writeFileSync(join(out, `${hero}-${stage}.json`), JSON.stringify({ stage, hero, ticks: 122, ...state, errors }, null, 2));
    console.log(hero, stage, `${state.particles.length} particle trees`, errors.length ? errors : 'no errors');
    await page.close();
  }
} finally { await browser.close(); }
