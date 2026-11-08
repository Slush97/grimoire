import { spawn, type ChildProcess } from 'node:child_process';
import type { BenchmarkStatus } from '../../../src/types/benchmark';

export const initialBenchmarkStatus = (): BenchmarkStatus => ({
  phase: 'idle', active: false, repetition: 0, completed: 0, repetitions: 3,
  logs: null, error: null, missing: [], scoreEligible: false,
});

/** Only the supervised child owns a benchmark, never an arbitrary game PID. */
export class BenchmarkProcess {
  status = initialBenchmarkStatus();
  private child: ChildProcess | null = null;
  private stopping = false;
  private pending = '';
  private diagnostics = '';
  private settled: Promise<void> = Promise.resolve();

  private readonly spawnChild: typeof spawn;
  constructor(spawnChild: typeof spawn = spawn) { this.spawnChild = spawnChild; }

  start(command: string, args: string[]): void {
    if (this.child) throw new Error('A benchmark is already running');
    this.status = { ...initialBenchmarkStatus(), phase: 'preparing', active: true };
    this.pending = '';
    this.diagnostics = '';
    this.stopping = false;
    const child = this.spawnChild(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.settled = new Promise(resolve => {
      const finish = (error?: Error) => {
        if (this.child !== child) return;
        this.child = null;
        if (this.stopping) this.status.phase = 'stopped';
        else if (error || this.status.phase !== 'completed') {
          this.status.phase = 'failed';
          this.status.error ??= this.diagnostics.trim() || error?.message || 'Benchmark ended before all passes completed';
        }
        this.status.active = false;
        resolve();
      };
      child.once('error', error => finish(error));
      child.once('close', code => finish(code && !this.stopping ? new Error(`Benchmark exited with code ${code}`) : undefined));
      child.stdout?.on('data', chunk => this.receive(String(chunk)));
      child.stderr?.on('data', chunk => { this.diagnostics = (this.diagnostics + String(chunk)).slice(-8000); });
    });
  }

  private receive(chunk: string): void {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = (lines.pop() ?? '').slice(-65536);
    for (const line of lines) {
      if (!line.startsWith('BENCHMARK_EVENT ')) continue;
      try {
        const value: unknown = JSON.parse(line.slice(16));
        if (!value || typeof value !== 'object') continue;
        const event = value as Record<string, unknown>;
        if (!['starting_server', 'starting_client', 'warmup', 'running', 'completed', 'failed', 'stopped'].includes(String(event.phase))) continue;
        this.status.phase = event.phase as BenchmarkStatus['phase'];
        if (typeof event.logs === 'string') this.status.logs = event.logs;
        if (typeof event.error === 'string') this.status.error = event.error;
        for (const key of ['repetition', 'completed', 'repetitions'] as const) {
          const count = event[key];
          if (typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 10) this.status[key] = count;
        }
      } catch { /* Ignore malformed progress, never treat it as completion. */ }
    }
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.stopping = true;
    this.child.kill('SIGTERM');
    const timeout = setTimeout(() => this.child?.kill('SIGKILL'), 15_000);
    try { await this.settled; } finally { clearTimeout(timeout); }
  }
}
