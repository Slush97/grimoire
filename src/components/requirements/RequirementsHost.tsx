import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Power, PowerOff, X } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Button, CheckboxMark, IconButton, ModalHeader } from '../common/ui';
import ModDetailsModal from '../ModDetailsModal';
import { RequirementIdentity, RequirementsPanel } from './RequirementsPanel';
import { useAppStore } from '../../stores/appStore';
import { checkQuickInstallRequirements, useRequirementsStore, type RequirementToggleChoice, type RequirementToggleReview } from '../../stores/requirementsStore';
import { getModDetails, downloadMod } from '../../lib/api';
import { hasRequirementIssues, installedModRequirements, modRequirementRefs, requiredModClosure, requirementKey } from '../../lib/modRequirements';
import { modRestoreKey } from '../../lib/soloRestore';
import { shouldBlurNsfw } from '../../lib/appSettings';
import { parseGameBananaItemUrl, type GameBananaModDetails, type ModRequirement } from '../../types/gamebanana';
import { showToast } from '../../stores/toastStore';

export function RequirementToggleDialog({ review }: { review: RequirementToggleReview }) {
  const { t } = useTranslation();
  const mods = useAppStore(state => state.mods);
  const currentSnapshots = useRequirementsStore(state => state.snapshots);
  const snapshots = { ...review.snapshots, ...currentSnapshots };
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(false);
  const target = mods.find(mod => modRestoreKey(mod) === review.key);
  const dependentIds = review.mode === 'enable' ? []
    : requiredModClosure(review.mod.id, review.mods, review.snapshots, 'dependents');
  const relatedIds = [...new Set([...dependentIds, ...(review.mode === 'disable' ? []
    : requiredModClosure(review.mod.id, review.mods, review.snapshots, 'dependencies'))])];
  const declared = review.mode === 'disable' ? [] : installedModRequirements(target ?? review.mod, mods, snapshots);
  const rows: { key: string; item: ModRequirement; modKey?: string; dependent?: boolean }[] = [];
  const addMod = (id: string, item?: ModRequirement, dependent = false) => {
    const mod = mods.find(candidate => candidate.id === id) ?? review.mods.find(candidate => candidate.id === id);
    if (!mod) return;
    const key = modRestoreKey(mod);
    if (key === review.key || rows.some(row => row.modKey === key)) return;
    const ref = modRequirementRefs(mod)[0];
    rows.push({ key, modKey: key, dependent, item: item ?? { name: mod.name, importance: 'required', state: 'on',
      url: ref ? `https://gamebanana.com/${ref.section === 'Sound' ? 'sounds' : ref.section === 'Wip' ? 'wips' : 'mods'}/${ref.id}` : undefined } });
  };
  for (const { item, matches } of declared) {
    if (matches.length) for (const match of matches) addMod(match.modId, item);
    else rows.push({ key: `missing:${rows.length}`, item });
  }
  for (const id of relatedIds) {
    const original = review.mods.find(mod => mod.id === id);
    const live = original ? mods.find(mod => modRestoreKey(mod) === modRestoreKey(original)) : undefined;
    addMod(live?.id ?? id, undefined, dependentIds.includes(id));
  }
  const close = () => useRequirementsStore.getState().finishToggle();
  const apply = async (changes: readonly { key: string; enabled: boolean }[], choice?: RequirementToggleChoice) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(false);
    try {
      const applied = await useAppStore.getState().setModEnabledStates(changes);
      if (!applied) { setError(true); return; }
      if (choice) useRequirementsStore.getState().finishToggle(choice);
    } catch (error) {
      setError(true);
      showToast(String(error), { tone: 'error' });
    } finally { busyRef.current = false; setBusy(false); }
  };
  const all = (enabled: boolean) => {
    if (review.mode !== 'manage') { useRequirementsStore.getState().finishToggle('all'); return; }
    if (!enabled || !target) {
      void apply([{ key: review.key, enabled }, ...rows.flatMap(row => row.modKey ? [{ key: row.modKey, enabled }] : [])]);
      return;
    }
    const ids = new Set([target.id, ...requiredModClosure(target.id, mods, snapshots, 'dependencies')]);
    for (const row of rows.filter(row => row.dependent)) {
      const mod = mods.find(mod => modRestoreKey(mod) === row.modKey);
      if (mod) {
        ids.add(mod.id);
        for (const id of requiredModClosure(mod.id, mods, snapshots, 'dependencies')) ids.add(id);
      }
    }
    for (const { item, matches } of declared) {
      if (item.state === 'off') continue;
      const candidate = matches.find(match => match.enabled) ?? matches[0];
      if (candidate) {
        ids.add(candidate.modId);
        for (const id of requiredModClosure(candidate.modId, mods, snapshots, 'dependencies')) ids.add(id);
      }
    }
    const desired = new Map(mods.filter(mod => ids.has(mod.id)).map(mod => [modRestoreKey(mod), true]));
    for (const owner of mods.filter(mod => ids.has(mod.id))) {
      for (const { item, matches } of installedModRequirements(owner, mods, snapshots)) {
        if (item.state === 'off') for (const match of matches) {
          const mod = mods.find(mod => mod.id === match.modId);
          if (mod && !ids.has(mod.id)) desired.set(modRestoreKey(mod), false);
        }
      }
    }
    void apply([...desired].map(([key, enabled]) => ({ key, enabled })));
  };
  return <Modal onClose={close} labelledBy="requirement-toggle-title" dismissable={!busy}
    backdropClassName="z-80" panelClassName="max-h-[85vh]">
    <ModalHeader titleId="requirement-toggle-title" title={t(review.mode === 'enable' ? 'requirements.enableTitle'
      : review.mode === 'disable' ? 'requirements.disableTitle' : 'requirements.manageTitle')}
      subtitle={target?.name ?? review.mod.name} onClose={close} closeDisabled={busy} />
    <ModalBody>
      <p className="mb-4 text-sm text-text-secondary">{t(review.mode === 'enable' ? 'requirements.enableHint'
        : review.mode === 'disable' ? 'requirements.disableHint' : 'requirements.manageHint')}</p>
      {rows.length > 0 ? <ul className="divide-y divide-border rounded-sm border border-border bg-bg-sunken px-3">
        {rows.map(row => {
          const mod = row.modKey ? mods.find(candidate => modRestoreKey(candidate) === row.modKey) : undefined;
          const requirementTarget = row.item.url ? parseGameBananaItemUrl(row.item.url) : null;
          return <li key={row.key} className="flex items-center gap-3 py-3">
            <label className={`relative flex shrink-0 items-center ${busy || !mod ? 'cursor-default opacity-50' : 'cursor-pointer'}`}>
              <input type="checkbox" className="peer sr-only" checked={mod?.enabled ?? false} disabled={busy || !mod}
                aria-label={t('requirements.toggleNamed', { name: mod?.name ?? row.item.name })}
                onChange={event => { if (row.modKey) void apply([{ key: row.modKey, enabled: event.currentTarget.checked }]); }} />
              <span className="rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent"><CheckboxMark checked={mod?.enabled ?? false} /></span>
            </label>
            <div className="min-w-0 flex-1 space-y-1">
              <RequirementIdentity item={row.item} target={requirementTarget} installedMod={mod} />
              <p className="text-xs text-text-secondary">{t(row.dependent ? 'requirements.requiredBy' : row.item.importance === 'required' ? 'requirements.required'
                : row.item.importance === 'recommended' ? 'requirements.recommended' : row.item.importance === 'optional' ? 'requirements.optional' : 'requirements.review')}
                {!mod && <span> · {t(requirementTarget || row.item.sha256 ? 'requirements.notInstalled' : 'requirements.manual')}</span>}
                {row.item.state === 'off' && <span> · {t('requirements.mustBeOff')}</span>}</p>
            </div>
          </li>;
        })}
      </ul> : <p className="text-sm text-text-secondary">{t('requirements.none')}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-state-danger">{t('requirements.changeFailed')}</p>}
    </ModalBody>
    <ModalFooter className="flex-wrap">
      <Button icon={review.mode === 'disable' ? PowerOff : Power} disabled={busy || !target}
        onClick={() => all(review.mode !== 'disable')}>{t(review.mode === 'disable' ? 'requirements.disableAll' : 'requirements.enableAll')}</Button>
      {review.mode === 'manage' ? <>
        <Button variant="secondary" icon={PowerOff} disabled={busy || !target} onClick={() => all(false)}>{t('requirements.disableAll')}</Button>
        <Button variant="ghost" disabled={busy} onClick={close}>{t('common.actions.close')}</Button>
      </> : <>
        <Button variant="secondary" disabled={busy || !target} onClick={() => useRequirementsStore.getState().finishToggle('only')}>{t('requirements.onlyThis')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { void apply([{ key: review.key, enabled: review.mode === 'disable' }], 'cancel'); }}>
          {t(review.mode === 'disable' ? 'requirements.enable' : 'requirements.disable')}
        </Button>
      </>}
    </ModalFooter>
  </Modal>;
}

export function RequirementsHost() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const review = useRequirementsStore(s => s.review);
  const toggleReview = useRequirementsStore(s => s.toggleReview);
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
    return () => { unsubscribe(); useRequirementsStore.getState().finish(false); useRequirementsStore.getState().finishToggle(); };
  }, []);
  const close = () => target ? useRequirementsStore.getState().back() : toggleReview
    ? useRequirementsStore.getState().finishToggle() : useRequirementsStore.getState().finish(false);
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
  if (toggleReview) return <RequirementToggleDialog key={toggleReview.key + toggleReview.mode} review={toggleReview} />;
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
