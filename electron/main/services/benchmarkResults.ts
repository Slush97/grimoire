import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';
import type { BenchmarkChartPoint, BenchmarkResult } from '../../../src/types/benchmark';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.slice(0, 256) : null;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

// Only fixed files inside app-owned session directories, never renderer paths.
async function evidencePath(root: string, path: string, maxBytes: number): Promise<string> {
  const [base, file] = await Promise.all([realpath(root), realpath(path)]);
  const rel = relative(base, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Evidence outside benchmark directory');
  const info = await stat(file);
  if (!info.isFile() || info.size > maxBytes) throw new Error('Unsupported evidence file');
  return file;
}

async function json(root: string, path: string): Promise<Record<string, unknown>> {
  try { return object(JSON.parse(await readFile(await evidencePath(root, path, 4 * 1024 * 1024), 'utf8'))); }
  catch { return {}; }
}

function metrics(capture: Record<string, unknown>): BenchmarkResult['metrics'] {
  if (capture.status !== 'captured') return null;
  const m = object(capture.diagnostic_metrics);
  const fields = ['average_fps', 'one_percent_low_fps', 'p99_frame_time_ms', 'maximum_frame_time_ms', 'duration_seconds', 'frame_count'];
  if (!fields.every(key => positive(m[key])) || !Number.isInteger(m.frame_count)) return null;
  return { averageFps: m.average_fps as number, onePercentLowFps: m.one_percent_low_fps as number,
    p99FrameTimeMs: m.p99_frame_time_ms as number, maximumFrameTimeMs: m.maximum_frame_time_ms as number,
    durationSeconds: m.duration_seconds as number, frameCount: m.frame_count as number };
}

export async function readBenchmarkChart(root: string, path: string, duration: number): Promise<{ points: BenchmarkChartPoint[]; binSeconds: number }> {
  const file = await evidencePath(root, path, 64 * 1024 * 1024);
  const binSeconds = Math.max(1, duration / 600);
  const bins = new Map<number, { count: number; time: number; peak: number }>();
  const stream = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header = true;
  let start: number | null = null;
  let previous = -1;
  let count = 0;
  try {
    for await (const line of lines) {
      if (header) {
        if (line !== 'timestamp_seconds,frame_time_ms') throw new Error('Unknown frame format');
        header = false; continue;
      }
      if (!line.trim()) continue;
      const cells = line.split(',');
      const [seconds, ms] = cells.map(Number);
      if (cells.length !== 2 || cells.some(cell => !cell.trim()) || !Number.isFinite(seconds) || seconds < 0 || seconds <= previous || !positive(ms)) {
        throw new Error('Invalid frame data');
      }
      previous = seconds;
      if (++count > 2_000_000) throw new Error('Capture too large');
      // Capture diagnostics use the first event as the time boundary.
      if (start === null) { start = seconds; continue; }
      const elapsed = seconds - start;
      if (elapsed > duration + 1) throw new Error('Capture duration mismatch');
      const index = Math.min(599, Math.floor(elapsed / binSeconds));
      const bin = bins.get(index) ?? { count: 0, time: 0, peak: 0 };
      bin.count++; bin.time += ms; bin.peak = Math.max(bin.peak, ms); bins.set(index, bin);
    }
  } finally { lines.close(); stream.destroy(); }
  if (!bins.size) throw new Error('No frame intervals');
  return { binSeconds, points: [...bins].map(([index, bin]) => ({
    seconds: index * binSeconds, averageFps: 1000 * bin.count / bin.time, maximumFrameTimeMs: bin.peak,
  })) };
}

export async function readLatestBenchmarkResult(root: string, preferredSession?: string): Promise<BenchmarkResult | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const names = entries.filter(e => e.isDirectory() && /^session-[\d-]+$/.test(e.name)).map(e => e.name).sort();
  const session = preferredSession && names.includes(preferredSession) ? preferredSession : names.at(-1);
  if (!session) return null;
  const dir = join(root, session);
  const [result, captureFile, configuration, ledger] = await Promise.all([
    json(root, join(dir, 'result.json')), json(root, join(dir, 'capture/result.json')),
    json(root, join(dir, 'configuration.json')), json(root, join(dir, 'run-ledger.json')),
  ]);
  const capture = Object.keys(captureFile).length ? captureFile : object(result.capture);
  const measured = metrics(capture);
  let points: BenchmarkChartPoint[] = [];
  let binSeconds = 1;
  let chartUnavailable = false;
  if (measured) {
    try { ({ points, binSeconds } = await readBenchmarkChart(root, join(dir, 'capture/frames.csv'), measured.durationSeconds)); }
    catch { chartUnavailable = true; }
  }
  const hardware = object(capture.raw_system_metadata);
  const inventory = object(configuration.inventory);
  const settings = object(object(configuration.display).settings);
  const width = text(settings['setting.defaultres']);
  const height = text(settings['setting.defaultresheight']);
  const scale = Number(settings['setting.mat_viewportscale']);
  const outcome = ['completed', 'failed', 'stopped'].includes(String(result.status)) ? result.status as BenchmarkResult['outcome'] : 'unknown';
  return {
    session, runId: text(result.run_id), recordedAt: text(ledger.recorded_utc), outcome,
    captureStatus: measured ? 'captured' : capture.status === 'disabled' ? 'disabled' : Object.keys(capture).length ? 'failed' : 'missing',
    metrics: measured, scope: 'whole_capture', comparisonEligible: false, points, chartUnavailable, binSeconds,
    cpu: text(hardware.cpu) ?? text(inventory.cpu), gpu: text(hardware.gpu),
    os: [text(hardware.os) ?? text(inventory.os), text(hardware.kernel) ?? text(inventory.os_release)].filter(Boolean).join(' / ') || null,
    driver: text(hardware.driver), resolution: width && height ? `${width} × ${height}` : null,
    renderScale: positive(scale) ? `${Math.round(scale * 100)}%` : null,
    backend: text(capture.backend), metricVersion: text(capture.metric_version),
  };
}
