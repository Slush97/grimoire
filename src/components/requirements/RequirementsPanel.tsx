import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDownUp, ArrowUp, Check, ChevronRight, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Button, Tag } from '../common/ui';
import { parseGameBananaItemUrl } from '../../types/gamebanana';
import { matchRequirement, requirementKey, skinRequirementSource, type RequirementSource } from '../../lib/modRequirements';
import { installedRequirementOrder, requirementOrderIssues } from '../../lib/requirementLoadOrder';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useAppStore } from '../../stores/appStore';
import { showToast } from '../../stores/toastStore';
import type { GameBananaItemRef, ModRequirement } from '../../types/gamebanana';
import type { CachedMod } from '../../types/electron';
import type { Mod } from '../../types/mod';
import ModThumbnail from '../ModThumbnail';
import { shouldBlurNsfw } from '../../lib/appSettings';
import { modRestoreKey } from '../../lib/soloRestore';

export function RequirementIdentity({ item, target, installedMod }: { item: ModRequirement; target: GameBananaItemRef | null; installedMod?: Mod }) {
  const { t } = useTranslation();
  const [cached, setCached] = useState<CachedMod | null>(null);
  const settings = useAppStore(state => state.settings);
  const id = target?.id;
  const section = target?.section;
  useEffect(() => {
    if (!id) return;
    let current = true;
    void window.electronAPI.getCachedMod(id).then(mod => {
      if (current) setCached(mod?.section === section ? mod : null);
    }).catch(() => {});
    return () => { current = false; };
  }, [id, section]);
  const open = target ? () => useRequirementsStore.getState().openTarget(target)
    : item.url ? () => window.open(item.url, '_blank', 'noopener,noreferrer') : undefined;
  const label = t(target ? 'requirements.view' : 'requirements.openLink');
  const thumbnailUrl = installedMod?.thumbnailUrl ?? cached?.thumbnailUrl;
  const thumbnail = thumbnailUrl ? <ModThumbnail src={thumbnailUrl} alt="" nsfw={installedMod?.nsfw ?? cached?.isNsfw}
    hideNsfw={shouldBlurNsfw(settings)} className="h-10 w-10 overflow-hidden rounded-sm" width={40} height={40} enableImageContextMenu={false} />
    : <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-hl/5 text-text-muted"><Link2 className="h-4 w-4" /></span>;
  const name = <span className="min-w-0 break-words">{installedMod?.name ?? cached?.name ?? item.name}</span>;
  return <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
    {open ? <button type="button" aria-label={label} onClick={open}
      className="peer/thumbnail shrink-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-accent">{thumbnail}</button>
      : <span className="shrink-0">{thumbnail}</span>}
    <div className="min-w-0 flex-1 text-left peer-hover/thumbnail:text-accent peer-focus-visible/thumbnail:text-accent">
      {open ? <button type="button" onClick={open}
        className={`group/requirement inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left text-sm transition-colors hover:text-accent focus-visible:text-accent focus-visible:outline-2 focus-visible:outline-accent ${cached ? 'font-mod-title leading-snug' : ''}`}>
        {name}<ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-colors group-hover/requirement:text-accent group-focus-visible/requirement:text-accent" aria-hidden />
      </button> : <span className={`text-sm ${cached ? 'font-mod-title leading-snug' : ''}`}>{name}</span>}
      {cached && cached.name !== item.name && <p className="text-xs text-text-secondary break-words">{item.name}</p>}
    </div>
  </div>;
}

