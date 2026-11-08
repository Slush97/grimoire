// Manual integration check: build first, then pass an isolated Deadlock copy.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';

const game = process.argv[2];
assert.ok(game, 'Usage: node scripts/smoke-benchmark.mjs /path/to/isolated/Deadlock');
const profile = await mkdtemp(join(tmpdir(), 'grimoire-benchmark-ui-'));
await writeFile(join(profile, 'settings.json'), JSON.stringify({
  deadlockPath: resolve(game), hasCompletedSetup: true, autoCheckAppUpdates: false,
  language: 'en', experimentalBenchmark: true,
}));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${profile}`], env, timeout: 60000 });
const errors = [];
application.on('window', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const window = await application.firstWindow();
  await window.getByRole('button', { name: 'Launch Benchmark', exact: true }).click({ timeout: 60000 });
  const run = window.getByRole('button', { name: 'Run benchmark', exact: true });
  await run.waitFor({ state: 'visible' });
  assert.equal(await run.isEnabled(), true, 'All local prerequisites must be available');
  await window.getByRole('combobox', { name: 'Resolution', exact: true }).selectOption(process.env.BENCHMARK_TEST_RESOLUTION ?? 'game');
  await window.screenshot({ path: join(profile, 'ready.png') });
  await run.click();
  console.log('Started benchmark through the Grimoire button', profile);
  let previous = '';
  const deadline = Date.now() + 540000;
  let status;
  while (Date.now() < deadline) {
    status = await window.evaluate(() => window.electronAPI.getBenchmarkStatus());
    if (status.phase !== previous) {
      console.log(status.phase, status.repetition, status.completed, status.logs, status.error);
      previous = status.phase;
      await window.screenshot({ path: join(profile, `${status.phase}.png`) });
    }
    if (!status.active && ['completed', 'failed', 'stopped'].includes(status.phase)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(status?.phase, 'completed');
  assert.equal(status.completed, 3);
  assert.equal(status.scoreEligible, false);
  assert.deepEqual(errors, []);
  console.log('PASS: automatic spectator entry, warm-up, three passes and process cleanup');
  if (process.env.BENCHMARK_TEST_CAPTURE === '1') {
    const result = JSON.parse(await readFile(join(status.logs, 'result.json'), 'utf8'));
    assert.equal(result.capture.status, 'captured', JSON.stringify(result.capture));
    assert.ok(result.capture.frame_count > 100);
    assert.ok(result.capture.diagnostic_metrics.average_fps > 0);
    assert.equal(result.capture.measurement_valid, false);
    const ledger = JSON.parse(await readFile(join(status.logs, 'run-ledger.json'), 'utf8'));
    assert.equal(ledger.result.outcome, 'completed');
    assert.equal(ledger.result.comparison_eligible, false);
    assert.equal(ledger.events.filter(event => event.kind === 'scenario_marker' && event.payload.line.includes('BENCH END')).length, 3);
    console.log('PASS: actual frame capture, diagnostic metrics and ledger:', result.run_id, result.capture.frame_count, 'frames');
  }
  await writeFile(join(profile, 'smoke-result.json'), JSON.stringify(status, null, 2));
  if (process.env.BENCHMARK_TEST_CANCEL === '1') {
    await window.getByRole('button', { name: 'Run benchmark', exact: true }).click();
    const stop = window.getByRole('button', { name: 'Stop benchmark', exact: true });
    await stop.waitFor({ state: 'visible' });
    await stop.click();
    for (let i = 0; i < 30; i++) {
      status = await window.evaluate(() => window.electronAPI.getBenchmarkStatus());
      if (!status.active) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(status.active, false);
    assert.equal(status.phase, 'stopped');
    console.log('PASS: cancellation cleans up the supervised processes');
  }
} finally {
  await application.close();
}
