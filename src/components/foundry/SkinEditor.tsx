import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, RotateCcw, Download } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { Button, IconButton, SegmentedControl, Toggle } from '../common/ui';
import { Input, Select } from '../common/forms';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { SkinPatternPicker } from './SkinPatternPicker';
import { useAppStore } from '../../stores/appStore';
import { canonicalHeroName, inferHeroFromTitle, isLockerManagedMod } from '../../lib/lockerUtils';
import { editedPartCount, materialBasename } from '../../lib/skinParts';
import type { HeroPoseSkinSource } from '../../types/portrait';
import type { SkinEditInfo, SkinPart, SkinPartEdit } from '../../types/skinEditor';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
const NO_SOURCES: HeroPoseSkinSource[] = [];
const NO_EDITS: SkinPartEdit[] = [];

export default function SkinEditor({ heroName, initialSkinSources = NO_SOURCES }: { heroName: string; initialSkinSources?: HeroPoseSkinSource[] }) {
  const { t } = useTranslation();
  const mods = useAppStore((state) => state.mods);
  const available = useMemo(() => mods.filter((mod) => isLockerManagedMod(mod)
    && canonicalHeroName(mod.lockerHero ?? inferHeroFromTitle(mod.name) ?? '') === canonicalHeroName(heroName)), [mods, heroName]);
  const [selection, setSelection] = useState(initialSkinSources.length ? 'equipped' : 'vanilla');
  const sources = useMemo(() => selection === 'equipped' ? initialSkinSources : selection === 'vanilla' ? NO_SOURCES
    : [{ metaKey: selection, priority: available.find((mod) => mod.metaKey === selection)?.priority ?? 0 }], [selection, initialSkinSources, available]);
  const sourceKey = sources.map((source) => `${source.metaKey}:${source.priority}`).join('|');
  return <SkinEditorSession key={`${heroName}:${sourceKey}`} heroName={heroName} sources={sources} sourceControl={
    <label className="flex min-w-0 max-w-sm items-center gap-2 text-xs text-text-secondary">
      <span>{t('foundry.skin.source')}</span>
      <Select inputSize="sm" value={selection} onChange={(event) => setSelection(event.target.value)}>
        <option value="vanilla">{t('foundry.skin.originalGame')}</option>
        {initialSkinSources.length > 0 && <option value="equipped">{t('foundry.skin.equipped')}</option>}
        {available.map((mod) => <option key={mod.metaKey} value={mod.metaKey}>{mod.name}</option>)}
      </Select>
    </label>
  } />;
}

