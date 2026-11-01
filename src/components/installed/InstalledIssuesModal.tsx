import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, CameraOff, CircleHelp, FileWarning, Info, Link2, PowerOff, Wrench } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Button, ModalHeader, ProgressBar, Tag } from '../common/ui';
import { Select } from '../common/forms';
import ModThumbnail from '../ModThumbnail';
import { getActiveDeadlockPath, shouldBlurNsfw } from '../../lib/appSettings';
import { healModAttachments, isGameRunningModLockError, repairModCompatibility, revealPath, reviewModCompatibility } from '../../lib/api';
import { collectInstalledIssueGroups, installedIssueModIdentity, installedIssueModsAtPath, installedIssuesScope, type InstalledIssue } from '../../lib/installedIssues';
import type { CompatibilityFinding, CompatibilityReview } from '../../lib/modCompatibility';
import type { RequirementSource } from '../../lib/modRequirements';
import type { Mod } from '../../types/mod';
import { useAppStore } from '../../stores/appStore';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { useInstalledIssuesStore } from '../../stores/installedIssuesStore';
import { showToast } from '../../stores/toastStore';

interface InstalledIssuesModalProps {
  open: boolean;
  onClose: () => void;
  mods: Mod[];
  onIdentifyUnknown: (mods: Mod[]) => void;
  onReviewRequirements: (source: RequirementSource) => void;
}
type ReviewState = { scope: string | null } & ({ kind: 'loading' } | { kind: 'failed'; error: string } | { kind: 'ready'; reports: CompatibilityReview[] });
type Operation = { kind: 'camera' | 'repair' | 'disable'; modId: string; name: string; done: number; total: number };
type IssueFilter = InstalledIssue['kind'] | 'all';
class ScopeChangedError extends Error {}
const entryName = (entry: string) => entry.slice(entry.lastIndexOf('/') + 1).replace(/_c$/, '');
const EMPTY_REPORTS: readonly CompatibilityReview[] = [];

function CompatibilityFindingRow({ finding }: { finding: CompatibilityFinding }) {
  const { t } = useTranslation();
  const text = finding.status !== 'repairable' ? t('installed.repairs.unsupported')
    : finding.kind === 'data' ? t('installed.repairs.data', { count: finding.changes })
      : finding.kind === 'localization' ? t('installed.repairs.localization', { count: finding.changes })
        : finding.kind === 'sounds' ? t('installed.repairs.sounds') : t('installed.repairs.skeleton');
  return <li className="text-xs text-text-secondary">
    <p className="break-all">{finding.entry}</p>
    <p className={finding.status === 'unsupported' ? 'text-state-warning' : undefined}>{text}</p>
    {finding.detail && <details className="mt-1">
      <summary className="cursor-pointer">{t('installed.repairs.details')}</summary>
      <p className="mt-1 break-words">{finding.detail}</p>
    </details>}
  </li>;
}

