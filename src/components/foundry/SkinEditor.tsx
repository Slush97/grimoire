import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, RotateCcw, Download } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import { Input, Select } from '../common/forms';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { SkinPatternPicker } from './SkinPatternPicker';
import { SkinColorControls } from './SkinColorControls';
import { adjustSkinPixels, hasSkinPartEdit, ORIGINAL_SKIN_COLOR } from '../../lib/skinColorAdjustments';
import { useAppStore } from '../../stores/appStore';
import { canonicalHeroName, inferHeroFromTitle, isLockerManagedMod } from '../../lib/lockerUtils';
import { editedPartCount, materialBasename } from '../../lib/skinParts';
import { isGlobalSkinSource } from '../../lib/skinEditSchema';
import type { HeroPoseSkinSource } from '../../types/portrait';
import type { SkinEditInfo, SkinPart, SkinPartEdit, SkinPartTexture } from '../../types/skinEditor';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
const NO_SOURCES: HeroPoseSkinSource[] = [];
const NO_EDITS: SkinPartEdit[] = [];

export default function SkinEditor({ heroName, initialSkinSources = NO_SOURCES, onDirtyChange }: {
  heroName: string; initialSkinSources?: HeroPoseSkinSource[]; onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const mods = useAppStore((state) => state.mods);
  const available = useMemo(() => mods.filter((mod) => isLockerManagedMod(mod) && !isGlobalSkinSource(mod)
    && canonicalHeroName(mod.lockerHero ?? inferHeroFromTitle(mod.name) ?? '') === canonicalHeroName(heroName)), [mods, heroName]);
  const equippedGlobal = initialSkinSources.some(isGlobalSkinSource);
  const equippedEditable = initialSkinSources.length > 0 && !equippedGlobal;
  // Sources live in state, so a mods-store refresh does not reload every part.
  const [selection, setSelection] = useState(() => ({
    value: equippedEditable ? 'equipped' : 'vanilla', equipped: initialSkinSources,
    sources: equippedEditable ? initialSkinSources : NO_SOURCES, session: 0,
  }));
  const select = (value: string) => setSelection((current) => ({ ...current, value, session: current.session + 1,
    sources: value === 'equipped' ? current.equipped : value === 'vanilla' ? NO_SOURCES
      : [{ metaKey: value, priority: available.find((mod) => mod.metaKey === value)?.priority ?? 0 }] }));
  // Saving can enable and repack mods; follow them so the session stays on the same skin.
  const followRenames = (renamed: Record<string, HeroPoseSkinSource>) => setSelection((current) => {
    const remap = (sources: HeroPoseSkinSource[]) => sources.some((source) => renamed[source.metaKey])
      ? sources.map((source) => renamed[source.metaKey] ?? source) : sources;
    return { ...current, value: renamed[current.value]?.metaKey ?? current.value, equipped: remap(current.equipped), sources: remap(current.sources) };
  });
  return <>
    {equippedGlobal && <p role="status" className="text-xs text-state-warning">{t('foundry.skin.globalUnsupported')}</p>}
    <SkinEditorSession key={selection.session} heroName={heroName} sources={selection.sources} onSaved={followRenames} onDirtyChange={onDirtyChange} sourceControl={
      <label className="flex min-w-0 max-w-sm items-center gap-2 text-xs text-text-secondary">
        <span>{t('foundry.skin.source')}</span>
        <Select inputSize="sm" value={selection.value} onChange={(event) => select(event.target.value)}>
          <option value="vanilla">{t('foundry.skin.originalGame')}</option>
          {equippedEditable && <option value="equipped">{t('foundry.skin.equipped')}</option>}
          {available.map((mod) => <option key={mod.metaKey} value={mod.metaKey}>{mod.name}</option>)}
        </Select>
      </label>
    } />
  </>;
}

export function SkinEditorSession({ heroName, sources, sourceControl, onSaved, onDirtyChange }: {
  heroName: string; sources: HeroPoseSkinSource[]; sourceControl?: ReactNode;
  onSaved?: (renamed: Record<string, HeroPoseSkinSource>) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ sources: HeroPoseSkinSource[]; info: SkinEditInfo } | null>(null);
  const info = loaded?.info ?? null;
  // After a save renames the sources, the old info stays on screen but cannot be saved against.
  const current = loaded?.sources === sources ? loaded.info : null;
  const [edits, setEdits] = useState<SkinPartEdit[]>([]);
  const [savedEdits, setSavedEdits] = useState(edits);
  const [comparison, setComparison] = useState<'original' | 'edited'>('edited');
  const [search, setSearch] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [hoveredMaterial, setHoveredMaterial] = useState<string | null>(null);
  const [focusedMaterial, setFocusedMaterial] = useState<string | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [textures, setTextures] = useState<Record<string, SkinPartTexture>>({});
  const [name, setName] = useState(() => t('foundry.skin.customName', { hero: heroName }));
  const [tool, setTool] = useState<'color' | 'pattern'>('color');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState<'exported' | 'enabled' | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getSkinEditInfo({ heroName, skinSources: sources }).then((value) => { if (!cancelled) setLoaded({ sources, info: value }); })
      .catch((reason: unknown) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [heroName, sources]);
  const count = editedPartCount(edits);
  const dirty = count > 0 && edits !== savedEdits;
  const reportDirty = useEffectEvent((value: boolean) => onDirtyChange?.(value));
  useEffect(() => {
    if (!dirty) return;
    reportDirty(true);
    return () => reportDirty(false);
  }, [dirty]);
  const hiddenCount = edits.filter((edit) => edit.hidden).length;
  const selected = info?.parts.find((part) => part.material === selectedMaterial)
    ?? info?.parts.find((part) => /\b(coat|body|shape)$/.test(part.label) && !part.label.includes('lower')) ?? info?.parts[0];
  const selectedEdit = edits.find((edit) => edit.material === selected?.material);
  const colorOf = (part: SkinPart) => {
    const edit = edits.find((edit) => edit.material === part.material);
    if (edit?.tint) return edit.tint;
    const source = colors[materialBasename(part.material)] ?? '#ffffff';
    const pixel = new Uint8Array([Number.parseInt(source.slice(1, 3), 16), Number.parseInt(source.slice(3, 5), 16), Number.parseInt(source.slice(5, 7), 16), 255]);
    adjustSkinPixels(pixel, edit?.adjustments ?? ORIGINAL_SKIN_COLOR);
    return `#${[...pixel.slice(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  };
  const nameOf = (part: SkinPart) => {
    const prefix = `${heroName.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    let label = part.label.startsWith(prefix) ? part.label.slice(prefix.length) : part.label;
    if (label === 'shape') return t('foundry.skin.body');
    if (label.startsWith('shape ')) label = label.slice(6);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const ambiguous = (part: SkinPart) => info?.parts.filter((item) => materialBasename(item.material) === materialBasename(part.material)).length !== 1;
  const visibleParts = info?.parts.filter((part) => nameOf(part).toLowerCase().includes(search.toLowerCase())) ?? [];
  const update = (material: string, patch: Partial<SkinPartEdit>) => {
    setSaved(null); setComparison('edited');
    setEdits((current) => {
      const next = { ...(current.find((edit) => edit.material === material) ?? { material, hidden: false, tint: null, pattern: null }), ...patch };
      return [...current.filter((edit) => edit.material !== material), next].filter(hasSkinPartEdit);
    });
  };
  const exportVpk = async () => {
    if (!current) return;
    const exported = edits;
    setExporting(true); setError(null);
    try {
      if ((await window.electronAPI.exportSkinEdits({ heroName, skinSources: sources, fingerprint: current.fingerprint, edits: exported })).exported) {
        setSaved('exported'); setSavedEdits(exported);
      }
    } catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  };
  const saveAndEnable = async () => {
    if (!current || !name.trim()) return;
    const saving = edits;
    setExporting(true); setError(null);
    try {
      const { renamed } = await window.electronAPI.saveSkinEdits({ heroName, skinSources: sources, fingerprint: current.fingerprint, edits: saving, name: name.trim() });
      setSaved('enabled'); setSavedEdits(saving);
      onSaved?.(renamed);
      await useAppStore.getState().loadMods({ silent: true, force: true });
    } catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  };
  const highlight = hoveredMaterial ?? focusedMaterial;
  const highlightedPart = info?.parts.find((part) => part.material === highlight);
  return <section className="@container space-y-3" aria-label={t('foundry.skin.title')}>
    <div className="flex flex-wrap items-center gap-3">
      {sourceControl}
      <div className="flex-1" />
      {count > 0 && <span className="text-xs tabular-nums text-text-secondary">{t('foundry.skin.changed', { count })}</span>}
      <SegmentedControl label={t('foundry.skin.compare')} value={comparison} onChange={setComparison}
        options={[{ value: 'original', label: t('foundry.skin.original') }, { value: 'edited', label: t('foundry.skin.edited') }]} />
      <IconButton icon={RotateCcw} label={t('foundry.skin.reset')} disabled={!count || exporting} onClick={() => { setEdits([]); setSaved(null); setComparison('edited'); }} />
      <Button size="sm" icon={Download} disabled={!current || !count} variant="secondary" isLoading={exporting} onClick={() => { void exportVpk(); }}>{t('foundry.skin.export')}</Button>
      <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void saveAndEnable(); }}>
        <Input inputSize="sm" className="w-40" aria-label={t('foundry.skin.skinName')} value={name} maxLength={120} disabled={exporting}
          onChange={(event) => { setName(event.target.value); setSaved(null); }} />
        <Button type="submit" size="sm" disabled={!current || !count || !name.trim()} isLoading={exporting}>{t('foundry.skin.saveEnable')}</Button>
      </form>
    </div>
    <div className="flex flex-wrap items-center gap-2">
        {(info?.parts.length ?? 0) > 10 && <Input inputSize="sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('foundry.skin.search')} aria-label={t('foundry.skin.search')} />}
        <div role="group" className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1" aria-label={t('foundry.skin.parts')}>
          {!info && !error && <p role="status" className="text-xs text-text-secondary">{t('foundry.skin.loading')}</p>}
          {info && !visibleParts.length && <p className="text-xs text-text-secondary">{t('foundry.skin.noResults')}</p>}
          {visibleParts.map((part) => {
            const edit = edits.find((edit) => edit.material === part.material);
            const active = selected?.material === part.material;
            return <div key={part.material} onPointerEnter={() => setHoveredMaterial(part.material)} onPointerLeave={() => setHoveredMaterial(null)}
              onPointerDown={() => setFocusedMaterial(null)}
              onFocusCapture={(event) => { if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) setFocusedMaterial(part.material); }}
              onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedMaterial(null); }}
              className={`flex min-w-28 shrink-0 items-center gap-1 rounded-sm border ${active ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-hl/5'}`}>
              <IconButton size="sm" icon={edit?.hidden ? EyeOff : Eye} disabled={ambiguous(part) || exporting || !edit?.hidden && (info?.parts.length ?? 0) - hiddenCount <= 1}
                label={t(edit?.hidden ? 'foundry.skin.showPart' : 'foundry.skin.hidePart', { part: nameOf(part) })} aria-pressed={!edit?.hidden}
                onClick={() => { setSelectedMaterial(part.material); update(part.material, { hidden: !edit?.hidden }); }} />
              <button type="button" aria-pressed={active} onClick={() => setSelectedMaterial(part.material)}
                className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs">
                <span className={`min-w-0 flex-1 whitespace-nowrap ${edit?.hidden ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{nameOf(part)}</span>
                {textures[materialBasename(part.material)] ? <img src={textures[materialBasename(part.material)].thumbnail} alt="" className="h-7 w-7 shrink-0 rounded-sm border border-border object-cover" />
                  : <span className="h-5 w-5 shrink-0 rounded-sm border border-border" style={{ backgroundColor: colorOf(part) }} />}
              </button>
            </div>;
          })}
        </div>
        {hiddenCount > 0 && <Button size="sm" variant="ghost" icon={Eye} disabled={exporting} onClick={() => {
          setEdits((current) => current.map((edit) => ({ ...edit, hidden: false })).filter(hasSkinPartEdit)); setSaved(null); setComparison('edited');
        }}>{t('foundry.skin.showAll')}</Button>}
    </div>
    <div className="grid items-start gap-3 @min-[640px]:grid-cols-[minmax(0,1fr)_288px]">
      <div className="relative min-h-96 overflow-hidden rounded-sm border border-border bg-bg-sunken" style={{ height: 'min(62vh, 720px)' }}>
        <ErrorBoundary><Suspense fallback={<p role="status" className="p-4 text-sm text-text-secondary">{t('foundry.skin.loading')}</p>}>
          <HeroPoseViewer heroName={heroName} skinSources={sources} partEdits={comparison === 'original' ? NO_EDITS : edits}
            highlightedPart={highlightedPart && !ambiguous(highlightedPart) ? highlightedPart.material : null}
            onPartColors={setColors} onPartTextures={setTextures} onPartPick={(name) => { const part = info?.parts.find((part) => materialBasename(part.material) === materialBasename(name)); if (part) setSelectedMaterial(part.material); }} />
        </Suspense></ErrorBoundary>
      </div>
      <aside className="space-y-3 rounded-sm border border-border bg-bg-secondary p-3">
        {selected && <div className="space-y-2">
          <div className="flex items-start gap-2">
            {textures[materialBasename(selected.material)] && <img src={textures[materialBasename(selected.material)].thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-sm border border-border object-cover" />}
            <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-semibold">{nameOf(selected)}</h4>
              {selected.textureSize && <p className="text-2xs tabular-nums text-text-secondary">{selected.textureSize.width} × {selected.textureSize.height}</p>}
            </div>
            <IconButton size="sm" icon={RotateCcw} disabled={!selectedEdit || exporting} label={t('foundry.skin.resetPart', { part: nameOf(selected) })}
              onClick={() => update(selected.material, { hidden: false, tint: null, pattern: null, adjustments: undefined, colorize: undefined })} />
          </div>
          {selectedEdit?.hidden && <p className="text-xs text-text-secondary">{t('foundry.skin.hidden')}</p>}
          <SegmentedControl value={tool} onChange={setTool} options={[{ value: 'color', label: t('foundry.skin.color') }, { value: 'pattern', label: t('foundry.skin.pattern') }]} />
          {tool === 'color' ? <SkinColorControls key={selected.material} color={colorOf(selected)} edit={selectedEdit}
            tintable={selected.tintable} adjustable={selected.patternable} disabled={ambiguous(selected) || !!selectedEdit?.hidden || exporting}
            onChange={(patch) => update(selected.material, patch)} /> : selected.patternable ? <SkinPatternPicker value={selectedEdit?.pattern ?? null} disabled={ambiguous(selected) || !!selectedEdit?.hidden || exporting}
            onChange={(pattern) => update(selected.material, { pattern })} /> : <p className="text-xs text-text-secondary">{t('foundry.skin.patternUnsupported')}</p>}
        </div>}
      </aside>
    </div>
    {saved && <p role="status" className="text-xs text-state-success">{t(saved === 'enabled' ? 'foundry.skin.enabled' : 'foundry.skin.saved')}</p>}
    {error && <p role="alert" className="text-sm text-state-danger">{error}</p>}
  </section>;
}
