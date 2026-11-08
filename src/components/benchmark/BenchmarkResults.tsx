import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, ModalHeader } from '../common/ui';
import { Modal, ModalBody } from '../common/Modal';
import type { BenchmarkChartPoint, BenchmarkResult } from '../../types/benchmark';

function Timeline({ points, field, title, unit }: {
  points: BenchmarkChartPoint[]; field: 'averageFps' | 'maximumFrameTimeMs'; title: string; unit: string;
}) {
  const { t } = useTranslation();
  const width = 720, height = 180, left = 60, bottom = 150;
  const maxX = Math.max(1, ...points.map(p => p.seconds));
  const maxY = Math.max(1, ...points.map(p => p[field]));
  const coords = points.map(p => `${left + p.seconds / maxX * (width - left - 16)},${bottom - p[field] / maxY * (bottom - 16)}`).join(' ');
  return <figure className="space-y-2 rounded-sm border border-border p-4">
    <figcaption className="text-sm text-text-primary">{title}</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="w-full text-text-tertiary">
      <title>{title}</title>
      {[0, .5, 1].map(fraction => <g key={fraction}>
        <line x1={left} x2={width - 16} y1={bottom - fraction * (bottom - 16)} y2={bottom - fraction * (bottom - 16)} stroke="currentColor" strokeOpacity="0.2" />
        <text x={left - 8} y={bottom - fraction * (bottom - 16) + 4} textAnchor="end" fill="currentColor" className="text-xs tabular-nums">{(fraction * maxY).toLocaleString(undefined, { maximumFractionDigits: 1 })}</text>
      </g>)}
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-primary" />
      <text x={left} y={height - 6} fill="currentColor" className="text-xs">{t('benchmark.results.seconds', { count: 0 })}</text>
      <text x={width - 16} y={height - 6} textAnchor="end" fill="currentColor" className="text-xs">{t('benchmark.results.seconds', { count: Math.round(maxX) })}</text>
    </svg>
    <p className="text-xs text-text-tertiary">{unit}</p>
  </figure>;
}

export default function BenchmarkResults({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void window.electronAPI.getBenchmarkResult().then(value => {
      if (alive) { setResult(value); setError(false); setLoading(false); }
    }).catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [open]);
  const close = () => { onClose(); setLoading(true); };
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const unavailable = t('benchmark.results.unknown');
  const outcomes = {
    completed: t('benchmark.phase.completed'), failed: t('benchmark.phase.failed'),
    stopped: t('benchmark.phase.stopped'), unknown: t('benchmark.results.incomplete'),
  };
  return <Modal open={open} onClose={close} size="xl" labelledBy="benchmark-results-title">
    <ModalHeader title={t('benchmark.results.title')} titleId="benchmark-results-title" onClose={close} />
    <ModalBody className="space-y-4">
      {loading ? <p role="status">{t('benchmark.results.loading')}</p> : error ? <p role="alert" className="text-state-danger">{t('benchmark.results.error')}</p> : !result ? <p>{t('benchmark.results.empty')}</p> : <>
        <div className="space-y-1">
          <p className="text-sm text-text-primary">{outcomes[result.outcome]}</p>
          <p className="text-xs text-text-secondary">{result.recordedAt && !Number.isNaN(Date.parse(result.recordedAt)) ? new Date(result.recordedAt).toLocaleString() : result.session}</p>
        </div>
        <p className="rounded-sm border border-border bg-bg-tertiary p-4 text-sm text-text-secondary">{t('benchmark.results.scope')}</p>
        {result.metrics ? <>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            {[
              [t('benchmark.results.average'), t('benchmark.results.fps', { value: format(result.metrics.averageFps) })],
              [t('benchmark.results.low'), t('benchmark.results.fps', { value: format(result.metrics.onePercentLowFps) })],
              [t('benchmark.results.p99'), t('benchmark.results.ms', { value: format(result.metrics.p99FrameTimeMs) })],
              [t('benchmark.results.worst'), t('benchmark.results.ms', { value: format(result.metrics.maximumFrameTimeMs) })],
              [t('benchmark.results.duration'), t('benchmark.results.seconds', { count: Math.round(result.metrics.durationSeconds) })],
              [t('benchmark.results.frames'), result.metrics.frameCount.toLocaleString()],
            ].map(([label, value]) => <div key={label}><dt className="text-text-secondary">{label}</dt><dd className="tabular-nums text-text-primary">{value}</dd></div>)}
          </dl>
          {result.points.length > 0 && <div className="space-y-4">
            <Timeline points={result.points} field="averageFps" title={t('benchmark.results.fpsChart')} unit={t('benchmark.results.fpsChartHint', { seconds: format(result.binSeconds) })} />
            <Timeline points={result.points} field="maximumFrameTimeMs" title={t('benchmark.results.frameChart')} unit={t('benchmark.results.frameChartHint', { seconds: format(result.binSeconds) })} />
          </div>}
          {result.chartUnavailable && <p role="status" className="text-sm text-text-secondary">{t('benchmark.results.chartUnavailable')}</p>}
        </> : <p role="status" className="text-sm text-text-secondary">{result.captureStatus === 'disabled' ? t('benchmark.results.captureDisabled') : result.captureStatus === 'failed' ? t('benchmark.results.captureFailed') : t('benchmark.results.captureMissing')}</p>}
        <details className="rounded-sm border border-border p-4 text-sm">
          <summary className="cursor-pointer text-text-primary">{t('benchmark.results.details')}</summary>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              [t('benchmark.results.cpu'), result.cpu], [t('benchmark.results.gpu'), result.gpu],
              [t('benchmark.results.os'), result.os], [t('benchmark.results.driver'), result.driver],
              [t('benchmark.results.configuredResolution'), result.resolution], [t('benchmark.results.renderScale'), result.renderScale],
              [t('benchmark.results.recorder'), result.backend], [t('benchmark.results.metricVersion'), result.metricVersion],
            ].map(([label, value]) => <div key={label}><dt className="text-text-secondary">{label}</dt><dd className="break-words text-text-primary">{value ?? unavailable}</dd></div>)}
          </dl>
        </details>
        <Button variant="secondary" icon={FolderOpen} onClick={() => { void window.electronAPI.openBenchmarkLogs().catch(() => setError(true)); }}>{t('benchmark.logs')}</Button>
      </>}
    </ModalBody>
  </Modal>;
}
