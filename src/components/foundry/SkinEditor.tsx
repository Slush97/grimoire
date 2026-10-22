import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, RotateCcw, Download } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import { Input, Select } from '../common/forms';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useAppStore } from '../../stores/appStore';
import { canonicalHeroName, inferHeroFromTitle, isLockerManagedMod } from '../../lib/lockerUtils';
import { editedPartCount, materialBasename } from '../../lib/skinParts';
import type { HeroPoseSkinSource } from '../../types/portrait';
import type { SkinEditInfo, SkinPartEdit } from '../../types/skinEditor';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
const NO_SOURCES: HeroPoseSkinSource[] = [];
const NO_EDITS: SkinPartEdit[] = [];

export default function SkinEditor({ heroName, initialSkinSources = NO_SOURCES }: {
  heroName: string; initialSkinSources?: HeroPoseSkinSource[];
}) {
  const { t } = useTranslation();
  const mods = useAppStore((state) => state.mods);
  const available = useMemo(() => mods.filter((mod) => isLockerManagedMod(mod)
    && canonicalHeroName(mod.lockerHero ?? inferHeroFromTitle(mod.name) ?? '') === canonicalHeroName(heroName)), [mods, heroName]);
  const [selection, setSelection] = useState(initialSkinSources.length ? 'equipped' : 'vanilla');
  const sources = useMemo(() => selection === 'equipped' ? initialSkinSources : selection === 'vanilla' ? NO_SOURCES
    : [{ metaKey: selection, priority: available.find((mod) => mod.metaKey === selection)?.priority ?? 0 }], [selection, initialSkinSources, available]);
  const sourceKey = sources.map((source) => `${source.metaKey}:${source.priority}`).join('|');
  return (
    <section className="space-y-3" aria-label={t('foundry.skin.title')}>
      <label className="flex max-w-sm items-center gap-3 text-sm text-text-secondary">
        <span className="shrink-0">{t('foundry.skin.source')}</span>
        <Select value={selection} onChange={(event) => setSelection(event.target.value)}>
          <option value="vanilla">{t('foundry.skin.originalGame')}</option>
          {initialSkinSources.length > 0 && <option value="equipped">{t('foundry.skin.equipped')}</option>}
          {available.map((mod) => <option key={mod.metaKey} value={mod.metaKey}>{mod.name}</option>)}
        </Select>
      </label>
      <SkinEditorSession key={`${heroName}:${sourceKey}`} heroName={heroName} sources={sources} />
    </section>
  );
}

