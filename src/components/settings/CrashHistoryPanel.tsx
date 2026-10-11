import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ModalHeader } from '../common/ui';
import { Modal } from '../common/Modal';
import { formatBytes } from '../../lib/formatBytes';
import type { CrashReportDetail, CrashReportSummary } from '../../types/crashHistory';

export default function CrashHistoryPanel({ selectedIds, onToggle }: { selectedIds: string[]; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  const [reports, setReports] = useState<CrashReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrashReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const request = useRef(0);
  const detailRequest = useRef(0);

  const load = useCallback(async (offset: number) => {
    const ticket = ++request.current;
    setLoading(true); setError(null);
    try {
      const result = await window.electronAPI.diagnostics.listCrashes(offset);
      if (ticket !== request.current) return;
      setReports(previous => offset ? [...previous, ...result.reports.filter(item => !previous.some(old => old.id === item.id))] : result.reports);
      setTotal(result.total);
    } catch (err) {
      if (ticket === request.current) setError(String(err));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const listRequests = request;
    const detailRequests = detailRequest;
    void load(0);
    const focus = () => { void load(0); };
    window.addEventListener('focus', focus);
    return () => { listRequests.current++; detailRequests.current++; window.removeEventListener('focus', focus); };
  }, [load]);

  const close = () => { detailRequest.current++; setDetail(null); setDetailLoading(false); setDetailError(null); setActionBusy(false); };
  const open = async (id: string) => {
    const ticket = ++detailRequest.current;
    setDetail(null); setDetailLoading(true); setDetailError(null); setSaved(false); setActionBusy(false);
    try {
      const result = await window.electronAPI.diagnostics.crashDetail(id);
      if (ticket === detailRequest.current) setDetail(result);
    } catch (err) {
      if (ticket === detailRequest.current) setDetailError(String(err));
    } finally {
      if (ticket === detailRequest.current) setDetailLoading(false);
    }
  };
  const action = async (kind: 'reveal' | 'save') => {
    if (!detail) return;
    const ticket = detailRequest.current;
    setActionBusy(true); setDetailError(null);
    try {
      if (kind === 'reveal') await window.electronAPI.diagnostics.revealCrash(detail.id);
      else if (await window.electronAPI.diagnostics.saveCrashDump(detail.id) && ticket === detailRequest.current) setSaved(true);
    } catch (err) { if (ticket === detailRequest.current) setDetailError(String(err)); }
    finally { if (ticket === detailRequest.current) setActionBusy(false); }
  };

  const kindLabel = (report: CrashReportSummary): string => {
    const labels: Record<CrashReportSummary['kind'], string> = {
      'resource-error': t('crashHistory.resourceError'), 'fatal-error': t('crashHistory.fatalError'),
      'access-violation': t('crashHistory.accessViolation'), exception: t('crashHistory.exception'),
      unknown: t('crashHistory.unknown'), unreadable: t('crashHistory.unreadable'),
    };
    return report.error ?? `${labels[report.kind]}${report.exceptionCode ? ` (${report.exceptionCode})` : ''}`;
  };

  return <section aria-labelledby="crash-history-title" className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 id="crash-history-title" className="text-sm font-medium text-text-primary">{t('crashHistory.title')}</h4>
        <p className="mt-1 text-xs text-text-secondary">{t('crashHistory.description')}</p>
      </div>
      <Button size="sm" variant="ghost" isLoading={loading} onClick={() => void load(0)}>{t('crashHistory.refresh')}</Button>
    </div>
    {error && <p role="status" className="break-words text-xs text-state-danger">{t('crashHistory.failed', { error })}</p>}
    {!loading && !error && !reports.length && <p className="text-sm text-text-secondary">{t('crashHistory.empty')}</p>}
    {!!reports.length && <div className="max-h-96 overflow-y-auto rounded-sm border border-border">
      {reports.map(report => <div key={report.id} className="flex items-start gap-3 border-b border-border p-3 last:border-b-0">
        <input type="checkbox" checked={selectedIds.includes(report.id)}
          disabled={!selectedIds.includes(report.id) && selectedIds.length >= 10}
          onChange={() => onToggle(report.id)}
          aria-label={t('crashHistory.include', { date: new Date(report.crashedAt).toLocaleString() })}
          className="mt-1 h-4 w-4 shrink-0 accent-accent" />
        <button type="button" onClick={() => void open(report.id)}
          className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-accent">
          <span className="block text-xs text-text-secondary">{new Date(report.crashedAt).toLocaleString()}</span>
          <span className="mt-1 block break-words text-sm text-text-primary">{kindLabel(report)}</span>
          {report.suspectedMod && <span className="mt-1 block break-words text-xs text-state-warning">{t('crashHistory.suspect', { name: report.suspectedMod })}</span>}
          {report.copies > 1 && <span className="mt-1 block text-xs text-text-secondary">{t('crashHistory.copies', { count: report.copies })}</span>}
        </button>
      </div>)}
    </div>}
    {!!total && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
      <span>{t('crashHistory.showing', { count: reports.length, total })}</span>
      {reports.length < total && <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load(reports.length)}>{t('crashHistory.more')}</Button>}
    </div>}
    <p className="text-xs text-text-secondary">{t('crashHistory.selection', { count: selectedIds.length })}</p>
    <Modal open={!!detail || detailLoading || !!detailError} onClose={close} size="lg" labelledBy="crash-history-detail-title">
      <ModalHeader titleId="crash-history-detail-title" title={t('crashHistory.details')} onClose={close} />
      <div className="space-y-4 p-4">
        {detailLoading && <p className="text-sm text-text-secondary">{t('crashHistory.loading')}</p>}
        {detailError && <p role="status" className="break-words text-sm text-state-danger">{t('crashHistory.failed', { error: detailError })}</p>}
        {detail && <>
          <p className="break-words text-sm text-text-primary">{kindLabel(detail)}</p>
          <p className="text-xs text-text-secondary">{new Date(detail.crashedAt).toLocaleString()}{detail.gameBuild ? ` · ${t('crashHistory.build', { build: detail.gameBuild })}` : ''}</p>
          {detail.suspectedMod && <p className="break-words text-sm text-state-warning">{t('crashHistory.suspect', { name: detail.suspectedMod })}</p>}
          {detail.attribution === 'last-known' && <p className="text-xs text-text-secondary">{t('crashAdvisory.lastKnown')}</p>}
          <div className="space-y-1 text-xs text-text-secondary">
            {detail.files.map(file => <div key={`${file.source}/${file.name}`} className="break-all">
              {file.source === 'steam' ? t('crashHistory.steam') : t('crashHistory.game')} · {file.name} · {formatBytes(file.size)}
            </div>)}
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border p-3 font-mono text-xs text-text-secondary">{detail.diagnostics || t('crashHistory.noComments')}</pre>
          <p className="text-xs text-text-secondary">{t('crashHistory.rawDump')}</p>
          {saved && <p role="status" className="text-xs text-state-success">{t('crashHistory.saved')}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => void action('reveal')}>{t('crashHistory.showFile')}</Button>
            <Button size="sm" variant="secondary" disabled={actionBusy} onClick={() => void action('save')}>{t('crashHistory.saveDump')}</Button>
          </div>
        </>}
      </div>
    </Modal>
  </section>;
}
