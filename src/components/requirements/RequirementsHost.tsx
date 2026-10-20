import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Button, IconButton } from '../common/ui';
import ModDetailsModal from '../ModDetailsModal';
import { RequirementsPanel } from './RequirementsPanel';
import { useAppStore } from '../../stores/appStore';
import { checkQuickInstallRequirements, useRequirementsStore } from '../../stores/requirementsStore';
import { getModDetails, downloadMod } from '../../lib/api';
import { hasRequirementIssues, requirementKey } from '../../lib/modRequirements';
import { shouldBlurNsfw } from '../../lib/appSettings';
import type { GameBananaModDetails } from '../../types/gamebanana';
import { showToast } from '../../stores/toastStore';

export function RequirementsHost() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const review = useRequirementsStore(s => s.review);
  const targets = useRequirementsStore(s => s.targets);
  const snapshots = useRequirementsStore(s => s.snapshots);
  const mods = useAppStore(s => s.mods);
  const settings = useAppStore(s => s.settings);
  const [loaded, setLoaded] = useState<{ key: string; details: GameBananaModDetails } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = targets.at(-1);
  const targetKey = target ? requirementKey(target) : '';
  useEffect(() => {
    if (!target) return;
    let current = true;
    void getModDetails(target.id, target.section, { includeSubmitter: true }).then(details => {
      if (current) { setLoaded({ key: targetKey, details }); setError(null); }
    }).catch(() => { if (current) setError(targetKey); });
    return () => { current = false; };
  }, [target, targetKey]);
  useEffect(() => {
    const unsubscribe = window.electronAPI.onRequirementInstallCheck(request => {
      void (async () => {
        let accepted = false;
        try {
          await useAppStore.getState().loadMods({ force: true });
          accepted = await checkQuickInstallRequirements(request.source, useAppStore.getState().mods);
        } finally { await window.electronAPI.respondToRequirementInstallCheck(request.requestId, accepted); }
      })().catch(error => console.warn('[requirements] Install check failed:', error));
    });
    return () => { unsubscribe(); useRequirementsStore.getState().finish(false); };
  }, []);
  const close = () => target ? useRequirementsStore.getState().back() : useRequirementsStore.getState().finish(false);
  if (target) {
    const details = loaded?.key === targetKey ? loaded.details : null;
    if (!details) return <Modal onClose={close} labelledBy="requirement-target-title" backdropClassName="z-80">
      <ModalBody><h2 id="requirement-target-title" className="font-reaver text-2xl">{error === targetKey ? t('requirements.loadError') : t('requirements.loading')}</h2></ModalBody>
      <ModalFooter><Button icon={ArrowLeft} onClick={close}>{t('requirements.back')}</Button></ModalFooter>
    </Modal>;
    const installed = mods.filter(mod => mod.gameBananaId === target.id && (mod.sourceSection ?? 'Mod') === target.section);
    if (details.gameId !== undefined && details.gameId !== 20948) return <Modal onClose={close} labelledBy="requirement-other-game" backdropClassName="z-80">
      <ModalBody><h2 id="requirement-other-game" className="font-reaver text-2xl">{details.name}</h2><p className="mt-3 text-sm text-text-secondary">{t('requirements.otherGame')}</p></ModalBody>
      <ModalFooter><Button onClick={close}>{t('requirements.back')}</Button><Button onClick={() => window.open(`https://gamebanana.com/${target.section === 'Sound' ? 'sounds' : target.section === 'Wip' ? 'wips' : 'mods'}/${target.id}`, '_blank', 'noopener,noreferrer')}>{t('requirements.gamebanana')}</Button></ModalFooter>
    </Modal>;
    return <ModDetailsModal key={targetKey} mod={details} section={target.section} installed={installed.length > 0}
      installedFileIds={new Set(installed.flatMap(mod => mod.gameBananaFileId ? [mod.gameBananaFileId] : []))}
      activeFileIds={new Set(installed.filter(mod => mod.enabled).flatMap(mod => mod.gameBananaFileId ? [mod.gameBananaFileId] : []))}
      hideNsfwPreviews={shouldBlurNsfw(settings)} requirementsLayer onBack={close} onClose={close}
      onOpenGameBananaItem={item => useRequirementsStore.getState().openTarget(item)}
      onDownload={async (fileId, fileName) => {
        try {
          await downloadMod(target.id, fileId, fileName, target.section, details.category?.id, details.name);
          await useAppStore.getState().loadMods({ force: true });
        } catch (error) { showToast(String(error), { tone: 'error' }); }
      }} />;
  }
  if (!review) return null;
  const latest = snapshots[requirementKey(review.source)];
  const source = latest && latest.checkedAt >= review.source.requirements.checkedAt ? { ...review.source, requirements: latest } : review.source;
  const issues = hasRequirementIssues(source.requirements, mods);
  return <Modal onClose={close} labelledBy="requirements-title" backdropClassName="z-80" panelClassName="max-h-[85vh]">
    <div className="flex items-start justify-between gap-4 border-b border-border p-4">
      <div><h2 id="requirements-title" className="font-reaver text-2xl">{review.kind === 'install' ? t('requirements.installTitle') : t('requirements.title')}</h2><p className="mt-2 text-xs text-text-secondary">{source.name}</p></div>
      <IconButton icon={X} label={t('common.actions.close')} onClick={close} />
    </div>
    <ModalBody><RequirementsPanel source={source} onLocate={review.kind === 'inspect' ? modId => {
      useRequirementsStore.getState().finish(false);
      navigate('/', { state: { requirementModId: modId } });
    } : undefined} /></ModalBody>
    {review.kind === 'install' && <ModalFooter>
      <Button variant="ghost" onClick={() => useRequirementsStore.getState().finish(false)}>{t('requirements.cancel')}</Button>
      <Button variant={issues ? 'secondary' : 'primary'} onClick={() => useRequirementsStore.getState().finish(true)}>{issues ? t('requirements.installAnyway') : t('requirements.install')}</Button>
    </ModalFooter>}
  </Modal>;
}