export function SkinEditorSession({ heroName, sources }: { heroName: string; sources: HeroPoseSkinSource[] }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SkinEditInfo | null>(null);
  const [edits, setEdits] = useState<SkinPartEdit[]>([]);
  const [comparison, setComparison] = useState<'original' | 'edited'>('edited');
  const [search, setSearch] = useState('');
  const [highlightedPart, setHighlightedPart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getSkinEditInfo({ heroName, skinSources: sources }).then((value) => {
      if (!cancelled) setInfo(value);
    }).catch((reason: unknown) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [heroName, sources]);
  const count = editedPartCount(edits);
  const hiddenCount = edits.filter((edit) => edit.hidden).length;
  const visibleParts = info?.parts.filter((part) => part.label.toLowerCase().includes(search.toLowerCase()) || part.material.toLowerCase().includes(search.toLowerCase())) ?? [];
  const update = (material: string, patch: Partial<Pick<SkinPartEdit, 'hidden' | 'tint'>>) => {
    setSaved(false);
    setComparison('edited');
    setEdits((current) => {
      const next = { ...(current.find((edit) => edit.material === material) ?? { material, hidden: false, tint: null }), ...patch };
      return [...current.filter((edit) => edit.material !== material), next].filter((edit) => edit.hidden || edit.tint !== null);
    });
  };
  const exportVpk = async () => {
    if (!info) return;
    setExporting(true);
    setError(null);
    try {
      const result = await window.electronAPI.exportSkinEdits({ heroName, skinSources: sources, fingerprint: info.fingerprint, edits });
      setSaved(result.exported);
    } catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  };
  return (
    <div className="@container space-y-3">
      <div className="grid gap-4 @min-[640px]:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 space-y-2">
          <SegmentedControl label={t('foundry.skin.compare')} value={comparison} onChange={setComparison}
            options={[{ value: 'original', label: t('foundry.skin.original') }, { value: 'edited', label: t('foundry.skin.edited') }]} />
          <div className="relative min-h-96 overflow-hidden rounded-sm border border-border bg-bg-sunken" style={{ height: 'min(64vh, 720px)' }}>
          <ErrorBoundary><Suspense fallback={<p role="status" className="p-4 text-sm text-text-secondary">{t('foundry.skin.loading')}</p>}>
            <HeroPoseViewer heroName={heroName} skinSources={sources} partEdits={comparison === 'original' ? NO_EDITS : edits} highlightedPart={highlightedPart} />
          </Suspense></ErrorBoundary>
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-3 rounded-sm border border-border bg-bg-secondary p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">{t('foundry.skin.parts')}</h3>
            <span className="text-xs tabular-nums text-text-secondary">{t('foundry.skin.changed', { count })}</span>
          </div>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('foundry.skin.search')} aria-label={t('foundry.skin.search')} />
          {hiddenCount > 0 && <Button size="sm" variant="ghost" icon={Eye} disabled={exporting} onClick={() => {
            setEdits((current) => current.filter((edit) => edit.tint !== null).map((edit) => ({ ...edit, hidden: false })));
            setSaved(false); setComparison('edited');
          }}>{t('foundry.skin.showAll')}</Button>}
          <div className="max-h-96 flex-1 space-y-1 overflow-y-auto" onMouseLeave={() => setHighlightedPart(null)}>
            {!info && !error && <p role="status" className="text-sm text-text-secondary">{t('foundry.skin.loading')}</p>}
            {info && visibleParts.length === 0 && <p className="py-4 text-sm text-text-secondary">{t('foundry.skin.noResults')}</p>}
            {visibleParts.map((part) => {
              const edit = edits.find((item) => item.material === part.material);
              const ambiguous = info?.parts.filter((item) => materialBasename(item.material) === materialBasename(part.material)).length !== 1;
              const lastVisible = !edit?.hidden && (info?.parts.length ?? 0) - hiddenCount <= 1;
              return (
                <div key={part.material} className={`flex items-center gap-2 rounded-sm border p-2 transition-colors ${highlightedPart === part.material ? 'border-accent bg-hl/5' : 'border-transparent bg-bg-tertiary'}`} title={part.material}
                  onMouseEnter={() => setHighlightedPart(ambiguous ? null : part.material)}
                  onFocusCapture={() => setHighlightedPart(ambiguous ? null : part.material)}
                  onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHighlightedPart(null); }}>
                  <IconButton size="sm" icon={edit?.hidden ? EyeOff : Eye} disabled={ambiguous || exporting || lastVisible}
                    label={t(edit?.hidden ? 'foundry.skin.showPart' : 'foundry.skin.hidePart', { part: part.label })}
                    aria-pressed={!edit?.hidden} onClick={() => update(part.material, { hidden: !edit?.hidden })} />
                  <span className={`min-w-0 flex-1 break-words text-xs ${edit?.hidden ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{part.label}
                    {edit && <span className="mt-1 block text-2xs text-text-secondary">{t(edit.hidden ? 'foundry.skin.hidden' : 'foundry.skin.recolored')}</span>}
                  </span>
                  <input type="color" value={edit?.tint ?? '#ffffff'} disabled={ambiguous || !part.tintable || edit?.hidden || exporting}
                    title={part.tintable ? undefined : t('foundry.skin.tintUnsupported')}
                    aria-label={t('foundry.skin.tintPart', { part: part.label })} className="h-7 w-7 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent disabled:opacity-40"
                    onChange={(event) => update(part.material, { tint: event.target.value })} />
                  <IconButton size="sm" icon={RotateCcw} disabled={!edit || exporting} label={t('foundry.skin.resetPart', { part: part.label })}
                    onClick={() => update(part.material, { hidden: false, tint: null })} />
                </div>
              );
            })}
          </div>
          <Button variant="ghost" icon={RotateCcw} disabled={count === 0 || exporting} onClick={() => { setEdits([]); setSaved(false); setComparison('edited'); }}>{t('foundry.skin.reset')}</Button>
          <Button icon={Download} disabled={!info || count === 0} isLoading={exporting} onClick={() => { void exportVpk(); }}>{t('foundry.skin.export')}</Button>
          <p className="text-xs text-text-secondary">{t(sources.length ? 'foundry.skin.overlayDependency' : 'foundry.skin.overlayVanilla')}</p>
          {saved && <p role="status" className="text-xs text-state-success">{t('foundry.skin.saved')}</p>}
          <details className="border-t border-border pt-3 text-xs text-text-secondary">
            <summary className="cursor-pointer">{t('foundry.skin.details')}</summary>
            <p className="mt-2">{t('foundry.skin.materialGroups')}</p>
            {info && <p className="mt-2 break-all font-mono text-2xs text-text-tertiary">{info.entry}</p>}
          </details>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-state-danger">{error}</p>}
    </div>
  );
}
