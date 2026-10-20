import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Button, Tag } from '../common/ui';
import { parseGameBananaItemUrl, type ModRequirementSource } from '../../types/gamebanana';
import { matchRequirement, requirementKey } from '../../lib/modRequirements';
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
  return <div className="flex items-center gap-3">
    {cached?.thumbnailUrl && <ModThumbnail src={cached.thumbnailUrl} alt="" nsfw={cached.isNsfw}
      hideNsfw={shouldBlurNsfw(settings)} className="h-12 w-12 shrink-0 overflow-hidden rounded-sm" width={48} height={48} enableImageContextMenu={false} />}
    <div className="min-w-0"><p className={cached ? 'font-mod-title text-base break-words' : 'text-sm break-words'}>{cached?.name ?? item.name}</p>
      {cached && cached.name !== item.name && <p className="mt-1 text-xs text-text-secondary break-words">{item.name}</p>}</div>
  </div>;
}

export function RequirementsPanel({ source, onLocate }: { source: ModRequirementSource; onLocate?: (modId: string) => void }) {
  const { t } = useTranslation();
  const mods = useAppStore(s => s.mods);
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
    <section className="rounded-sm border border-border bg-bg-sunken p-4 space-y-3" aria-label={t('requirements.title')}>
      <h3 className="text-sm font-semibold">{t('requirements.unavailable')}</h3>
      <p className="text-xs text-text-secondary">{t('requirements.loadError')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={RefreshCw} isLoading={busy} onClick={() => void retry()}>{t('requirements.retry')}</Button>
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
      const enable = async () => {
        if (!disabled) return;
        setBusy(true);
        try { await useAppStore.getState().toggleMod(disabled.modId); }
        catch (error) { showToast(String(error), { tone: 'error' }); }
        finally { setBusy(false); }
      };
      return <div key={`${item.name}:${index}`} className={`rounded-sm border bg-bg-sunken p-4 space-y-3 ${issue ? 'border-state-warning/30' : 'border-border'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 shrink-0" />{item.importance === 'optional' ? t('requirements.optional') : item.importance === 'unknown' ? t('requirements.review') : t('requirements.required')}</div>
          <Tag tone={issue ? 'warning' : 'neutral'}>{states[match.state]}</Tag>
        </div>
        <RequirementIdentity item={item} target={target} />
        {item.state === 'off' && <p className="text-xs text-text-secondary">{t('requirements.mustBeOff')}</p>}
        {match.state === 'manual' && <p className="text-xs text-text-secondary">{t('requirements.manual')}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {disabled && <Button size="sm" variant="primary" icon={Check} isLoading={busy} onClick={() => void enable()}>{t('requirements.enable')}</Button>}
          {target ? <Button size="sm" variant={!disabled && issue ? 'primary' : 'secondary'} onClick={() => useRequirementsStore.getState().openTarget(target)}>{t('requirements.view')}</Button>
            : url && <Button size="sm" icon={ExternalLink} onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>{t('requirements.openLink')}</Button>}
          {onLocate && match.matches.length > 0 && <Button size="sm" variant="ghost" onClick={() => onLocate(match.matches[0].modId)}>{t('requirements.locate')}</Button>}
        </div>
      </div>;
    })}
  </section>;
}
