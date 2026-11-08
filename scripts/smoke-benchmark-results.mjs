// Build first. Replays saved evidence through the real IPC and results dialog;
// does not launch Deadlock or modify the original capture.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { _electron } from 'playwright-core';

const source = process.argv[2];
assert.ok(source, 'Usage: node scripts/smoke-benchmark-results.mjs /path/to/session-directory');
const profile = await mkdtemp(join(tmpdir(), 'grimoire-results-ui-'));
const target = join(profile, 'benchmark', basename(source));
await mkdir(join(target, 'capture'), { recursive: true });
for (const file of ['result.json', 'configuration.json', 'run-ledger.json', 'capture/result.json', 'capture/frames.csv']) {
  await copyFile(join(source, file), join(target, file));
}
await writeFile(join(profile, 'settings.json'), JSON.stringify({
  hasCompletedSetup: true, language: 'en', experimentalBenchmark: true,
  autoCheckAppUpdates: false, experimentalSocial: false,
}));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const application = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${profile}`], env, timeout: 60000 });
const errors = [];
try {
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1280, height: 1000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Launch Benchmark', exact: true }).click({ timeout: 60000 });
  await page.getByRole('button', { name: 'View latest results', exact: true }).click();
  await page.getByRole('heading', { name: 'Benchmark results', exact: true }).waitFor();
  await page.getByRole('img', { name: 'FPS over time', exact: true }).waitFor();
  await page.getByRole('img', { name: 'Frame-time spikes', exact: true }).waitFor();
  const result = await page.evaluate(() => window.electronAPI.getBenchmarkResult());
  const capture = JSON.parse(await readFile(join(source, 'capture/result.json'), 'utf8'));
  assert.equal(result.metrics.averageFps, capture.diagnostic_metrics.average_fps);
  assert.equal(result.metrics.onePercentLowFps, capture.diagnostic_metrics.one_percent_low_fps);
  assert.equal(Math.max(...result.points.map(p => p.maximumFrameTimeMs)), capture.diagnostic_metrics.maximum_frame_time_ms);
  assert.equal(result.comparisonEligible, false);
  assert.ok(result.points.length <= 600);
  await page.waitForTimeout(300); // Let the launch dialog's exit animation finish.
  await page.screenshot({ path: join(profile, 'results.png') });
  await page.getByText('Hardware and recorded settings', { exact: true }).click();
  await page.screenshot({ path: join(profile, 'settings.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ profile, run: result.runId, points: result.points.length, screenshot: join(profile, 'results.png') }));
} finally { await application.close(); }