export function SkinEditorSession({ heroName, sources, sourceControl }: { heroName: string; sources: HeroPoseSkinSource[]; sourceControl?: ReactNode }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SkinEditInfo | null>(null);
  const [edits, setEdits] = useState<SkinPartEdit[]>([]);
  const [comparison, setComparison] = useState<'original' | 'edited'>('edited');
  const [search, setSearch] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(true);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [tool, setTool] = useState<'color' | 'pattern'>('color');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getSkinEditInfo({ heroName, skinSources: sources }).then((value) => { if (!cancelled) setInfo(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [heroName, sources]);
  const count = editedPartCount(edits);
  const hiddenCount = edits.filter((edit) => edit.hidden).length;
  const selected = info?.parts.find((part) => part.material === selectedMaterial)
    ?? info?.parts.find((part) => /\b(coat|body|shape)$/.test(part.label) && !part.label.includes('lower')) ?? info?.parts[0];
  const selectedEdit = edits.find((edit) => edit.material === selected?.material);
  const colorOf = (part: SkinPart) => edits.find((edit) => edit.material === part.material)?.tint ?? colors[materialBasename(part.material)] ?? '#ffffff';
  const nameOf = (part: SkinPart) => {
    const prefix = `${heroName.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    let label = part.label.startsWith(prefix) ? part.label.slice(prefix.length) : part.label;
    if (label === 'shape') return t('foundry.skin.body');
    if (label.startsWith('shape ')) label = label.slice(6);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const ambiguous = (part: SkinPart) => info?.parts.filter((item) => materialBasename(item.material) === materialBasename(part.material)).length !== 1;
  const visibleParts = info?.parts.filter((part) => nameOf(part).toLowerCase().includes(search.toLowerCase())) ?? [];
  const update = (material: string, patch: Partial<Pick<SkinPartEdit, 'hidden' | 'tint' | 'pattern'>>) => {
    setSaved(false); setComparison('edited');
    setEdits((current) => {
      const next = { ...(current.find((edit) => edit.material === material) ?? { material, hidden: false, tint: null, pattern: null }), ...patch };
      return [...current.filter((edit) => edit.material !== material), next].filter((edit) => edit.hidden || edit.tint !== null || edit.pattern !== null && edit.pattern !== undefined);
    });
  };
  const exportVpk = async () => {
    if (!info) return;
    setExporting(true); setError(null);
    try { setSaved((await window.electronAPI.exportSkinEdits({ heroName, skinSources: sources, fingerprint: info.fingerprint, edits })).exported); }
    catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  };
  return <section className="@container space-y-3" aria-label={t('foundry.skin.title')}>
    <div className="flex flex-wrap items-center gap-3">
      {sourceControl}
      <div className="flex-1" />
      {count > 0 && <span className="text-xs tabular-nums text-text-secondary">{t('foundry.skin.changed', { count })}</span>}
      <SegmentedControl label={t('foundry.skin.compare')} value={comparison} onChange={setComparison}
        options={[{ value: 'original', label: t('foundry.skin.original') }, { value: 'edited', label: t('foundry.skin.edited') }]} />
      <IconButton icon={RotateCcw} label={t('foundry.skin.reset')} disabled={!count || exporting} onClick={() => { setEdits([]); setSaved(false); setComparison('edited'); }} />
      <Button size="sm" icon={Download} disabled={!info || !count} isLoading={exporting} onClick={() => { void exportVpk(); }}>{t('foundry.skin.export')}</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
        {(info?.parts.length ?? 0) > 10 && <Input inputSize="sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('foundry.skin.search')} aria-label={t('foundry.skin.search')} />}
        <div role="group" className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1" aria-label={t('foundry.skin.parts')}>
          {!info && !error && <p role="status" className="text-xs text-text-secondary">{t('foundry.skin.loading')}</p>}
          {info && !visibleParts.length && <p className="text-xs text-text-secondary">{t('foundry.skin.noResults')}</p>}
          {visibleParts.map((part) => {
            const edit = edits.find((edit) => edit.material === part.material);
            const active = selected?.material === part.material;
            return <div key={part.material} className={`flex min-w-28 shrink-0 items-center gap-1 rounded-sm border ${active ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-hl/5'}`}>
              <IconButton size="sm" icon={edit?.hidden ? EyeOff : Eye} disabled={ambiguous(part) || exporting || !edit?.hidden && (info?.parts.length ?? 0) - hiddenCount <= 1}
                label={t(edit?.hidden ? 'foundry.skin.showPart' : 'foundry.skin.hidePart', { part: nameOf(part) })} aria-pressed={!edit?.hidden}
                onClick={() => { setSelectedMaterial(part.material); update(part.material, { hidden: !edit?.hidden }); }} />
              <button type="button" aria-pressed={active} onClick={() => setSelectedMaterial(part.material)}
                className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs">
                <span className={`min-w-0 flex-1 whitespace-nowrap ${edit?.hidden ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{nameOf(part)}</span>
                <span className="h-4 w-4 shrink-0 rounded-sm border border-border" style={{ backgroundColor: colorOf(part) }} />
              </button>
            </div>;
          })}
        </div>
        {hiddenCount > 0 && <Button size="sm" variant="ghost" icon={Eye} disabled={exporting} onClick={() => {
          setEdits((current) => current.map((edit) => ({ ...edit, hidden: false })).filter((edit) => edit.tint !== null || edit.pattern)); setSaved(false); setComparison('edited');
        }}>{t('foundry.skin.showAll')}</Button>}
    </div>
    <div className="grid items-start gap-3 @min-[640px]:grid-cols-[minmax(0,1fr)_288px]">
      <div className="relative min-h-96 overflow-hidden rounded-sm border border-border bg-bg-sunken" style={{ height: 'min(62vh, 720px)' }}>
        <ErrorBoundary><Suspense fallback={<p role="status" className="p-4 text-sm text-text-secondary">{t('foundry.skin.loading')}</p>}>
          <HeroPoseViewer heroName={heroName} skinSources={sources} partEdits={comparison === 'original' ? NO_EDITS : edits}
            highlightedPart={highlight && selected && !ambiguous(selected) && !selectedEdit?.hidden ? selected.material : null}
            onPartColors={setColors} onPartPick={(name) => { const part = info?.parts.find((part) => materialBasename(part.material) === materialBasename(name)); if (part) setSelectedMaterial(part.material); }} />
        </Suspense></ErrorBoundary>
      </div>
      <aside className="space-y-3 rounded-sm border border-border bg-bg-secondary p-3">
        {selected && <div className="space-y-2">
          <div className="flex items-start justify-between gap-2"><h4 className="text-sm font-semibold">{nameOf(selected)}</h4>
            <IconButton size="sm" icon={RotateCcw} disabled={!selectedEdit || exporting} label={t('foundry.skin.resetPart', { part: nameOf(selected) })}
              onClick={() => update(selected.material, { hidden: false, tint: null, pattern: null })} />
          </div>
          <Toggle label={t('foundry.skin.highlight')} checked={highlight} onChange={setHighlight} />
          {selectedEdit?.hidden && <p className="text-xs text-text-secondary">{t('foundry.skin.hidden')}</p>}
          <SegmentedControl value={tool} onChange={setTool} options={[{ value: 'color', label: t('foundry.skin.color') }, { value: 'pattern', label: t('foundry.skin.pattern') }]} />
          {tool === 'color' ? <div className="space-y-2">
            {selected.tintable && <div inert={ambiguous(selected) || !!selectedEdit?.hidden || exporting}
              className={`[&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm ${selectedEdit?.hidden || exporting ? 'opacity-40' : ''}`}>
              <HexColorPicker color={colorOf(selected)} onChange={(tint) => update(selected.material, { tint })}
                aria-label={t('foundry.skin.color')} style={{ width: '100%', height: 160 }} />
            </div>}
            <label className="flex items-center gap-3 rounded-sm border border-border bg-bg-tertiary p-3">
              <input type="color" value={colorOf(selected)} disabled={ambiguous(selected) || !selected.tintable || selectedEdit?.hidden || exporting}
                aria-label={t('foundry.skin.tintPart', { part: nameOf(selected) })} className="h-10 w-12 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent disabled:opacity-40"
                onChange={(event) => update(selected.material, { tint: event.target.value })} />
              <span className="text-sm tabular-nums text-text-primary">{colorOf(selected).toUpperCase()}</span>
            </label>
            {!selected.tintable && <p className="text-xs text-text-secondary">{t('foundry.skin.tintUnsupported')}</p>}
          </div> : selected.patternable ? <SkinPatternPicker value={selectedEdit?.pattern ?? null} disabled={ambiguous(selected) || !!selectedEdit?.hidden || exporting}
            onChange={(pattern) => update(selected.material, { pattern })} /> : <p className="text-xs text-text-secondary">{t('foundry.skin.patternUnsupported')}</p>}
        </div>}
      </aside>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
      <p>{t(sources.length ? 'foundry.skin.overlayDependency' : 'foundry.skin.overlayVanilla')}</p>
      {saved && <p role="status" className="text-state-success">{t('foundry.skin.saved')}</p>}
    </div>
    {error && <p role="alert" className="text-sm text-state-danger">{error}</p>}
  </section>;
}
