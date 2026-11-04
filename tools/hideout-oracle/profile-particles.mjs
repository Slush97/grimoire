// Completed-frame attribution. Run alone, at BelowNormal priority, after all exports/builds finish.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5206';
const output = resolve(process.argv[3] ?? '.codex-run/hideout-oracle/profile-particles');
const unthrottled = process.argv.includes('--unthrottled');
const cameras = JSON.parse(readFileSync('.codex-run/hideout-reference/cameras.json'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
  ...(unthrottled ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
] });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${url}/tools/hideout-oracle/viewer.html?mode=post`);
  await page.waitForFunction(() => window.__hideout?.state?.scene.getObjectByName('hideout particles')?.userData.ready, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__hideout.state.scene.userData.source2MapPostReady);
  await page.waitForTimeout(3000);
  await page.evaluate(({ fixed, anchor }) => {
    const d = window.__hideout, s = d.state, gl = s.gl.getContext();
    s.setFrameloop('never'); d.tick = 10;
    const h = -d.info.heading * Math.PI / 180;
    const cv = ([x, y, z]) => {
      x -= anchor[0]; y -= anchor[1]; z -= anchor[2];
      return [.0254 * (y * Math.cos(h) + x * Math.sin(h)), .0254 * z, .0254 * (-y * Math.sin(h) + x * Math.cos(h))];
    };
    s.camera.position.set(...cv(fixed.position)); s.camera.lookAt(...cv(fixed.target));
    s.camera.fov = fixed.fov * 180 / Math.PI; s.camera.updateProjectionMatrix();
    d.frame = () => { d.tick += 1 / 60; s.advance(d.tick); gl.finish(); };
    for (let n = 0; n < 180; n++) d.frame();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    d.gpu = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }, { fixed: cameras.captures[1], anchor: cameras.anchor });
  // Uninstrumented timings are kept separate from the trace and CPU profiler.
  const timing = await page.evaluate(() => {
    const d = window.__hideout, gl = d.state.gl.getContext(), group = d.state.scene.getObjectByName('hideout particles');
    const modes = [];
    for (const particles of [true, false, false, true]) {
      group.visible = particles;
      for (let n = 0; n < 60; n++) d.frame();
      const frames = [];
      for (let n = 0; n < 240; n++) {
        const t = performance.now(); d.tick += 1 / 60; d.state.advance(d.tick);
        const submitted = performance.now(); gl.finish();
        frames.push({ total: performance.now() - t, submit: submitted - t, finish: performance.now() - submitted,
          particleCpu: particles ? group.userData.cpuMs : 0 });
      }
      modes.push({ particles, frames });
    }
    group.visible = true;
    return { modes, gpu: d.gpu };
  });
  await page.evaluate(async () => {
    const d = window.__hideout, gl = d.state.gl.getContext();
    d.counts = { sorts: 0, sortedParticles: 0, textureUploads: 0, compiles: 0, links: 0, bufferBytes: 0 };
    const { ParticleFunctionRenderer } = await import('/src/lib/particles/render/functionRenderer.ts');
    const sort = ParticleFunctionRenderer.sortBackToFront;
    ParticleFunctionRenderer.sortBackToFront = function (particles, camera) {
      d.counts.sorts++; d.counts.sortedParticles += particles.length; return sort.call(this, particles, camera);
    };
    for (const [key, count] of [['texImage2D', 'textureUploads'], ['texSubImage2D', 'textureUploads'],
      ['compressedTexImage2D', 'textureUploads'], ['compressedTexSubImage2D', 'textureUploads'], ['compileShader', 'compiles'], ['linkProgram', 'links']]) {
      const f = gl[key].bind(gl); gl[key] = (...args) => { d.counts[count]++; return f(...args); };
    }
    const upload = gl.bufferSubData.bind(gl);
    gl.bufferSubData = (...args) => {
      d.counts.bufferBytes += args[4] ? args[4] * args[2].BYTES_PER_ELEMENT : args[2].byteLength;
      return upload(...args);
    };
  });
  const cdp = await page.context().newCDPSession(page), events = [];
  cdp.on('Tracing.dataCollected', event => events.push(...event.value));
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.gc,gpu,cc', options: 'sampling-frequency=10000' });
  const samples = await page.evaluate(() => {
    const d = window.__hideout, gl = d.state.gl.getContext(), group = d.state.scene.getObjectByName('hideout particles'), frames = [];
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    d.gpuQueries = []; d.gpuTimer = timer;
    for (let n = 0; n < 480; n++) {
      performance.mark(`frame-${n}-start`);
      const query = timer ? gl.createQuery() : null;
      if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      const t = performance.now(); d.tick += 1 / 60; d.state.advance(d.tick); const submitted = performance.now();
      if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); d.gpuQueries.push(query); }
      gl.finish();
      frames.push({ total: performance.now() - t, submit: submitted - t, finish: performance.now() - submitted,
        particleCpu: group.userData.cpuMs, particles: group.userData.systems.reduce((n, system) => n + system.particles, 0) });
      performance.mark(`frame-${n}-end`);
    }
    return { frames, counts: d.counts, diagnostics: group.userData };
  });
  const gpuMs = await page.evaluate(() => {
    const d = window.__hideout, gl = d.state.gl.getContext();
    if (!d.gpuTimer || gl.getParameter(d.gpuTimer.GPU_DISJOINT_EXT)) return null;
    return d.gpuQueries.map(query => {
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(query, gl.QUERY_RESULT) : null;
      gl.deleteQuery(query); return ns === null ? null : ns / 1e6;
    });
  });
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await complete;
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync(`${output}.trace.json`, JSON.stringify({ traceEvents: events }));
  writeFileSync(`${output}.cpuprofile`, JSON.stringify(profile));
  writeFileSync(`${output}.json`, JSON.stringify({ unthrottled, timing, samples, gpuMs, errors }, null, 2));
  const quantile = (values, p) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
  const frames = timing.modes.filter(mode => mode.particles).flatMap(mode => mode.frames);
  console.log(JSON.stringify({ output, unthrottled, median: quantile(frames.map(f => f.total), .5), p95: quantile(frames.map(f => f.total), .95), counts: samples.counts, errors }));
  if (errors.length) throw new Error(JSON.stringify(errors));
} finally { await browser.close(); }
