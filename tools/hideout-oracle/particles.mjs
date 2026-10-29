// Capture the production map particle layer at the round cameras and measure completed frames.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2] ?? '.codex-run/hideout-oracle');
mkdirSync(out, { recursive: true });
mkdirSync(`${out}/orbit-particles`, { recursive: true });
const cameras = JSON.parse(readFileSync('.codex-run/hideout-reference/cameras.json'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5196/tools/hideout-oracle/viewer.html?mode=post');
  await page.waitForFunction(() => window.__hideout?.state?.scene.getObjectByName('hideout particles')?.userData.ready, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__hideout.state.scene.userData.source2MapPostReady);
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const debug = window.__hideout;
    debug.state.setFrameloop('never');
    debug.tick = debug.state.clock.elapsedTime;
    debug.frame = () => { debug.tick += 1 / 60; debug.state.advance(debug.tick); debug.state.gl.getContext().finish(); };
    const gl = debug.state.gl.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    debug.gpu = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  const measurements = [];
  for (let index = 0; index < cameras.captures.length; index++) {
    await page.evaluate(({ fixed, anchor }) => {
      const debug = window.__hideout, camera = debug.state.camera;
      const heading = -debug.info.heading * Math.PI / 180;
      const convert = ([x, y, z]) => {
        x -= anchor[0]; y -= anchor[1]; z -= anchor[2];
        return [0.0254 * (y * Math.cos(heading) + x * Math.sin(heading)), 0.0254 * z, 0.0254 * (-y * Math.sin(heading) + x * Math.cos(heading))];
      };
      camera.position.set(...convert(fixed.position)); camera.fov = fixed.fov * 180 / Math.PI;
      camera.lookAt(...convert(fixed.target)); camera.updateProjectionMatrix();
    }, { fixed: cameras.captures[index], anchor: cameras.anchor });
    const modes = [];
    for (const enabled of [false, true, true, false]) {
      modes.push(await page.evaluate(enabled => {
        const debug = window.__hideout, group = debug.state.scene.getObjectByName('hideout particles');
        group.visible = enabled;
        for (let n = 0; n < 45; n++) debug.frame();
        const frames = [], particleCpu = [];
        for (let n = 0; n < 120; n++) {
          const start = performance.now(); debug.frame(); frames.push(performance.now() - start);
          particleCpu.push(enabled ? group.userData.cpuMs : 0);
        }
        return { enabled, frames, particleCpu };
      }, enabled));
      const label = enabled ? 'after' : 'before';
      await page.locator('canvas').screenshot({ path: `${out}/camera-${index}-${label}-particles.png` });
    }
    measurements.push({ camera: index, modes });
    console.log(`camera ${index} captured`);
  }
  const diagnostics = await page.evaluate(() => {
    const debug = window.__hideout, group = debug.state.scene.getObjectByName('hideout particles');
    group.visible = true;
    return { gpu: debug.gpu, entities: debug.info.particles.entities, ...group.userData };
  });
  for (let frame = 0; frame < 96; frame++) {
    await page.evaluate(angle => {
      const debug = window.__hideout, camera = debug.state.camera;
      const heading = -debug.info.heading * Math.PI / 180, x = Math.cos(angle) * 180, y = Math.sin(angle) * 180;
      camera.position.set(0.0254 * (y * Math.cos(heading) + x * Math.sin(heading)), 62 * 0.0254, 0.0254 * (-y * Math.sin(heading) + x * Math.cos(heading)));
      camera.lookAt(0, 42 * 0.0254, 0); camera.updateProjectionMatrix();
      for (let n = 0; n < 4; n++) debug.frame();
    }, frame / 96 * Math.PI * 2);
    await page.locator('canvas').screenshot({ path: `${out}/orbit-particles/${String(frame).padStart(4, '0')}.png` });
  }
  writeFileSync(`${out}/measurement-particles.json`, JSON.stringify({ viewport: [720, 720], method: 'Fixed 1/60 simulation steps; GPU finish after the production composer; 45 warmup and 120 measured frames per on/off block; ABBA order at each round camera.', measurements, diagnostics, errors }, null, 2));
  if (errors.length) throw new Error(JSON.stringify(errors));
} finally { await browser.close(); }
