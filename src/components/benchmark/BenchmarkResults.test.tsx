// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BenchmarkLaunch from './BenchmarkLaunch';
import type { BenchmarkResult, BenchmarkStatus } from '../../types/benchmark';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('benchmark results flow', () => {
  let root: Root;
  let host: HTMLDivElement;
  let status: BenchmarkStatus;
  let result: BenchmarkResult;
  const getResult = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    status = { phase: 'idle', active: false, repetition: 0, completed: 0, repetitions: 3, logs: null,
      error: null, missing: [], scoreEligible: false };
    result = { session: 'session-20261108-010000', runId: 'run-id', recordedAt: null, outcome: 'completed',
      captureStatus: 'captured', metrics: { averageFps: 250, onePercentLowFps: 60, p99FrameTimeMs: 8,
        maximumFrameTimeMs: 1000, durationSeconds: 184, frameCount: 45000 }, scope: 'whole_capture',
      comparisonEligible: false, points: [{ seconds: 0, averageFps: 120, maximumFrameTimeMs: 1000 },
        { seconds: 1, averageFps: 250, maximumFrameTimeMs: 8 }], chartUnavailable: false, binSeconds: 1,
      cpu: 'Test CPU', gpu: 'Test GPU', os: 'Test OS', driver: null, resolution: '2560 × 1440', renderScale: '75%',
      backend: 'mangohud', metricVersion: '1.1' };
    getResult.mockReset().mockImplementation(async () => result);
    window.electronAPI = { getBenchmarkStatus: async () => status, getBenchmarkResult: getResult,
      openBenchmarkLogs: async () => {} } as unknown as Window['electronAPI'];
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
  async function render() { await act(async () => root.render(<BenchmarkLaunch collapsed={false} gameRunning={false} />)); }
  async function click(key: string) {
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === key)!.click());
  }

  it('automatically opens saved graphs only after the supervisor exits', async () => {
    status = { ...status, phase: 'running', active: true }; await render();
    status = { ...status, phase: 'completed' };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(getResult).not.toHaveBeenCalled();
    status = { ...status, active: false };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(getResult).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('svg[role="img"]')).toHaveLength(2);
    expect(document.body.textContent).toContain('benchmark.results.scope');
    expect(document.body.textContent).toContain('Test CPU');
  });

  it('reopens the latest capture after app restart without requiring an active session', async () => {
    await render();
    expect(getResult).not.toHaveBeenCalled();
    await click('benchmark.launch'); await click('benchmark.results.open');
    expect(getResult).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('svg[role="img"]')).toHaveLength(2);
  });

  it('explains disabled recording instead of showing a zero score or empty graph', async () => {
    result = { ...result, metrics: null, points: [], captureStatus: 'disabled' };
    await render(); await click('benchmark.launch'); await click('benchmark.results.open');
    expect(document.body.textContent).toContain('benchmark.results.captureDisabled');
    expect(document.querySelectorAll('svg[role="img"]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('benchmark.results.low');
  });

  it('handles an IPC error and retries when the results are reopened', async () => {
    getResult.mockRejectedValueOnce(new Error('read failed'));
    await render(); await click('benchmark.launch'); await click('benchmark.results.open');
    expect(document.body.textContent).toContain('benchmark.results.error');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await click('benchmark.launch'); await click('benchmark.results.open');
    expect(document.querySelectorAll('svg[role="img"]')).toHaveLength(2);
  });
});
