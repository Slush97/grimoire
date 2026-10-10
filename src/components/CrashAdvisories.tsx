import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useCrashAdvisoryStore, useCrashLaunchSuspect } from '../stores/crashAdvisoryStore';
import { Button, Tag, ModalHeader } from './common/ui';
import { Modal } from './common/Modal';

/** Mounted once. Findings never open a dialog automatically. */
export function CrashAdvisoryHost() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { findings, detailId, closeDetail, refresh, dismiss } = useCrashAdvisoryStore();
  const finding = findings.find(item => item.id === detailId);
  useEffect(() => {
    const unsubscribe = window.electronAPI.onCrashAdvisoriesChanged(next => useCrashAdvisoryStore.getState().receiveFindings(next));
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  return <Modal open={!!finding} onClose={closeDetail} size="md" labelledBy="crash-advisory-title">
    <ModalHeader titleId="crash-advisory-title" title={t('crashAdvisory.title')} onClose={closeDetail} />
    {finding && <div className="space-y-4 p-4">
      <p className="break-words text-sm text-text-primary">{t('crashAdvisory.explanation', { name: finding.modName })}</p>
      <p className="text-sm text-text-secondary">{finding.attribution === 'recorded' ? t('crashAdvisory.recorded') : t('crashAdvisory.lastKnown')}</p>
      <p className="text-sm text-text-secondary">{t('crashAdvisory.tryDisabling')}</p>
      <div className="text-xs text-text-secondary">
        {t('crashAdvisory.when', { date: new Date(finding.crashedAt).toLocaleString(), build: finding.gameBuild })}
      </div>
      <details className="rounded-sm border border-border p-3">
        <summary className="cursor-pointer text-sm text-text-primary">{t('crashAdvisory.showError')}</summary>
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-text-secondary">{finding.error}</pre>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => void dismiss(finding.id)}>{t('crashAdvisory.dismiss')}</Button>
        <Button variant="secondary" onClick={() => {
          closeDetail();
          navigate('/', { state: { crashSuspectId: finding.modId } });
        }}>{t('crashAdvisory.showMod')}</Button>
      </div>
    </div>}
  </Modal>;
}

export function CrashAdvisoryBadge({ modIds, variant = 'inline' }: { modIds: string[]; variant?: 'inline' | 'overlay' }) {
  const { t } = useTranslation();
  const findings = useCrashAdvisoryStore(state => state.findings);
  const openDetail = useCrashAdvisoryStore(state => state.openDetail);
  const finding = findings.find(item => modIds.includes(item.modId));
  if (!finding) return null;
  return <button type="button" data-card-action="true" title={t('crashAdvisory.viewForMod', { name: finding.modName })}
    aria-label={t('crashAdvisory.viewForMod', { name: finding.modName })}
    className="inline-flex max-w-full cursor-pointer rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
    onClick={event => { event.stopPropagation(); openDetail(finding.id); }}>
    <Tag variant={variant} tone={finding.enabled ? 'warning' : 'neutral'} icon={AlertTriangle}>
      {t('crashAdvisory.badge')}
    </Tag>
  </button>;
}

/** Separate click target. It never changes the launch button's handler or disabled state. */
export function CrashLaunchIndicator({ compact = false, unified = false }: { compact?: boolean; unified?: boolean }) {
  const { t } = useTranslation();
  const openDetail = useCrashAdvisoryStore(state => state.openDetail);
  const suspect = useCrashLaunchSuspect();
  if (!suspect) return null;
  if (compact) return <button type="button" title={t('crashAdvisory.launchHint', { name: suspect.modName })}
    aria-label={t('crashAdvisory.launchHint', { name: suspect.modName })}
    className="absolute -right-1 -top-1 z-20 flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm bg-bg-secondary text-state-warning focus-visible:outline-2 focus-visible:outline-accent"
    onClick={() => openDetail(suspect.id)}><AlertTriangle className="h-3 w-3" aria-hidden /></button>;
  return <button type="button" title={t('crashAdvisory.launchHint', { name: suspect.modName })}
    aria-label={t('crashAdvisory.launchHint', { name: suspect.modName })}
    className={`absolute top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-state-warning transition-colors hover:bg-bg-secondary/90 focus-visible:outline-2 focus-visible:outline-accent ${unified ? 'right-9' : 'right-1'}`}
    onClick={() => openDetail(suspect.id)}><AlertTriangle className="h-3.5 w-3.5" aria-hidden /></button>;
}
