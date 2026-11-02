// Sequential production captures and optional HDR term readbacks. No app-cache writes.
// node scripts/capture-viewer-lighting.mjs before|after [hero,...] [--probe]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw new Error('Expected before or after');
const heroes = (process.argv[3] ?? 'grey_talon,abrams,mo_krill,paige,infernus,viscous,celeste,dynamo,graves').split(',');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const out = option('--out', '.codex-run/screenshots/materials/fidelity-r3');
const scenes = option('--scenes', 'studio,midtown').split(',');
const particlePath = option('--particles', 'engine');
const requestedClip = option('--clip', '');
const cases = await fetch('http://127.0.0.1:5185/@hero-cache/index.json').then((response) => response.json());
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const hero of heroes) for (const scene of scenes) {
    const page = await browser.newPage({ viewport: { width: 720, height: 980 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text().slice(0, 400)} ${message.location().url}`); });
    await page.addInitScript(({ clip, label }) => {
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
      if (clip) localStorage.setItem(`grimoire.foundry.draft.v1:${JSON.stringify(['', `viewer:${label}:view:clip`])}`, JSON.stringify(clip));
    }, { clip: requestedClip, label: cases.find((item) => item.name === `${hero}_vanilla`)?.label });
    await page.goto(`http://127.0.0.1:5185/hero-preview.html?source=cache&case=${hero}_vanilla&particles=${particlePath}&scene=${scene}&backdrop=${scene === 'studio' ? 'none' : 'broadway'}`);
    await page.waitForSelector('#hero-case:not([disabled])', { timeout: 180000 });
    const selected = await page.locator('#hero-case').inputValue();
    if (selected !== `${hero}_vanilla`) throw new Error(`Requested ${hero}_vanilla, harness selected ${selected}`);
    await page.waitForSelector('#hero-viewer canvas', { timeout: 180000 });
    await page.waitForFunction(() => document.querySelector('[data-animation-availability]')?.dataset.animationAvailability === 'ready', null, { timeout: 180000 });
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.__clock.manual());
    await page.evaluate(() => {
      const slider = document.querySelector('#hero-viewer input[type="range"]');
      if (slider && !slider.disabled) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0');
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(200);
    const resume = page.locator('#hero-viewer button[aria-label="Resume animation"]');
    if (await resume.count()) await resume.click();
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const { viewerState } = await import('/src/dev/heroFidelityCapture.ts');
      viewerState().clock.elapsedTime = 0;
      window.__clock.advance(121);
    });
    await page.waitForTimeout(100);
    const metadata = await page.evaluate(async () => {
      const { viewerState } = await import('/src/dev/heroFidelityCapture.ts');
      const { camera, clock, scene } = viewerState();
      const materials = [];
      scene.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.uniforms) materials.push({ name: m.name, exposure: m.uniforms.uCitadelExposure?.value, selfIllum: m.uniforms.uCitadelSelfIllumScale?.value, roughness: m.roughness, metalness: m.metalness }); });
      return { camera: camera.position.toArray(), home: camera.userData.previewHome, shaderTime: clock.elapsedTime, materials, post: scene.userData.sourcePostSettings ?? null };
    });
    await page.evaluate(() => {
      const canvas = document.querySelector('#hero-viewer canvas');
      for (const node of document.querySelectorAll('#hero-viewer *')) if (!node.contains(canvas)) node.style.visibility = 'hidden';
    });
    const stem = join(out, `${hero}-${scene}-${stage}`);
    await page.locator('#hero-viewer canvas').screenshot({ path: `${stem}.png` });
    if (process.argv.includes('--probe')) {
      const result = await page.evaluate(async () => {
        const { captureLightingTerms } = await import('/src/dev/viewerLightingCapture.ts');
        const { outputs, ...info } = captureLightingTerms();
        const encoded = {};
        for (const [name, values] of Object.entries(outputs)) {
          const bytes = new Uint8Array(new Float32Array(values).buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          encoded[name] = btoa(binary);
        }
        return { ...info, outputs: encoded };
      });
      for (const [name, data] of Object.entries(result.outputs)) writeFileSync(`${stem}-${name}.f32`, Buffer.from(data, 'base64'));
      delete result.outputs;
      metadata.probe = result;
    }
    if (['infernus', 'celeste', 'dynamo', 'viscous'].includes(hero)) {
      await page.locator('#hero-viewer canvas').focus();
      for (let i = 0; i < 20; i++) await page.keyboard.press('q');
      for (let i = 0; i < 13; i++) await page.keyboard.press('Shift+w');
      await page.evaluate(() => window.__clock.advance(1));
      await page.locator('#hero-viewer canvas').screenshot({ path: `${stem}-face.png` });
    }
    writeFileSync(`${stem}.json`, JSON.stringify({ stage, hero, scene, ...metadata, errors }, null, 2));
    console.log(`${hero} ${scene} ${stage}: ${errors.length} errors`);
    await page.close();
  }
} finally { await browser.close(); }
