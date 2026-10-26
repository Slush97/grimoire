import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Eye, EyeOff, RotateCcw, Download, Focus, Undo2, Redo2 } from 'lucide-react';
import { Button, IconButton, ProgressBar, SegmentedControl } from '../common/ui';
import { Input, Select } from '../common/forms';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { SkinPatternPicker } from './SkinPatternPicker';
import { SkinColorControls } from './SkinColorControls';
import { SkinFinishControls } from './SkinFinishControls';
import { SkinSurfaceControls } from './SkinSurfaceControls';
import { WorkshopWorkbench } from './WorkshopWorkbench';
import { adjustSkinPixels, hasSkinPartEdit, ORIGINAL_SKIN_COLOR } from '../../lib/skinColorAdjustments';
import { useAppStore } from '../../stores/appStore';
import { canonicalHeroName, inferHeroFromTitle, isLockerManagedMod } from '../../lib/lockerUtils';
import { editedPartCount, materialBasename } from '../../lib/skinParts';
import { isGlobalSkinSource } from '../../lib/skinEditSchema';
import { useFoundryDraft } from '../../lib/useFoundryDraft';
import { useSkinEditHistory } from '../../lib/useSkinEditHistory';
import { skinModelForms } from '../../lib/skinModelForms';
import type { HeroPoseSkinSource } from '../../types/portrait';
import type { SkinEditInfo, SkinEditProgress, SkinEditResume, SkinPart, SkinPartEdit, SkinPartTexture } from '../../types/skinEditor';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
const NO_SOURCES: HeroPoseSkinSource[] = [];
const NO_EDITS: SkinPartEdit[] = [];

