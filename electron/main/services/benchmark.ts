import { app, shell } from 'electron';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getUserDataPath } from '../utils/paths';
import { getActiveDeadlockPath, loadSettings } from './settings';
import { isDeadlockRunning } from './launch';
import { BenchmarkProcess } from './benchmarkProcess';
import { readLatestBenchmarkResult } from './benchmarkResults';
import type { BenchmarkRequirement, BenchmarkResolution, BenchmarkStatus } from '../../../src/types/benchmark';

const session = new BenchmarkProcess();
let launching = false;
let launchGeneration = 0;

function executable(name: string): string | undefined {
  return (process.env.PATH ?? '').split(delimiter).map(dir => join(dir, name)).find(existsSync);
}

function prerequisites() {
  const home = homedir();
  const resources = app.isPackaged ? join(process.resourcesPath, 'benchmark') : join(app.getAppPath(), 'resources/benchmark');
  const game = getActiveDeadlockPath();
  const steam = [join(home, '.local/share/Steam'), join(home, '.steam/steam')].find(existsSync);
  const modlock = [join(home, '.local/bin/modlock'), executable('modlock')].find(p => p && existsSync(p));
  const host = join(home, '.cache/modlock/host/v0.1.17/modlock-host.exe');
  const proton = [join(home, '.cache/modlock/escort-proton/proton'),
    ...(steam ? [join(steam, 'steamapps/common/Proton - Experimental/proton')] : [])].find(existsSync);
  const python = executable('python3');
  const missing: BenchmarkRequirement[] = [];
  if (process.platform !== 'linux') missing.push('platform');
  if (!game || !existsSync(join(game, 'game/citadel/steam.inf'))) missing.push('game');
  if (!python) missing.push('python');
  if (!executable('rsync')) missing.push('rsync');
  if (!modlock) missing.push('modlock');
  if (!existsSync(host)) missing.push('host');
  if (!proton) missing.push('proton');
  if (!steam) missing.push('steam');
  if (['play_lab.py', 'benchmark_recording.py', 'benchmark_capture.py', 'benchmark_ledger.py', 'benchmark_metrics.py',
    'scenario/data/clip.json'].some(file => !existsSync(join(resources, file)))) missing.push('resources');
  else if (game && !missing.includes('game')) {
    try {
      const clip = JSON.parse(readFileSync(join(resources, 'scenario/data/clip.json'), 'utf8')) as { source?: { game?: string } };
      const expected = clip.source?.game?.match(/citadel_v(\d+)/)?.[1];
      const installed = readFileSync(join(game, 'game/citadel/steam.inf'), 'utf8').match(/^ClientVersion=(\d+)/m)?.[1];
      if (!expected || expected !== installed) missing.push('build');
    } catch { missing.push('resources'); }
  }
  return { resources, game, steam, modlock, host, proton, python, missing };
}

export function getBenchmarkStatus(): BenchmarkStatus {
  const recovery = !session.status.active && existsSync(join(getUserDataPath(), 'benchmark/active.json'));
  return { ...session.status, ...(recovery ? { phase: 'failed' as const, error: 'A previous benchmark session needs cleanup. Use Stop.' } : {}),
    active: session.status.active || launching || recovery, missing: prerequisites().missing };
}

export async function launchBenchmark(resolution: BenchmarkResolution = 'game'): Promise<BenchmarkStatus> {
  if (!['game', '1280x720', '1920x1080', '2560x1440'].includes(resolution)) throw new Error('Unsupported benchmark resolution');
  if (!loadSettings().experimentalBenchmark) throw new Error('Enable the experimental benchmark in Settings first');
  if (launching || session.status.active) throw new Error('A benchmark is already running');
  launching = true;
  const generation = ++launchGeneration;
  try {
    const p = prerequisites();
    if (p.missing.length || !p.game || !p.python || !p.modlock || !p.proton || !p.steam) {
      throw new Error(`Missing benchmark requirements: ${p.missing.join(', ')}`);
    }
    const { stdout: version } = await promisify(execFile)(p.modlock, ['--version'], { timeout: 10_000 });
    if (!/^modlock version v0\.1\.17\s*$/.test(version.trim())) {
      throw new Error('This benchmark fixture requires Modlock CLI 0.1.17 to match its pinned host');
    }
    if (generation !== launchGeneration) return getBenchmarkStatus();
    if (await isDeadlockRunning()) throw new Error('Close Deadlock before running the benchmark');
    if (generation !== launchGeneration) return getBenchmarkStatus();
    const state = join(getUserDataPath(), 'benchmark');
    if (existsSync(join(state, 'active.json'))) throw new Error('A previous benchmark session needs cleanup. Use Stop before launching again.');
    const build = createHash('sha256').update(readFileSync(join(p.game, 'game/citadel/steam.inf'))).update(p.game).digest('hex').slice(0, 16);
    session.start(p.python, [join(p.resources, 'play_lab.py'), 'start', '--supervise', '--demo',
      '--game', join(state, `game-${build}`), '--retail', p.game, '--scenario', join(p.resources, 'scenario'),
      '--state-dir', state, '--ui-port', '0', '--resolution', resolution,
      '--capture', 'auto', '--suite', 'night-shift-development', '--label', 'Grimoire teamfight capture',
      '--modlock', p.modlock, '--host', p.host, '--proton', p.proton, '--steam', p.steam]);
    return getBenchmarkStatus();
  } finally { launching = false; }
}

export async function stopBenchmark(): Promise<BenchmarkStatus> {
  launchGeneration++;
  if (launching && !session.status.active) session.status.phase = 'stopped';
  await session.stop();
  const p = prerequisites();
  const state = join(getUserDataPath(), 'benchmark');
  if (existsSync(join(state, 'active.json'))) {
    if (!p.python) throw new Error('Python is needed to clean up the previous benchmark');
    await promisify(execFile)(p.python, [join(p.resources, 'play_lab.py'), 'stop', '--state-dir', state], { timeout: 20_000 });
  }
  return getBenchmarkStatus();
}

export async function openBenchmarkLogs(): Promise<void> {
  // No renderer-supplied paths. Only folders created under our benchmark root.
  const root = join(getUserDataPath(), 'benchmark');
  const last = existsSync(root) ? readdirSync(root).filter(n => /^session-[\d-]+$/.test(n)).sort().at(-1) : undefined;
  if (last) await shell.openPath(join(root, last));
}

export async function getBenchmarkResult() {
  if (session.status.active || launching) return null;
  return readLatestBenchmarkResult(join(getUserDataPath(), 'benchmark'), session.status.logs ? basename(session.status.logs) : undefined);
}
