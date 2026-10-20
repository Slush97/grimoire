import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDownUp, ArrowUp, ArrowUpRight, Check, ChevronRight, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Button, Tag } from '../common/ui';
import { parseGameBananaItemUrl, type ModRequirementSource } from '../../types/gamebanana';
import { matchRequirement, requirementKey } from '../../lib/modRequirements';
import { installedRequirementOrder, requirementOrderIssues } from '../../lib/requirementLoadOrder';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useAppStore } from '../../stores/appStore';
import { showToast } from '../../stores/toastStore';
import type { GameBananaItemRef, ModRequirement } from '../../types/gamebanana';
import type { CachedMod } from '../../types/electron';
import ModThumbnail from '../ModThumbnail';
import { shouldBlurNsfw } from '../../lib/appSettings';

function RequirementIdentity({ item, target }: { item: ModRequirement; target: GameBananaItemRef | null }) {
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
  return <>
    {cached?.thumbnailUrl && <ModThumbnail src={cached.thumbnailUrl} alt="" nsfw={cached.isNsfw}
      hideNsfw={shouldBlurNsfw(settings)} className="h-14 w-14 shrink-0 overflow-hidden rounded-sm" width={56} height={56} enableImageContextMenu={false} />}
    {!cached?.thumbnailUrl && <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm bg-hl/5 text-text-muted"><Link2 className="h-5 w-5" /></span>}
    <span className="min-w-0 flex-1 text-left"><span className={cached ? 'block font-mod-title text-lg leading-snug break-words' : 'block text-sm break-words'}>{cached?.name ?? item.name}</span>
      {cached && cached.name !== item.name && <span className="mt-1 block text-xs text-text-secondary break-words">{item.name}</span>}</span>
  </>;
}

export function RequirementsPanel({ source, onLocate }: { source: ModRequirementSource; onLocate?: (modId: string) => void }) {
  const { t } = useTranslation();
  const mods = useAppStore(s => s.mods);
  const files = useRequirementOrderStore(s => s.files);
  const fixingOrder = useRequirementOrderStore(s => s.fixing);
  const cached = useRequirementsStore(s => s.snapshots[requirementKey(source)]);
  const snapshot = cached && cached.checkedAt >= source.requirements.checkedAt ? cached : source.requirements;
  const [busy, setBusy] = useState(false);
  const states = { enabled: t('requirements.state.enabled'), disabled: t('requirements.state.disabled'),
    missing: t('requirements.state.missing'), met: t('requirements.state.met'), manual: t('requirements.state.manual'), optional: t('requirements.state.optional') };
  const retry = async () => {
    setBusy(true);
    try { await useRequirementsStore.getState().load([source], true); } finally { setBusy(false); }
  };
  if (snapshot.status === 'loaded' && !snapshot.items.length) return null;
  if (snapshot.status === 'unavailable') return (
    <section className="space-y-4 py-1" aria-label={t('requirements.title')}>
      <div className="flex items-start gap-3"><Link2 className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <div><h3 className="text-sm font-semibold">{t('requirements.unavailable')}</h3>
          <p className="mt-1 text-sm text-text-secondary">{t('requirements.loadError')}</p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={RefreshCw} isLoading={busy} onClick={() => void retry()}>{t('requirements.retry')}</Button>
        <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => window.open(`https://gamebanana.com/${source.section === 'Sound' ? 'sounds' : source.section === 'Wip' ? 'wips' : 'mods'}/${source.id}`, '_blank', 'noopener,noreferrer')}>{t('requirements.gamebanana')}</Button>
      </div>
    </section>
  );
  return <section className="space-y-3" aria-label={t('requirements.title')}>
    {snapshot.items.map((item, index) => {
      const match = matchRequirement(item, mods);
      const target = item.url ? parseGameBananaItemUrl(item.url) : null;
      const url = item.url;
      const disabled = match.state === 'disabled' ? match.matches.find(m => !m.enabled) : undefined;
      const issue = ['missing', 'disabled', 'manual'].includes(match.state);
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
        try { await useAppStore.getState().toggleMod(disabled.modId); }
        catch (error) { showToast(String(error), { tone: 'error' }); }
        finally { setBusy(false); }
      };
      const identity = <RequirementIdentity item={item} target={target} />;
      return <div key={`${item.name}:${index}`} className="overflow-hidden rounded-sm border border-border bg-bg-sunken">
        <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xs text-text-secondary">{item.importance === 'optional' ? t('requirements.optional') : item.importance === 'unknown' ? t('requirements.review') : t('requirements.required')}</h3>
          <Tag tone={issue || orderIssue ? 'warning' : 'neutral'}>{orderIssue ? t('requirements.orderState') : states[match.state]}</Tag>
        </div>
        </div>
        {target || url ? <button type="button" className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-text-primary transition-colors hover:bg-hl/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          aria-label={target ? t('requirements.view') : t('requirements.openLink')} onClick={() => target ? useRequirementsStore.getState().openTarget(target) : url && window.open(url, '_blank', 'noopener,noreferrer')}>
          {identity}{target ? <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" /> : <ArrowUpRight className="h-4 w-4 shrink-0 text-text-muted" />}
        </button> : <div className="flex items-center gap-3 px-4 py-3">{identity}</div>}
        {orderIssue && <div className="space-y-3 border-t border-border px-4 py-3" role="status">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-state-warning" /><div>
            <p className="text-sm font-semibold text-state-warning">{t('requirements.orderWarning')}</p>
            <p className="mt-1 text-xs text-text-secondary">{t(orderIssue.fixable ? 'requirements.orderFixHint' : 'requirements.orderGlobalHint')}</p>
          </div></div>
          <Button size="sm" variant="secondary" icon={ArrowUp} disabled={!orderIssue.fixable || fixingOrder} isLoading={busy} onClick={() => void fixOrder()}>{t('requirements.fixOrder')}</Button>
        </div>}
        {(item.state === 'off' || match.state === 'manual') && <p className="px-4 pb-3 text-xs text-text-secondary">{item.state === 'off' ? t('requirements.mustBeOff') : t('requirements.manual')}</p>}
        {(disabled || (onLocate && match.matches.length > 0 && order.length === 0)) && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {onLocate && match.matches.length > 0 && order.length === 0 && <Button size="sm" variant="ghost" onClick={() => onLocate(match.matches[0].modId)}>{t('requirements.locate')}</Button>}
          {disabled && <Button size="sm" variant="secondary" icon={Check} isLoading={busy} onClick={() => void enable()}>{t('requirements.enable')}</Button>}
        </div>}
        {order.length > 0 && <details className="group border-t border-border text-sm">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"><ArrowDownUp className="h-4 w-4" />{t('requirements.loadOrder')}<ChevronRight className="ml-auto h-3 w-3 transition-transform group-open:rotate-90" /></summary>
          <div className="space-y-3 px-4 pb-4">
            <p className="text-xs text-text-secondary">{t('requirements.orderHint')}</p>
            <ol className="space-y-2 border-l border-border pl-3">{order.map(mod => <li key={mod.id} className="min-w-0 break-words">{mod.name}</li>)}</ol>
            {onLocate && <Button size="sm" variant="secondary" onClick={() => onLocate(order[0].id)}>{t('requirements.locateOrder')}</Button>}
          </div>
        </details>}
      </div>;
    })}
  </section>;
}