export default function SkinEditor({ heroName, initialSkinSources = NO_SOURCES, onDirtyChange }: {
  heroName: string; initialSkinSources?: HeroPoseSkinSource[]; onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const mods = useAppStore((state) => state.mods);
  const available = useMemo(() => mods.filter((mod) => !isGlobalSkinSource(mod) && (
    (isLockerManagedMod(mod) && canonicalHeroName(mod.lockerHero ?? inferHeroFromTitle(mod.name) ?? '') === canonicalHeroName(heroName))
    || mod.merged?.sources.some((source) => canonicalHeroName(inferHeroFromTitle(source.modName) ?? '') === canonicalHeroName(heroName))
  )), [mods, heroName]);
  const identity = (mod: (typeof mods)[number]) => mod.sha256 ?? mod.metaKey;
  const targetKey = (sources: HeroPoseSkinSource[]) => JSON.stringify([...new Set(sources.flatMap((source) => {
    const mod = mods.find((item) => item.metaKey === source.metaKey);
    return mod?.skinEdit?.sources ?? [mod ? identity(mod) : source.metaKey];
  }))].sort());
  const [lastSelection, setLastSelection] = useFoundryDraft<string | string[]>(`skin:${heroName}:selection`,
    z.union([z.string().max(500), z.array(z.string().max(500)).max(64)]), 'vanilla');
  const equippedGlobal = initialSkinSources.some(isGlobalSkinSource);
  const equippedEditable = initialSkinSources.length > 0 && !equippedGlobal;
  const [selection, setSelection] = useState(() => {
    const ids = typeof lastSelection === 'string' ? [lastSelection] : lastSelection;
    const remembered = ids.flatMap((id) => {
      const mod = available.find((item) => identity(item) === id);
      return mod ? [{ metaKey: mod.metaKey, priority: mod.priority }] : [];
    });
    const value = equippedEditable || remembered.length > 1 ? 'equipped' : remembered[0]?.metaKey ?? 'vanilla';
    const sources = equippedEditable ? initialSkinSources : remembered.length ? remembered : NO_SOURCES;
    return { value, equipped: equippedEditable ? initialSkinSources : remembered, sources, requested: sources, draftKey: targetKey(sources), session: 0, resume: null as SkinEditResume | null,
      resuming: sources.some((source) => mods.some((mod) => mod.metaKey === source.metaKey && mod.skinEdit)) };
  });
  const rememberLinkedSkin = useEffectEvent(() => {
    if (equippedEditable) setLastSelection(initialSkinSources.map((source) => {
      const mod = mods.find((item) => item.metaKey === source.metaKey);
      return mod ? identity(mod) : source.metaKey;
    }));
  });
  useEffect(() => { rememberLinkedSkin(); }, [heroName]);
  const [resumeError, setResumeError] = useState<string | null>(null);
  useEffect(() => {
    if (!selection.resuming) return;
    let cancelled = false;
    window.electronAPI.resumeSkinEdit({ heroName, skinSources: selection.requested }).then((resume) => {
      if (!cancelled) setSelection((current) => ({ ...current, resuming: false, resume,
        equipped: current.value === 'equipped' ? resume.skinSources : current.equipped,
        sources: resume.skinSources, session: current.session + 1 }));
    }).catch((reason: unknown) => { if (!cancelled) setResumeError(String(reason)); });
    return () => { cancelled = true; };
  }, [selection.resuming, selection.requested, heroName]);
  const select = (value: string) => {
    setResumeError(null);
    const picked = available.find((mod) => mod.metaKey === value);
    setLastSelection(picked ? identity(picked) : value === 'equipped' ? selection.equipped.map((source) => {
      const mod = mods.find((item) => item.metaKey === source.metaKey);
      return mod ? identity(mod) : source.metaKey;
    }) : value);
    setSelection((current) => {
      const sources = value === 'equipped' ? current.equipped : picked ? [{ metaKey: picked.metaKey, priority: picked.priority }] : NO_SOURCES;
      return { ...current, value, session: current.session + 1, sources, requested: sources, draftKey: targetKey(sources), resume: null,
        resuming: sources.some((source) => mods.some((mod) => mod.metaKey === source.metaKey && mod.skinEdit)) };
    });
  };
  // Saving can enable and repack mods; follow them so the session stays on the same skin.
  const followSave = (renamed: Record<string, HeroPoseSkinSource>, edits: SkinPartEdit[], name: string, overlay: HeroPoseSkinSource) => {
    const savedMod = useAppStore.getState().mods.find((mod) => mod.metaKey === overlay.metaKey);
    if (savedMod) setLastSelection(identity(savedMod));
    setSelection((current) => {
      const remap = (sources: HeroPoseSkinSource[]) => sources.some((source) => renamed[source.metaKey])
        ? sources.map((source) => renamed[source.metaKey] ?? source) : sources;
      const sources = remap(current.sources);
      const resume = { skinSources: sources, overlay, edits, name, missing: 0 };
      return { ...current, value: overlay.metaKey, equipped: remap(current.equipped), sources, resume };
    });
  };
  const resumed = selection.resume;
  const sourceControl = <label className="flex min-w-0 max-w-sm items-center gap-2 text-xs text-text-secondary">
    <span>{t('foundry.skin.source')}</span>
    <Select inputSize="sm" value={selection.value} onChange={(event) => select(event.target.value)}>
      <option value="vanilla">{t('foundry.skin.originalGame')}</option>
      {(equippedEditable || selection.equipped.length > 1) && <option value="equipped">{t('foundry.skin.equipped')}</option>}
      {available.map((mod) => <option key={mod.metaKey} value={mod.metaKey}>{mod.name}</option>)}
    </Select>
  </label>;
  if (selection.resuming) {
    return <>{sourceControl}{resumeError ? <p role="alert" className="text-sm text-state-danger">{resumeError}</p>
      : <p role="status" className="text-xs text-text-secondary">{t('foundry.skin.loading')}</p>}</>;
  }
  return <>
    {equippedGlobal && <p role="status" className="text-xs text-state-warning">{t('foundry.skin.globalUnsupported')}</p>}
    {!!resumed?.missing && <p role="status" className="text-xs text-state-warning">{t('foundry.skin.sourceMissing', { count: resumed.missing })}</p>}
    <SkinEditorSession key={selection.session} draftKey={`skin:${heroName}:${selection.draftKey}`} heroName={heroName} sources={selection.sources} initialEdits={resumed?.edits} initialName={resumed?.name}
      blocked={!!resumed?.missing} replaces={resumed?.overlay} onSaved={followSave} onDirtyChange={onDirtyChange} sourceControl={sourceControl} />
  </>;
}

/** `replaces` is a saved overlay this session resumes; `sources` never include one. */
export function SkinEditorSession({ heroName, sources, draftKey = `skin:${heroName}:${JSON.stringify(sources)}`, initialEdits = NO_EDITS, initialName, replaces, sourceControl, onSaved, onDirtyChange, blocked = false }: {
  heroName: string; sources: HeroPoseSkinSource[]; initialEdits?: SkinPartEdit[]; initialName?: string; replaces?: HeroPoseSkinSource;
  sourceControl?: ReactNode; onSaved?: (renamed: Record<string, HeroPoseSkinSource>, edits: SkinPartEdit[], name: string, overlay: HeroPoseSkinSource) => void;
  onDirtyChange?: (dirty: boolean) => void;
  draftKey?: string;
  blocked?: boolean;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ sources: HeroPoseSkinSource[]; info: SkinEditInfo } | null>(null);
  const info = loaded?.info ?? null;
  // After a save renames the sources, the old info stays on screen but cannot be saved against.
  const current = loaded?.sources === sources ? loaded.info : null;
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState<'exported' | 'enabled' | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const history = useSkinEditHistory({ key: `${draftKey}:edits`, initial: initialEdits, disabled: exporting, root: editorRef,
    onTravel: () => { setSaved(null); setComparison('edited'); } });
  const { edits, setEdits } = history;
  const [savedEdits, setSavedEdits] = useState(initialEdits);
  const [comparison, setComparison] = useFoundryDraft(`${draftKey}:comparison`, z.enum(['original', 'edited']), 'edited');
  const [search, setSearch] = useFoundryDraft(`${draftKey}:search`, z.string().max(512), '');
  const [legacyMaterial] = useFoundryDraft(`${draftKey}:material`, z.string().max(512).nullable(), null);
  const [partSelections, setPartSelections] = useFoundryDraft(`${draftKey}:formMaterials`, z.record(z.string().max(512).nullable()), {});
  const [focusMaterial, setFocusMaterial] = useFoundryDraft(`${draftKey}:focus`, z.string().max(512).nullable(), null);
  const [hoveredMaterial, setHoveredMaterial] = useState<string | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [textures, setTextures] = useState<Record<string, SkinPartTexture>>({});
  const [name, setName] = useFoundryDraft(`${draftKey}:name`, z.string().max(120), initialName ?? t('foundry.skin.customName', { hero: heroName }));
  const [tool, setTool] = useFoundryDraft(`${draftKey}:tool`, z.enum(['color', 'pattern', 'surface']), 'color');
  const [partsExpanded, setPartsExpanded] = useFoundryDraft(`${draftKey}:partsExpanded`, z.boolean(), false);
  const [formId, setFormId] = useFoundryDraft(`${draftKey}:form`, z.string().max(64), 'default');
  const forms = skinModelForms(heroName, info?.entry ?? '');
  const form = forms.find((item) => item.id === formId) ?? forms[0];
  const formParts = info?.parts.filter((part) => part.formIds ? part.formIds.includes(form.id) : !part.modelEntries || part.modelEntries.includes(form.entry)) ?? [];
  const formAvailable = info?.forms?.find((item) => item.id === form.id)?.available !== false;
  const selectedMaterial = partSelections[form.id] ?? (form.id === 'default' ? legacyMaterial : null);
  const setSelectedMaterial = (material: string) => setPartSelections((current) => ({ ...current, [form.id]: material }));
  const changesInForm = (id: string) => edits.filter((edit) => hasSkinPartEdit(edit) && info?.parts.some((part) => part.material === edit.material
    && (part.formIds ? part.formIds.includes(id) : !part.modelEntries || part.modelEntries.includes(forms.find((item) => item.id === id)?.entry ?? '')))).length;
  const changedForms = forms.filter((item) => changesInForm(item.id) > 0).length;
  const partsId = useId();
  const capture = useRef<(() => Promise<string>) | null>(null);
  const receiveCapture = useCallback((value: (() => Promise<string>) | null) => { capture.current = value; }, []);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SkinEditProgress | null>(null);
  useEffect(() => {
    if (exporting) return window.electronAPI.onSkinEditProgress(setProgress);
  }, [exporting]);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getSkinEditInfo({ heroName, skinSources: sources }).then((value) => {
      if (!cancelled) setLoaded({ sources, info: value });
    }).catch((reason: unknown) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [heroName, sources]);
  const count = editedPartCount(edits);
  const unknownCount = info ? edits.filter((edit) => !info.parts.some((part) => part.material === edit.material)).length : 0;
  const unsupportedSurface = edits.some((edit) => edit.surface?.mode === 'ghost' && !edit.hidden);
  const dirty = JSON.stringify(edits) !== JSON.stringify(savedEdits);
  const reportDirty = useEffectEvent((value: boolean) => onDirtyChange?.(value));
  useEffect(() => {
    if (!dirty) return;
    reportDirty(true);
    return () => reportDirty(false);
  }, [dirty]);
  const hiddenCount = edits.filter((edit) => edit.hidden).length;
  const selected = formParts.find((part) => part.material === selectedMaterial)
    ?? formParts.find((part) => /\b(coat|body|shape|ball|cat|cube|stone)\b/.test(part.label) && !/lower|outline/.test(part.label)) ?? formParts[0];
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
  const visibleParts = formParts.filter((part) => nameOf(part).toLowerCase().includes(search.toLowerCase()));
  const update = (material: string, patch: Partial<SkinPartEdit>) => {
    setSaved(null); setComparison('edited');
    setEdits((current) => {
      const next = { ...(current.find((edit) => edit.material === material) ?? { material, hidden: false, tint: null, pattern: null }), ...patch };
      return [...current.filter((edit) => edit.material !== material), next].filter(hasSkinPartEdit);
    });
  };
  const exportVpk = async () => {
    if (!current || blocked || unknownCount || unsupportedSurface) return;
    const exported = edits;
    setExporting(true); setError(null); setSaved(null); setProgress(null);
    try {
      if ((await window.electronAPI.exportSkinEdits({ heroName, skinSources: sources, fingerprint: current.fingerprint, edits: exported })).exported) {
        setSaved('exported'); setSavedEdits(exported);
      }
    } catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  };
  const saveAndEnable = async () => {
    if (!current || blocked || unknownCount || unsupportedSurface || !name.trim()) return;
    const saving = edits;
    setExporting(true); setError(null); setSaved(null); setProgress({ stage: 'inspect' });
    setComparison('edited'); setHoveredMaterial(null); setThumbnailFailed(false);
    try {
      let thumbnailDataUrl: string | undefined;
      try {
        if (!capture.current) throw new Error('Preview is not ready');
        thumbnailDataUrl = await capture.current();
      } catch { setThumbnailFailed(true); }
      const { renamed, overlay } = await window.electronAPI.saveSkinEdits({ heroName, skinSources: replaces ? [replaces, ...sources] : sources,
        fingerprint: current.fingerprint, edits: saving, name: name.trim(), thumbnailDataUrl });
      setSavedEdits(saving);
      await useAppStore.getState().loadMods({ silent: true, force: true });
      onSaved?.(renamed, saving, name.trim(), overlay);
      setSaved('enabled');
    } catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  };
  const highlight = partsExpanded ? hoveredMaterial : null;
  const highlightedPart = info?.parts.find((part) => part.material === highlight);
  return <section ref={editorRef} onPointerDownCapture={history.onPointerDownCapture} onFocusCapture={history.onFocusCapture}
    onBlurCapture={history.onBlurCapture} onKeyDownCapture={history.onKeyDownCapture} className="@container space-y-3" aria-label={t('foundry.skin.title')}>
    <fieldset disabled={exporting} className="flex flex-wrap items-center gap-3">
      {sourceControl}
      <IconButton size="sm" icon={Undo2} label={t('common.actions.undo')} aria-keyshortcuts="Control+Z Meta+Z" disabled={!history.canUndo} onClick={history.undo} />
      <IconButton size="sm" icon={Redo2} label={t('common.actions.redo')} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" disabled={!history.canRedo} onClick={history.redo} />
      <div className="flex-1" />
      <SegmentedControl label={t('foundry.skin.compare')} value={comparison} onChange={setComparison}
        options={[{ value: 'original', label: t('foundry.skin.original') }, { value: 'edited', label: t('foundry.skin.edited') }]} />
    </fieldset>
    {unknownCount > 0 && <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-state-warning">
      <span>{t('foundry.draft.unknownParts', { count: unknownCount })}</span>
      <Button size="sm" variant="secondary" onClick={() => setEdits((current) => current.filter((edit) => info?.parts.some((part) => part.material === edit.material)))}>{t('foundry.draft.keepAvailable')}</Button>
    </div>}
    {unsupportedSurface && <p role="status" className="text-xs text-state-warning">{t('foundry.skin.ghostUnsupported')}</p>}
    <WorkshopWorkbench preview={
        !formAvailable ? <p role="status" className="p-4 text-sm text-text-secondary">{t('foundry.skin.formUnavailable', { form: t(form.labelKey) })}</p>
        : <ErrorBoundary><Suspense fallback={<p role="status" className="p-4 text-sm text-text-secondary">{t('foundry.skin.loading')}</p>}>
          <HeroPoseViewer key={form.id} heroName={form.previewHero} skinSources={sources} partEdits={comparison === 'original' ? NO_EDITS : edits}
            focusMaterial={formParts.some((part) => part.material === focusMaterial) ? focusMaterial : null}
            onPreviewCapture={receiveCapture}
            workspaceKey={form.id === 'default' ? draftKey : `${draftKey}:${form.id}`}
            highlightedPart={!exporting && highlightedPart && !ambiguous(highlightedPart) ? highlightedPart.material : null}
            onPartColors={setColors} onPartTextures={setTextures} onPartPick={(name) => { const part = formParts.find((part) => materialBasename(part.material) === materialBasename(name)); if (part) setSelectedMaterial(part.material); }} />
        </Suspense></ErrorBoundary>
      }
      previewFooter={forms.length > 1 ? <>
        <span className="text-xs text-text-secondary">{t('foundry.skin.form')}</span>
        <SegmentedControl label={t('foundry.skin.form')} value={form.id} disabled={exporting}
          onChange={(id) => { setFormId(id); setHoveredMaterial(null); }}
          options={forms.map((item) => ({ value: item.id, label: <span className="flex items-center gap-2">
            {t(item.labelKey)}{changesInForm(item.id) > 0 && <span aria-label={t('foundry.skin.changed', { count: changesInForm(item.id) })} className="text-2xs tabular-nums text-text-secondary">{changesInForm(item.id)}</span>}
          </span> }))} />
      </> : undefined}
      footer={<>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-text-secondary">{changedForms > 1 ? t('foundry.skin.changedAcrossForms', { count, forms: changedForms })
            : forms.length > 1 && changedForms === 1 ? t('foundry.skin.changedInForm', { count, form: t(forms.find((item) => changesInForm(item.id) > 0)!.labelKey) })
            : t('foundry.skin.changed', { count })}</span>
          <IconButton size="sm" icon={RotateCcw} label={t('foundry.skin.reset')} disabled={!count || exporting}
            onClick={() => { setEdits([]); setSaved(null); setComparison('edited'); }} />
        </div>
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void saveAndEnable(); }}>
          <Input inputSize="sm" className="w-full" aria-label={t('foundry.skin.skinName')} value={name} maxLength={120} disabled={exporting}
            onChange={(event) => { setName(event.target.value); setSaved(null); }} />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={blocked || !!unknownCount || unsupportedSurface || !current || !count || !name.trim()} isLoading={exporting}>{t('foundry.skin.saveEnable')}</Button>
            <Button icon={Download} disabled={exporting || blocked || !!unknownCount || unsupportedSurface || !current || !count} variant="secondary"
              onClick={() => { void exportVpk(); }}>{t('foundry.skin.export')}</Button>
          </div>
        </form>
        {exporting && <div role="status" className="space-y-2 text-xs text-text-secondary">
          <p>{progress?.stage === 'build' ? t('foundry.skin.buildProgress', { completed: progress.completed, total: progress.total })
            : t(progress?.stage === 'install' ? 'foundry.skin.installing' : 'foundry.skin.preparing')}</p>
          <ProgressBar value={progress?.stage === 'build' ? progress.completed : 0} max={progress?.stage === 'build' ? progress.total : 1}
            indeterminate={progress?.stage !== 'build'} label={t('foundry.skin.saveEnable')} />
        </div>}
        {saved && <p role="status" className="text-xs text-state-success">{t(saved === 'enabled' ? 'foundry.skin.enabled' : 'foundry.skin.saved')}</p>}
        {saved === 'enabled' && thumbnailFailed && <p role="status" className="text-xs text-state-warning">{t('foundry.skin.thumbnailFailed')}</p>}
        {error && <p role="alert" className="break-words text-xs text-state-danger">{error}</p>}
      </>}>
      <fieldset disabled={exporting} className="min-w-0 space-y-2">
        <legend className="sr-only">{t('foundry.skin.parts')}</legend>
        <button type="button" aria-expanded={partsExpanded} aria-controls={partsId} onClick={() => setPartsExpanded(!partsExpanded)}
          className="flex w-full items-center gap-2 rounded-sm py-1 text-left text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-accent">
          <span className="flex-1">{t('foundry.skin.parts')}</span>
          <span className="text-xs font-normal tabular-nums text-text-secondary">{formParts.length}</span>
          <ChevronDown className={`h-4 w-4 text-text-secondary transition-transform ${partsExpanded ? 'rotate-180' : ''}`} />
        </button>
        {partsExpanded && <div id={partsId} className="space-y-2">
        {formParts.length > 10 && <Input inputSize="sm" className="w-full" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('foundry.skin.search')} aria-label={t('foundry.skin.search')} />}
        {!info && !error && <p role="status" className="text-xs text-text-secondary">{t('foundry.skin.loading')}</p>}
        {info && !visibleParts.length && <p className="text-xs text-text-secondary">{t('foundry.skin.noResults')}</p>}
        <div role="group" className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto overscroll-contain scrollbar-glass" aria-label={t('foundry.skin.parts')}>
          {visibleParts.map((part) => {
            const edit = edits.find((edit) => edit.material === part.material);
            const active = selected?.material === part.material;
            return <div key={part.material} onPointerEnter={() => setHoveredMaterial(part.material)} onPointerLeave={() => setHoveredMaterial(null)}
              className={`flex min-w-0 items-center rounded-sm border ${active ? 'border-accent bg-accent/10' : 'border-border hover:bg-hl/5'}`}>
              <button type="button" aria-pressed={active} title={nameOf(part)} onClick={() => { setSelectedMaterial(part.material); setHoveredMaterial(null); setPartsExpanded(false); }}
                className="flex min-h-9 min-w-0 flex-1 items-center gap-2 pl-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-accent">
                <span className="h-4 w-4 shrink-0 rounded-sm border border-hl/15" style={{ backgroundColor: colorOf(part) }} />
                <span className={`min-w-0 truncate ${edit?.hidden ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{nameOf(part)}</span>
              </button>
              <IconButton size="sm" icon={edit?.hidden ? EyeOff : Eye} disabled={part.hideable === false || ambiguous(part) || !edit?.hidden && formParts.filter((item) => !edits.some((edit) => edit.material === item.material && edit.hidden)).length <= 1}
                label={part.hideable === false ? t('foundry.skin.sharedGeometry') : t(edit?.hidden ? 'foundry.skin.showPart' : 'foundry.skin.hidePart', { part: nameOf(part) })} aria-pressed={!edit?.hidden}
                onClick={() => { setSelectedMaterial(part.material); update(part.material, { hidden: !edit?.hidden }); }} />
            </div>;
          })}
        </div>
        {hiddenCount > 0 && <Button size="sm" variant="ghost" icon={Eye} onClick={() => {
          setEdits((current) => current.map((edit) => ({ ...edit, hidden: false })).filter(hasSkinPartEdit)); setSaved(null); setComparison('edited');
        }}>{t('foundry.skin.showAll')}</Button>}
        </div>}
      </fieldset>
      {selected && <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            {textures[materialBasename(selected.material)] && <img src={textures[materialBasename(selected.material)].thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-sm border border-border object-cover" />}
            <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-semibold">{nameOf(selected)}</h4>
              {selected.formIds && selected.formIds.length > 1 && <p className="text-2xs text-text-secondary">{t('foundry.skin.sharedForms', { forms: forms.filter((item) => selected.formIds?.includes(item.id)).map((item) => t(item.labelKey)).join(', ') })}</p>}
              {selected.hideable === false && <p className="text-2xs text-text-secondary">{t('foundry.skin.sharedGeometry')}</p>}
              {selected.textureSize && <p className="text-2xs tabular-nums text-text-secondary">{selected.textureSize.width} × {selected.textureSize.height}</p>}
            </div>
            <IconButton size="sm" icon={Focus} aria-pressed={focusMaterial === selected.material}
              label={t(focusMaterial === selected.material ? 'foundry.skin.wholeModel' : 'foundry.skin.focusPart')}
              onClick={() => setFocusMaterial(focusMaterial === selected.material ? null : selected.material)} />
            <IconButton size="sm" icon={RotateCcw} disabled={!selectedEdit || exporting} label={t('foundry.skin.resetPart', { part: nameOf(selected) })}
              onClick={() => update(selected.material, { hidden: false, tint: null, pattern: null, adjustments: undefined, colorize: undefined, finish: undefined, surface: undefined })} />
          </div>
          {selectedEdit?.hidden && <p className="text-xs text-text-secondary">{t('foundry.skin.hidden')}</p>}
          <SegmentedControl fill value={tool} onChange={setTool} options={[{ value: 'color', label: t('foundry.skin.color') }, { value: 'pattern', label: t('foundry.skin.pattern') }, { value: 'surface', label: t('foundry.skin.surface') }]} />
          {tool === 'surface' ? <div className="space-y-4">
            {selected.finishable ? <SkinFinishControls value={selectedEdit?.finish} disabled={ambiguous(selected) || !!selectedEdit?.hidden || exporting}
              onChange={(finish) => update(selected.material, { finish })} /> : <p className="text-xs text-text-secondary">{t('foundry.skin.finishUnsupported')}</p>}
            {selected.surfaceable ? <div className="border-t border-border pt-4"><SkinSurfaceControls value={selectedEdit?.surface}
              disabled={ambiguous(selected) || !!selectedEdit?.hidden || exporting} onChange={(surface) => update(selected.material, { surface })} /></div>
              : <p className="text-xs text-text-secondary">{t('foundry.skin.surfaceUnsupported')}</p>}
            </div>
            : tool === 'color' ? <SkinColorControls key={selected.material} color={colorOf(selected)} edit={selectedEdit}
            tintable={selected.tintable} adjustable={selected.patternable} disabled={ambiguous(selected) || !!selectedEdit?.hidden || exporting}
            onChange={(patch) => update(selected.material, patch)} /> : selected.patternable ? <SkinPatternPicker value={selectedEdit?.pattern ?? null} color={colorOf(selected)} disabled={ambiguous(selected) || !!selectedEdit?.hidden || exporting}
            onChange={(pattern) => update(selected.material, { pattern, ...(pattern?.colors && selected.tintable ? { tint: '#ffffff', colorize: false } : {}) })} /> : <p className="text-xs text-text-secondary">{t('foundry.skin.patternUnsupported')}</p>}
        </div>}
    </WorkshopWorkbench>
  </section>;
}
