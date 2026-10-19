import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Button } from '../common/ui';
import { isGameRunningModLockError, repairModCompatibility, revealPath, reviewModCompatibility } from '../../lib/api';
import type { CompatibilityReview } from '../../lib/modCompatibility';
import type { Mod } from '../../types/mod';
import { useAppStore } from '../../stores/appStore';
import { showToast } from '../../stores/toastStore';

type ReviewState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; reports: CompatibilityReview[] };

export function CompatibilityRepairsModal({ open, onClose, mods }: { open: boolean; onClose: () => void; mods: Mod[] }) {
  const { t } = useTranslation();
  const loadMods = useAppStore((store) => store.loadMods);
  const [state, setState] = useState<ReviewState>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [backups, setBackups] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void reviewModCompatibility().then(
      (reports) => { if (active) setState({ kind: 'ready', reports }); },
      (error: unknown) => { if (active) setState({ kind: 'failed', error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { active = false; };
  }, [open]);

  const close = () => {
    setState({ kind: 'loading' });
    onClose();
  };

  const repair = async (modId: string) => {
    setBusy(modId);
    try {
      const result = await repairModCompatibility(modId);
      if (result.kind === 'repaired') {
        setBackups((previous) => [...previous, result.backupPath]);
        showToast(t('installed.repairs.repaired', { count: result.count }), { tone: 'success' });
      } else {
        showToast(t('installed.repairs.unchanged'), { tone: 'info' });
      }
      await loadMods({ force: true, silent: true });
      setState({ kind: 'ready', reports: await reviewModCompatibility() });
    } catch (error) {
      if (!isGameRunningModLockError(error)) {
        showToast(t('installed.repairs.failed', { error: error instanceof Error ? error.message : String(error) }), { tone: 'error' });
      }
    } finally {
      setBusy(null);
    }
  };

  const findings = state.kind === 'ready'
    ? state.reports.filter((report) => report.kind === 'failed' || report.findings.length > 0)
    : [];

  return (
    <Modal open={open} onClose={close} size="lg" labelledBy="compatibility-repairs-title" dismissable={!busy}>
      <ModalBody>
        <h2 id="compatibility-repairs-title" className="font-reaver text-2xl text-text-primary">{t('installed.repairs.title')}</h2>
        <p className="mt-2 text-sm text-text-secondary">{t('installed.repairs.description')}</p>
        <p className="mt-2 text-xs text-text-tertiary">{t('installed.repairs.backupNote')}</p>
        {state.kind === 'loading' && <p className="mt-4 text-sm text-text-secondary" role="status">{t('installed.repairs.checking')}</p>}
        {state.kind === 'failed' && <p className="mt-4 text-sm text-state-danger" role="alert">{t('installed.repairs.failed', { error: state.error })}</p>}
        {state.kind === 'ready' && findings.length === 0 && <p className="mt-4 text-sm text-text-secondary">{t('installed.repairs.empty')}</p>}
        <ul className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto">
          {findings.map((report) => {
            const mod = mods.find((mod) => mod.id === report.modId);
            const repairable = report.kind === 'checked' && report.findings.some((finding) => finding.status === 'repairable');
            return (
              <li key={report.modId} className="rounded-sm border border-border bg-bg-primary p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="break-words font-mod-title text-sm text-text-primary">{mod?.name ?? report.modId}</h3>
                  {repairable && <Button size="sm" variant="secondary" disabled={!!busy} isLoading={busy === report.modId} onClick={() => void repair(report.modId)}>{t('installed.repairs.repair')}</Button>}
                </div>
                {report.kind === 'failed' ? <p className="mt-2 text-xs text-state-warning">{report.error}</p> : (
                  <ul className="mt-2 space-y-2">
                    {report.findings.map((finding) => (
                      <li key={`${finding.kind}:${finding.entry}`} className="text-xs text-text-secondary">
                        <p className="break-all">{finding.entry}</p>
                        <p className={finding.status === 'unsupported' ? 'text-state-warning' : ''}>
                          {finding.status === 'repairable'
                            ? finding.kind === 'data' ? t('installed.repairs.data', { count: finding.changes })
                              : finding.kind === 'localization' ? t('installed.repairs.localization', { count: finding.changes })
                                : finding.kind === 'sounds' ? t('installed.repairs.sounds')
                                : t('installed.repairs.skeleton')
                            : t('installed.repairs.unsupported')}
                        </p>
                        {finding.detail && <details className="mt-1"><summary className="cursor-pointer">{t('installed.repairs.details')}</summary><p className="mt-1 break-words">{finding.detail}</p></details>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </ModalBody>
      <ModalFooter>
        {backups.length > 0 && <Button variant="secondary" onClick={() => void revealPath(backups[backups.length - 1])}>{t('installed.repairs.backups')}</Button>}
        <Button variant="secondary" disabled={!!busy} onClick={close}>{t('common.actions.close')}</Button>
      </ModalFooter>
    </Modal>
  );
}