export function InstalledIssuesModal({ open, onClose, mods, onIdentifyUnknown, onReviewRequirements }: InstalledIssuesModalProps) {
  const { t } = useTranslation();
  const settings = useAppStore(state => state.settings);
  const loaded = useAppStore(state => state.modsLoaded);
  const snapshots = useRequirementsStore(state => state.snapshots);
  const files = useRequirementOrderStore(state => state.files);
  const scope = installedIssuesScope(settings);
  const path = getActiveDeadlockPath(settings);
  const activeMods = useMemo(() => installedIssueModsAtPath(mods, path), [mods, path]);
  const ready = loaded && (mods.length === 0 || activeMods.length > 0);
  const [review, setReview] = useState<ReviewState>({ kind: 'loading', scope: null });
  const [operation, setOperation] = useState<Operation | null>(null);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [backupState, setBackups] = useState<{ scope: string | null; paths: string[] }>({ scope: null, paths: [] });
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const reviewGeneration = useRef(0);
  const reviewPending = useRef<{ scope: string; generation: number } | null>(null);
  const backups = backupState.scope === scope ? backupState.paths : [];
  const currentReview = review.scope === scope ? review : null;
  const reports = currentReview?.kind === 'ready' ? currentReview.reports : EMPTY_REPORTS;
  const groups = useMemo(() => collectInstalledIssueGroups(activeMods, snapshots, files,
    reports), [activeMods, snapshots, files, reports]);
  const filteredGroups = useMemo(() => issueFilter === 'all' ? groups : groups
    .map(group => ({ ...group, issues: group.issues.filter(issue => issue.kind === issueFilter) }))
    .filter(group => group.issues.length > 0), [groups, issueFilter]);

  useEffect(() => {
    const unmountView = useInstalledIssuesStore.getState().mountView();
    mounted.current = true;
    return () => { mounted.current = false; unmountView(); };
  }, []);

  const isCurrent = useCallback((expected: string | null) =>
    mounted.current && installedIssuesScope(useAppStore.getState().settings) === expected, []);
  const assertCurrent = (expected: string | null) => { if (!isCurrent(expected)) throw new ScopeChangedError(); };
  const refreshReview = useCallback((expected: string, force = false): Promise<void> => {
    const pending = reviewPending.current;
    if (!force && pending?.scope === expected && pending.generation === reviewGeneration.current) return Promise.resolve();
    const generation = ++reviewGeneration.current;
    reviewPending.current = { scope: expected, generation };
    const request = Promise.resolve().then(() => {
      if (!isCurrent(expected) || generation !== reviewGeneration.current) return null;
      setReview(previous => previous.kind === 'loading' && previous.scope === expected ? previous : { kind: 'loading', scope: expected });
      const state = useAppStore.getState();
      const enabled = installedIssueModsAtPath(state.mods, getActiveDeadlockPath(state.settings)).some(mod => mod.enabled);
      return enabled ? reviewModCompatibility() : [];
    });
    return request.then(reports => {
      if (reports !== null && isCurrent(expected) && generation === reviewGeneration.current) setReview({ kind: 'ready', reports, scope: expected });
    }).catch((error: unknown) => {
      if (isCurrent(expected) && generation === reviewGeneration.current)
        setReview({ kind: 'failed', error: error instanceof Error ? error.message : String(error), scope: expected });
    }).finally(() => {
      if (reviewPending.current?.generation === generation) reviewPending.current = null;
    });
  }, [isCurrent]);
  useEffect(() => {
    if (open && scope && ready) void refreshReview(scope);
    else reviewGeneration.current++;
  }, [open, scope, ready, refreshReview]);

  const resolveCurrent = (target: Mod, expected: string, enabledOnly = false) => {
    assertCurrent(expected);
    const state = useAppStore.getState();
    const current = installedIssueModsAtPath(state.mods, getActiveDeadlockPath(state.settings))
      .filter(mod => !enabledOnly || mod.enabled);
    const identity = installedIssueModIdentity(target);
    return current.find(mod => mod.id === target.id && installedIssueModIdentity(mod) === identity)
      ?? current.find(mod => installedIssueModIdentity(mod) === identity);
  };

  const run = async (kind: Operation['kind'], targets: Mod[]) => {
    if (busyRef.current || useInstalledIssuesStore.getState().busy || !scope || targets.length === 0) return;
    const expected = scope;
    if (!isCurrent(expected)) { showToast(t('installed.issues.scopeChanged'), { tone: 'warning' }); return; }
    busyRef.current = true;
    useInstalledIssuesStore.getState().setBusy(true);
    let healed = 0;
    try {
      for (const [done, target] of targets.entries()) {
        const mod = resolveCurrent(target, expected, kind === 'disable');
        if (!mod) continue;
        setOperation({ kind, modId: mod.id, name: mod.name, done, total: targets.length });
        if (kind === 'disable') {
          if (mod.enabled) await useAppStore.getState().toggleMod(mod.id);
        } else if (kind === 'repair') {
          const result = await repairModCompatibility(mod.id);
          assertCurrent(expected);
          if (result.kind === 'repaired') {
            setBackups(previous => ({ scope: expected, paths: [...(previous.scope === expected ? previous.paths : []), result.backupPath] }));
            showToast(t('installed.repairs.repaired', { count: result.count }), { tone: 'success' });
          } else showToast(t('installed.repairs.unchanged'), { tone: 'info' });
        } else {
          try { if (await healModAttachments(mod.id) > 0) healed++; }
          catch (error) {
            if (!isGameRunningModLockError(error)) {
              assertCurrent(expected);
              const detail = (error instanceof Error ? error.message : String(error))
                .replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
              showToast(t('installed.staleModels.failed', { name: mod.name, error: detail }), { tone: 'error' });
            }
          }
        }
        assertCurrent(expected);
      }
      assertCurrent(expected);
      setOperation(previous => previous && { ...previous, done: previous.total });
      await useAppStore.getState().loadMods({ force: true, silent: true });
      assertCurrent(expected);
      if (healed) showToast(t('installed.staleModels.healed', { count: healed }), { tone: 'success' });
      setReview({ kind: 'loading', scope: expected });
      await refreshReview(expected, true);
    } catch (error) {
      if (error instanceof ScopeChangedError) {
        if (mounted.current && installedIssuesScope(useAppStore.getState().settings) !== expected)
          showToast(t('installed.issues.scopeChanged'), { tone: 'warning' });
      }
      else if (!isGameRunningModLockError(error)) showToast(t('installed.repairs.failed', {
        error: error instanceof Error ? error.message : String(error),
      }), { tone: 'error' });
    } finally {
      busyRef.current = false;
      useInstalledIssuesStore.getState().setBusy(false);
      if (mounted.current) setOperation(null);
    }
  };

  const close = () => {
    if (!busyRef.current) { setReview({ kind: 'loading', scope }); setIssueFilter('all'); onClose(); }
  };
  const reviewRequirements = (source: RequirementSource) => {
    if (busyRef.current || !isCurrent(scope)) return;
    close(); onReviewRequirements(source);
  };
  const identify = (target: Mod) => {
    if (busyRef.current || !scope || !isCurrent(scope)) return;
    const mod = resolveCurrent(target, scope);
    if (mod?.isUnknown) { close(); onIdentifyUnknown([mod]); }
  };
  const cameraIds = new Set(groups.flatMap(group => group.issues.filter(issue => issue.kind === 'camera').map(issue => issue.modId)));
  const dataIds = new Set(groups.flatMap(group => group.issues.filter(issue => issue.kind === 'data').map(issue => issue.modId)));
  const cameraMods = activeMods.filter(mod => cameraIds.has(mod.id));
  const dataMods = activeMods.filter(mod => dataIds.has(mod.id));
  const busy = !!operation;
  const progressText = operation ? t('installed.staleModels.progressCount', {
    name: operation.name, current: Math.min(operation.done + 1, operation.total), total: operation.total,
  }) : '';
  const visibleIssues = (issues: InstalledIssue[], modId: string) => issues.filter(issue => issue.modId === modId);
  const filterOptions: { value: IssueFilter; label: string }[] = [
    { value: 'all', label: t('installed.issues.all') },
    { value: 'camera', label: t('installed.issues.camera') },
    { value: 'data', label: t('installed.issues.outdated') },
    { value: 'compatibility', label: t('installed.issues.compatibility') },
    { value: 'unknown', label: t('installed.issues.unknown') },
    { value: 'requirements', label: t('installed.issues.requirements') },
  ];

  return <Modal open={open} onClose={close} size="xl" labelledBy="installed-issues-title" dismissable={!busy} panelClassName="flex max-h-[85vh] flex-col">
    <ModalHeader title={t('installed.issues.title')} titleId="installed-issues-title" onClose={close} closeDisabled={busy}
      actions={<span role="note" title={t('installed.repairs.backupNote')} aria-label={t('installed.repairs.backupNote')} className="px-1 text-text-tertiary">
        <Info className="h-4 w-4" aria-hidden />
      </span>} />
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
      <Select value={issueFilter} onChange={event => setIssueFilter(event.currentTarget.value as IssueFilter)}
        aria-label={t('installed.issues.filter')} inputSize="sm" disabled={busy}
        className="h-8 min-w-44 border-border! bg-bg-secondary! text-xs!">
        {filterOptions.map(option => <option key={option.value} value={option.value}>
          {option.label} ({option.value === 'all' ? groups.length : groups.filter(group => group.issues.some(issue => issue.kind === option.value)).length})
        </option>)}
      </Select>
      {(issueFilter === 'all' || issueFilter === 'camera') && cameraMods.length > 1 && <Button size="sm" variant="secondary" icon={Camera}
        className="h-auto! min-h-8 max-w-full whitespace-normal! py-1.5" disabled={busy} onClick={() => void run('camera', cameraMods)}>{t('installed.issues.cameraAll')}</Button>}
      {(issueFilter === 'all' || issueFilter === 'data') && dataMods.length > 1 && <Button size="sm" variant="secondary" icon={PowerOff}
        className="h-auto! min-h-8 max-w-full whitespace-normal! py-1.5" disabled={busy} onClick={() => void run('disable', dataMods)}>{t('installed.issues.disableAll')}</Button>}
    </div>
    {operation && <div className="shrink-0 space-y-1.5 border-b border-border px-5 py-3" role="status">
      <p className="truncate text-xs tabular-nums text-text-secondary">{progressText}</p>
      <ProgressBar value={operation.done} max={operation.total} indeterminate={operation.total === 1} label={progressText} />
    </div>}
    <ModalBody>
      {(!ready || !currentReview || currentReview.kind === 'loading') && <p className="mb-3 text-xs text-text-secondary" role="status">{t('installed.repairs.checking')}</p>}
      {currentReview?.kind === 'failed' && <div className="mb-3 space-y-2">
        <p className="text-xs text-state-warning" role="alert">{t('installed.repairs.failed', { error: currentReview.error })}</p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
          if (scope && !busyRef.current) { setReview({ kind: 'loading', scope }); void refreshReview(scope); }
        }}>{t('common.actions.retry')}</Button>
      </div>}
      {ready && currentReview?.kind === 'ready' && filteredGroups.length === 0 && <div className="py-8 text-center">
        <p className="text-sm text-text-secondary">{t(groups.length === 0 ? 'installed.issues.empty' : 'installed.issues.noFilterMatch')}</p>
        {issueFilter !== 'all' && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setIssueFilter('all')}>{t('common.actions.reset')}</Button>}
      </div>}
      <ul className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {filteredGroups.map(group => <li key={group.key} className="min-w-0 rounded-sm border border-border bg-bg-primary p-3">
          <div className="flex items-center gap-3">
            <ModThumbnail src={group.primary.thumbnailUrl} alt="" nsfw={group.primary.nsfw} hideNsfw={shouldBlurNsfw(settings)}
              mergedSources={group.primary.merged?.sources} forgeInstalled={!!group.primary.forgeInstall} enableImageContextMenu={false}
              className="h-10 w-16 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary" />
            <h3 className="min-w-0 break-words font-mod-title text-sm text-text-primary">{group.primary.name}</h3>
          </div>
          <ul className="mt-3 space-y-3">
            {group.mods.map(mod => {
              const issues = visibleIssues(group.issues, mod.id);
              if (!issues.length) return null;
              const camera = issues.some(issue => issue.kind === 'camera');
              const data = issues.some(issue => issue.kind === 'data');
              const unknown = issues.some(issue => issue.kind === 'unknown');
              const requirements = issues.filter((issue): issue is Extract<InstalledIssue, { kind: 'requirements' }> => issue.kind === 'requirements');
              const compatibility = issues.find((issue): issue is Extract<InstalledIssue, { kind: 'compatibility' }> => issue.kind === 'compatibility')?.report;
              const repairable = compatibility?.kind === 'checked' && compatibility.findings.some(finding => finding.status === 'repairable');
              return <li key={`${installedIssueModIdentity(mod)}:${mod.id}`} className="space-y-2 border-t border-border pt-3">
                {group.mods.length > 1 && <p className="break-words text-xs font-medium text-text-primary" title={mod.fileName}>
                  {mod.variantLabel ?? mod.fileDescription ?? mod.sourceFileName ?? mod.fileName}
                </p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  {camera && <Tag tone="warning" icon={CameraOff}>{t('installed.issues.camera')}</Tag>}
                  {data && <Tag tone="danger" icon={FileWarning}>{t('installed.issues.outdated')}</Tag>}
                  {requirements.length > 0 && <Tag icon={Link2}>{t('installed.issues.requirements')}</Tag>}
                  {unknown && <Tag icon={CircleHelp}>{t('installed.issues.unknown')}</Tag>}
                  {compatibility && <Tag icon={Wrench}>{t('installed.issues.compatibility')}</Tag>}
                </div>
                {(camera || data || compatibility) && <details className="text-xs text-text-secondary">
                  <summary className="cursor-pointer hover:text-text-primary">{t('installed.repairs.details')}</summary>
                  <div className="mt-2 space-y-2">
                    {camera && mod.staleModels?.map(model => <p key={model.entry} className="break-all" title={model.attachments.join('\n')}>
                      {t('installed.staleModels.model', { file: entryName(model.entry), count: model.attachments.length })}
                    </p>)}
                    {data && mod.outdatedVdata?.map(item => <p key={item.entry} className="break-all" title={item.sample.join('\n')}>
                      {t('installed.outdatedData.removes', { count: item.missing, file: entryName(item.entry) })}
                    </p>)}
                    {compatibility?.kind === 'failed' && <p className="break-words text-state-warning">{compatibility.error}</p>}
                    {compatibility?.kind === 'checked' && <ul className="space-y-2">
                      {compatibility.findings.map(finding => <CompatibilityFindingRow key={`${finding.kind}:${finding.entry}`} finding={finding} />)}
                    </ul>}
                  </div>
                </details>}
                <div className="flex flex-wrap items-center gap-2">
                  {camera && <Button size="sm" variant="secondary" icon={Camera} disabled={busy} isLoading={operation?.kind === 'camera' && operation.modId === mod.id}
                    onClick={() => void run('camera', [mod])}>{t('installed.issues.fixCamera')}</Button>}
                  {repairable && <Button size="sm" variant="secondary" icon={Wrench} disabled={busy} isLoading={operation?.kind === 'repair' && operation.modId === mod.id}
                    onClick={() => void run('repair', [mod])}>{t('installed.repairs.repair')}</Button>}
                  {data && <Button size="sm" variant="secondary" icon={PowerOff} disabled={busy}
                    onClick={() => void run('disable', [mod])}>{t('installed.outdatedData.disable')}</Button>}
                  {requirements.map(issue => <Button key={issue.key} size="sm" variant="secondary" icon={Link2} disabled={busy}
                    onClick={() => reviewRequirements(issue.source)}>{t('installed.issues.review')}</Button>)}
                  {unknown && <Button size="sm" variant="secondary" icon={CircleHelp} disabled={busy}
                    onClick={() => identify(mod)}>{t('installed.issues.identify')}</Button>}
                </div>
              </li>;
            })}
          </ul>
        </li>)}
      </ul>
    </ModalBody>
    <ModalFooter className="flex-wrap">
      {backups.length > 0 && <Button variant="secondary" className="h-auto! min-h-8 max-w-full whitespace-normal! py-1.5" disabled={busy} onClick={() => void revealPath(backups[backups.length - 1])}>{t('installed.repairs.backups')}</Button>}
      <Button variant="secondary" disabled={busy} onClick={close}>{t('common.actions.close')}</Button>
    </ModalFooter>
  </Modal>;
}
