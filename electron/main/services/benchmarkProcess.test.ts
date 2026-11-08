import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { BenchmarkProcess } from './benchmarkProcess';

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true; }),
  });
  const start = vi.fn(() => child as unknown as ChildProcess);
  return { child, start, session: new BenchmarkProcess(start as unknown as typeof spawn) };
}

describe('supervised benchmark', () => {
  it('passes arguments without a shell and rejects concurrent launches', () => {
    const { session, start } = fixture();
    session.start('/usr/bin/python3', ['/home/a path/play_lab.py', '--demo']);
    expect(start).toHaveBeenCalledWith('/usr/bin/python3', ['/home/a path/play_lab.py', '--demo'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }));
    expect(() => session.start('other', [])).toThrow('already running');
  });
  it('parses split progress and only completes after an explicit completion event', () => {
    const { session, child } = fixture();
    session.start('python3', []);
    child.stdout.write('BENCHMARK_EV');
    child.stdout.write('ENT {"phase":"running","repetition":2,"completed":1}\n');
    expect(session.status.repetition).toBe(2);
    expect(session.status.completed).toBe(1);
    child.stdout.write('BENCHMARK_EVENT invalid\nBENCHMARK_EVENT {"phase":"completed"}\n');
    child.emit('close', 0);
    expect(session.status).toMatchObject({ phase: 'completed', active: false, scoreEligible: false });
  });
  it('does not turn exit zero or malformed progress into a benchmark pass', () => {
    const { session, child } = fixture();
    session.start('python3', []);
    child.stdout.write('BENCHMARK_EVENT {"phase":"success","scoreEligible":true}\n');
    child.emit('close', 0);
    expect(session.status).toMatchObject({ phase: 'failed', active: false, scoreEligible: false });
  });
  it('stops only its owned supervisor and waits for cleanup', async () => {
    const { session, child } = fixture();
    session.start('python3', []);
    await session.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(session.status).toMatchObject({ phase: 'stopped', active: false });
  });
  it('retains the actionable failure and log location', () => {
    const { session, child } = fixture();
    session.start('python3', []);
    child.stdout.write('BENCHMARK_EVENT {"phase":"failed","error":"restore failed","logs":"/test/session-1"}\n');
    child.emit('close', 1);
    expect(session.status).toMatchObject({ phase: 'failed', error: 'restore failed', logs: '/test/session-1' });
  });
});
