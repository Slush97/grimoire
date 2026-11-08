export type BenchmarkPhase = 'idle' | 'preparing' | 'starting_server' | 'starting_client' | 'warmup' | 'running' | 'completed' | 'failed' | 'stopped';
export type BenchmarkRequirement = 'platform' | 'game' | 'build' | 'python' | 'rsync' | 'modlock' | 'host' | 'proton' | 'steam' | 'resources';
export type BenchmarkResolution = 'game' | '1280x720' | '1920x1080' | '2560x1440';
export interface BenchmarkStatus {
  phase: BenchmarkPhase;
  active: boolean;
  repetition: number;
  completed: number;
  repetitions: number;
  logs: string | null;
  error: string | null;
  missing: BenchmarkRequirement[];
  scoreEligible: false;
}

export interface BenchmarkChartPoint {
  seconds: number;
  averageFps: number;
  maximumFrameTimeMs: number;
}

export interface BenchmarkResult {
  session: string;
  runId: string | null;
  recordedAt: string | null;
  outcome: 'completed' | 'failed' | 'stopped' | 'unknown';
  captureStatus: 'captured' | 'disabled' | 'failed' | 'missing';
  metrics: {
    averageFps: number;
    onePercentLowFps: number;
    p99FrameTimeMs: number;
    maximumFrameTimeMs: number;
    durationSeconds: number;
    frameCount: number;
  } | null;
  scope: 'whole_capture';
  comparisonEligible: false;
  points: BenchmarkChartPoint[];
  chartUnavailable: boolean;
  binSeconds: number;
  cpu: string | null;
  gpu: string | null;
  os: string | null;
  driver: string | null;
  resolution: string | null;
  renderScale: string | null;
  backend: string | null;
  metricVersion: string | null;
}
