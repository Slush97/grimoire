import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLatestBenchmarkResult } from './benchmarkResults';

describe('saved benchmark results', () => {
  let root: string;
  const session = 'session-20261108-010000-123456';
  const capture = { status: 'captured', backend: 'mangohud', metric_version: '1.1',
    raw_system_metadata: { cpu: 'CPU', gpu: 'GPU', os: 'Linux', kernel: 'kernel', driver: '' },
    diagnostic_metrics: { average_fps: 100, one_percent_low_fps: 50, p99_frame_time_ms: 20,
      maximum_frame_time_ms: 100, duration_seconds: 3, frame_count: 300 } };
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'benchmark-results-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  async function save(name: string, contents: unknown) {
    await mkdir(join(root, session, 'capture'), { recursive: true });
    await writeFile(join(root, session, name), typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  async function fixture() {
    await save('result.json', { status: 'completed', run_id: 'run-id' });
    await save('capture/result.json', capture);
    await save('run-ledger.json', { recorded_utc: '2026-11-08T01:00:00Z' });
    await save('configuration.json', { display: { settings: { 'setting.defaultres': '2560', 'setting.defaultresheight': '1440', 'setting.mat_viewportscale': '.75' } } });
    await save('capture/frames.csv', 'timestamp_seconds,frame_time_ms\n0,999\n0.01,10\n0.11,100\n1.2,20\n2.5,10\n');
  }

  it('shows retained whole-capture metrics and settings without promoting validity', async () => {
    await fixture();
    const r = await readLatestBenchmarkResult(root);
    expect(r).toMatchObject({ session, runId: 'run-id', captureStatus: 'captured', scope: 'whole_capture',
      comparisonEligible: false, resolution: '2560 × 1440', renderScale: '75%', driver: null,
      metrics: { averageFps: 100, frameCount: 300 }, chartUnavailable: false });
    expect(r!.points).toHaveLength(3);
    expect(r!.points[0].maximumFrameTimeMs).toBe(100); // preserve peak, exclude first boundary event
    expect(r!.points[0].averageFps).toBeCloseTo(2000 / 110);
  });

  it('bounds chart output without dropping the worst frame', async () => {
    await fixture();
    await save('capture/result.json', { ...capture, diagnostic_metrics: { ...capture.diagnostic_metrics, duration_seconds: 1200 } });
    const lines = Array.from({ length: 12001 }, (_, i) => `${i / 10},${i === 7234 ? 800 : 100}`);
    await save('capture/frames.csv', 'timestamp_seconds,frame_time_ms\n' + lines.join('\n'));
    const r = await readLatestBenchmarkResult(root);
    expect(r!.points.length).toBeLessThanOrEqual(600);
    expect(Math.max(...r!.points.map(p => p.maximumFrameTimeMs))).toBe(800);
  });

  it('retains failures and does not substitute an older successful run', async () => {
    await fixture();
    const newer = join(root, 'session-20261108-020000-123456'); await mkdir(newer);
    await writeFile(join(newer, 'result.json'), JSON.stringify({ status: 'failed' }));
    const r = await readLatestBenchmarkResult(root);
    expect(r).toMatchObject({ outcome: 'failed', captureStatus: 'missing', metrics: null, points: [] });
  });

  it('distinguishes disabled capture, absent history and malformed metrics', async () => {
    expect(await readLatestBenchmarkResult(root)).toBeNull();
    await save('capture/result.json', { status: 'disabled' });
    expect((await readLatestBenchmarkResult(root))!.captureStatus).toBe('disabled');
    await save('capture/result.json', { ...capture, diagnostic_metrics: { ...capture.diagnostic_metrics, average_fps: null } });
    expect((await readLatestBenchmarkResult(root))!.metrics).toBeNull();
  });

  it('keeps the summary when frames are malformed or missing', async () => {
    await fixture();
    await save('capture/frames.csv', 'timestamp_seconds,frame_time_ms\n0,10\n0,10\n');
    expect(await readLatestBenchmarkResult(root)).toMatchObject({ chartUnavailable: true, points: [], metrics: { averageFps: 100 } });
    await rm(join(root, session, 'capture/frames.csv'));
    expect((await readLatestBenchmarkResult(root))!.chartUnavailable).toBe(true);
  });

  it('does not follow evidence symlinks outside the benchmark root', async () => {
    await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'benchmark-outside-'));
    try {
      await writeFile(join(outside, 'frames.csv'), 'timestamp_seconds,frame_time_ms\n0,10\n1,10\n');
      await rm(join(root, session, 'capture/frames.csv'));
      await symlink(join(outside, 'frames.csv'), join(root, session, 'capture/frames.csv'));
      expect((await readLatestBenchmarkResult(root))!.chartUnavailable).toBe(true);
      expect((await readLatestBenchmarkResult(root, '../../outside'))!.session).toBe(session);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
