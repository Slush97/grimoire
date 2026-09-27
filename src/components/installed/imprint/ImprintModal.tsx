import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Fingerprint } from 'lucide-react';
import type { ImprintAllInstalledResult, ImprintInstalledProgress, ImprintPreflightResult } from '../../../lib/api';
import type { ImprintAnomalousMod, ImprintSkippedMod, ImprintFailedMod } from '../../../types/mod';
import { Modal } from '../../common/Modal';
import { Button, ModalHeader } from '../../common/ui';
import { EmptyState, LoadingState } from '../../common/PageComponents';

// The four phases of the bulk-imprint modal, as one discriminated union.
//  - preflight: the dry-run is in flight; render a LoadingState.
//  - review: the dry-run returned; render one line per bucket + the commit button.
//  - running: the bulk imprint is streaming progress ticks (dismiss blocked).
//  - done: the final report (imprinted / skipped / failed).
export type ImprintModalState =
  | { phase: 'preflight' }
  | { phase: 'review'; preflight: ImprintPreflightResult }
  | { phase: 'running'; progress: ImprintInstalledProgress | null }
  | { phase: 'done'; result: ImprintAllInstalledResult }
  | null;

// One preflight bucket line: a count + its one-line consequence (the full copy,
// which leads with {{count}}). A small tone-colored dot flags the buckets that
// need attention. Hidden when the bucket is empty. Rendered in a fixed order so
// the eligible line always leads and the anomaly line trails.
function ImprintBucketLine({ count, label, tone = 'muted' }: {
  count: number;
  label: string;
  tone?: 'muted' | 'accent' | 'warning' | 'danger';
}) {
  if (count <= 0) return null;
  const dotTones: Record<string, string> = {
    muted: 'bg-text-tertiary/50',
    accent: 'bg-accent',
    warning: 'bg-state-warning',
    danger: 'bg-state-danger',
  };
  return (
    <div className="flex items-center gap-2 text-sm text-text-secondary">
      <span aria-hidden className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotTones[tone]}`} />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}

// A collapsible per-item report list (Skipped / Failed) for the result phase.
// Defaults collapsed so a clean run stays tidy; the count sits in the summary.
function ImprintReportList({ title, items }: {
  title: string;
  items: Array<{ key: string; name: string; reason: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-md border border-hl/5 bg-bg-tertiary/40 overflow-hidden">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary">
        {title}
      </summary>
      <ul className="divide-y divide-hl/5 border-t border-hl/5">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate text-sm text-text-primary" title={item.name}>{item.name}</span>
            <span className="flex-shrink-0 text-xs text-text-tertiary">{item.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// The retroactive bulk-imprint modal: a preflight dry-run, a commit + live
// progress phase, and a final report, all in one shared Modal. Dismissal is
// blocked while a run is in flight (the game has the VPKs, so an interrupted
// swap would strand a temp file). No new IPC: it reads the preflight buckets and
// streams progress from the channels wired in Stage B.
export function ImprintModal({ state, onConfirm, onClose }: {
  state: NonNullable<ImprintModalState>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = 'imprint-modal-title';
  const running = state.phase === 'running';

  const anomalyReason = (reason: ImprintAnomalousMod['reason']): string => {
    switch (reason) {
      case 'unparseable': return t('installed.imprintAll.anomalyUnparseable');
      case 'empty': return t('installed.imprintAll.anomalyEmpty');
      case 'chunked': return t('installed.imprintAll.anomalyChunked');
      case 'hash-drift': return t('installed.imprintAll.anomalyHashDrift');
      case 'foreign-embed': return t('installed.imprintAll.anomalyForeignEmbed');
      case 'orphan-merge': return t('installed.imprintAll.anomalyOrphanMerge');
      case 'unidentified': return t('installed.imprintAll.anomalyUnidentified');
    }
  };
  // The bulk run reports anomalies as their raw reason tokens (they flow into
  // failed[] alongside free-form error messages); localize the known tokens so
  // the result list reads the same as the preflight list.
  const isAnomalyReason = (reason: string): reason is ImprintAnomalousMod['reason'] =>
    reason === 'unparseable' || reason === 'empty' || reason === 'chunked' ||
    reason === 'hash-drift' || reason === 'foreign-embed' || reason === 'orphan-merge' ||
    reason === 'unidentified';

  let body: ReactNode;
  let footer: ReactNode;

  if (state.phase === 'preflight') {
    body = <LoadingState label={t('installed.imprintAll.checking')} className="min-h-40" />;
    footer = (
      <Button variant="secondary" onClick={onClose}>{t('common.actions.cancel')}</Button>
    );
  } else if (state.phase === 'review') {
    const { counts } = state.preflight;
    const autoManaged = counts.merged + counts.lockerManaged;
    const eligible = counts.eligible;
    body = (
      <>
        <p className="text-sm text-text-secondary">{t('installed.imprintAll.description')}</p>
        {eligible === 0 &&
        counts.alreadyImprinted === 0 &&
        counts.blockedLoaded === 0 &&
        autoManaged === 0 &&
        counts.anomalous === 0 ? (
          <EmptyState
            icon={Fingerprint}
            title={t('installed.imprintAll.empty')}
            className="min-h-40"
          />
        ) : (
          <div className="space-y-1.5 rounded-md border border-hl/5 bg-bg-tertiary/40 p-3">
            <ImprintBucketLine count={eligible} label={t('installed.imprintAll.eligible', { count: eligible })} tone="accent" />
            <ImprintBucketLine count={counts.alreadyImprinted} label={t('installed.imprintAll.alreadyImprinted', { count: counts.alreadyImprinted })} />
            <ImprintBucketLine count={counts.blockedLoaded} label={t('installed.imprintAll.blockedLoaded', { count: counts.blockedLoaded })} tone="warning" />
            <ImprintBucketLine count={autoManaged} label={t('installed.imprintAll.autoManaged', { count: autoManaged })} />
            <ImprintBucketLine count={counts.anomalous} label={t('installed.imprintAll.anomalies', { count: counts.anomalous })} tone="danger" />
          </div>
        )}
        {state.preflight.anomalous.length > 0 && (
          <ImprintReportList
            title={t('installed.imprintAll.anomalies', { count: state.preflight.anomalous.length })}
            items={state.preflight.anomalous.map((a: ImprintAnomalousMod) => ({
              key: a.fileName,
              name: a.modName || a.fileName,
              reason: anomalyReason(a.reason),
            }))}
          />
        )}
        {eligible > 0 && (
          <p className="text-xs text-text-tertiary">{t('installed.imprintAll.repackNote')}</p>
        )}
      </>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={onClose}>{t('common.actions.cancel')}</Button>
        <Button variant="primary" icon={Fingerprint} disabled={eligible === 0} onClick={onConfirm}>
          {t('installed.imprintAll.startImprinting', { count: eligible })}
        </Button>
      </>
    );
  } else if (state.phase === 'running') {
    const p = state.progress;
    const done = p?.done ?? 0;
    const total = p?.total ?? 0;
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-accent" />
          <div className="min-w-0">
            <div className="text-sm text-text-primary">
              {t('installed.imprintAll.progress', { done, total })}
            </div>
            {p?.fileName && (
              <div className="mt-0.5 truncate text-xs text-text-tertiary" title={p.fileName}>
                {t('installed.imprintAll.currentFile', { fileName: p.modName || p.fileName })}
              </div>
            )}
          </div>
          <span className="ml-auto flex-shrink-0 text-sm tabular-nums text-text-secondary">
            {done}/{total}
          </span>
        </div>
      </div>
    );
    footer = (
      <Button variant="primary" isLoading disabled>
        {t('installed.imprintAll.progress', { done, total })}
      </Button>
    );
  } else {
    const { result } = state;
    const skipped = result.skipped.map((s: ImprintSkippedMod) => ({
      key: s.fileName,
      name: s.modName || s.fileName,
      reason: t('installed.imprintAll.skipReasonLoaded'),
    }));
    const failed = result.failed.map((f: ImprintFailedMod) => ({
      key: f.fileName,
      name: f.modName || f.fileName,
      reason: isAnomalyReason(f.reason) ? anomalyReason(f.reason) : f.reason,
    }));
    body = (
      <>
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <Fingerprint className="h-4 w-4 flex-shrink-0 text-accent" />
          {t('installed.imprintAll.imprintedSummary', { count: result.imprinted })}
        </div>
        <ImprintReportList title={t('installed.imprintAll.skippedTitle', { count: skipped.length })} items={skipped} />
        <ImprintReportList title={t('installed.imprintAll.failedTitle', { count: failed.length })} items={failed} />
      </>
    );
    footer = (
      <Button variant="secondary" onClick={onClose}>{t('common.actions.close')}</Button>
    );
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      labelledBy={titleId}
      dismissable={!running}
      panelClassName="flex max-h-[85vh] flex-col"
    >
      <ModalHeader
        title={t('installed.imprintAll.title')}
        titleId={titleId}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
        closeDisabled={running}
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-5">{body}</div>
      <div className="flex flex-shrink-0 justify-end gap-2 border-t border-border p-4">{footer}</div>
    </Modal>
  );
}