export function RequirementsPanel({ source, onLocate }: { source: RequirementSource; onLocate?: (modId: string) => void }) {
  const { t } = useTranslation();
  const mods = useAppStore(s => s.mods);
  const files = useRequirementOrderStore(s => s.files);
  const fixingOrder = useRequirementOrderStore(s => s.fixing);
  const cached = useRequirementsStore(s => s.snapshots[requirementKey(source)]);
  const owner = 'localModId' in source ? mods.find(mod => mod.id === source.localModId) : undefined;
  const snapshot = owner ? skinRequirementSource(owner, mods)?.requirements ?? source.requirements
    : cached && cached.checkedAt >= source.requirements.checkedAt ? cached : source.requirements;
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try { if (!('localModId' in source)) await useRequirementsStore.getState().load([source], true); } finally { setBusy(false); }
  };
  if (snapshot.status === 'loaded' && !snapshot.items.length) return null;
  return <section aria-label={t('requirements.title')}>
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">{t('requirements.title')}</h3>
    <div className="rounded-lg border border-border bg-bg-sunken p-3">
    {snapshot.status === 'unavailable' ? <div className="space-y-3">
      <div className="flex items-start gap-3"><Link2 className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <div><h3 className="text-sm font-semibold">{t('requirements.unavailable')}</h3>
          <p className="mt-0.5 text-xs text-text-secondary">{t('requirements.loadError')}</p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={RefreshCw} isLoading={busy} onClick={() => void retry()}>{t('requirements.retry')}</Button>
        {!('localModId' in source) && <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => window.open(`https://gamebanana.com/${source.section === 'Sound' ? 'sounds' : source.section === 'Wip' ? 'wips' : 'mods'}/${source.id}`, '_blank', 'noopener,noreferrer')}>{t('requirements.gamebanana')}</Button>}
      </div>
    </div> : <ul>
    {snapshot.items.map((item, index) => {
      // Optional links still offer actions without becoming install blockers.
      const match = matchRequirement({ ...item, importance: 'required' }, mods);
      const target = item.url ? parseGameBananaItemUrl(item.url) : null;
      const disabled = match.state === 'disabled' ? match.matches.find(m => !m.enabled) : undefined;
      const order = onLocate ? installedRequirementOrder(source, item, mods) : [];
      const orderIssue = requirementOrderIssues(source, { ...snapshot, items: [item] }, mods, files)[0];
      const fixOrder = async () => {
        if (!orderIssue) return;
        setBusy(true);
        try {
          const result = await useRequirementOrderStore.getState().fix(orderIssue);
          if (result === 'changed') await useAppStore.getState().loadMods({ force: true });
          showToast(t(result === 'fixed' ? 'requirements.orderFixed' : 'requirements.orderChanged'), { tone: result === 'fixed' ? 'success' : 'warning' });
        } catch (error) { showToast(String(error), { tone: 'error' }); }
        finally { setBusy(false); }
      };
      const enable = async () => {
        if (!disabled) return;
        setBusy(true);
        try {
          const mod = useAppStore.getState().mods.find(mod => mod.id === disabled.modId);
          if (mod) await useAppStore.getState().setModEnabledStates([{ key: modRestoreKey(mod), enabled: true }]);
        }
        catch (error) { showToast(String(error), { tone: 'error' }); }
        finally { setBusy(false); }
      };
      return <li key={`${item.name}:${index}`} className={`space-y-3 ${index > 0 ? 'mt-3 border-t border-border pt-3' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
        <RequirementIdentity item={item} target={target} />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          <Tag tone={item.importance === 'required' ? 'danger' : item.importance === 'recommended' ? 'warning' : item.importance === 'optional' ? 'info' : 'neutral'} className="shrink-0">
            {item.importance === 'required' ? t('requirements.required') : item.importance === 'recommended' ? t('requirements.recommended')
              : item.importance === 'optional' ? t('requirements.optional') : t('requirements.review')}
          </Tag>
          {onLocate && match.matches.length > 0 && order.length === 0 && <Button size="sm" variant="ghost" onClick={() => onLocate(match.matches[0].modId)}>{t('requirements.locate')}</Button>}
          {disabled && <Button variant="secondary" icon={Check} className="min-w-[110px] max-w-full" isLoading={busy} onClick={() => void enable()}>{t('requirements.enable')}</Button>}
        </div>
        </div>
        {orderIssue && <div className="space-y-3 border-t border-border pt-3" role="status">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-state-warning" /><div>
            <p className="text-sm font-semibold text-state-warning">{t('requirements.orderWarning')}</p>
            <p className="mt-1 text-xs text-text-secondary">{t(orderIssue.fixable ? 'requirements.orderFixHint' : 'requirements.orderGlobalHint')}</p>
          </div></div>
          <Button size="sm" variant="secondary" icon={ArrowUp} disabled={!orderIssue.fixable || fixingOrder} isLoading={busy} onClick={() => void fixOrder()}>{t('requirements.fixOrder')}</Button>
        </div>}
        {(item.state === 'off' || match.state === 'manual') && <p className="text-xs text-text-secondary">{item.state === 'off' ? t('requirements.mustBeOff') : t('requirements.manual')}</p>}
        {order.length > 0 && <details className="group border-t border-border text-sm">
          <summary className="flex cursor-pointer items-center gap-3 pt-3 text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"><ArrowDownUp className="h-4 w-4" />{t('requirements.loadOrder')}<ChevronRight className="ml-auto h-3 w-3 transition-transform group-open:rotate-90" /></summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-text-secondary">{t('requirements.orderHint')}</p>
            <ol className="space-y-1 border-l border-border pl-3">{order.map(mod => <li key={mod.id} className="min-w-0 break-words">{mod.name}</li>)}</ol>
            {onLocate && <Button size="sm" variant="secondary" onClick={() => onLocate(order[0].id)}>{t('requirements.locateOrder')}</Button>}
          </div>
        </details>}
      </li>;
    })}
    </ul>}
    </div>
  </section>;
}
