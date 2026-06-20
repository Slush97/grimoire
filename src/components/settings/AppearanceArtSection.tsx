import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Image as ImageIcon, Play, Wand2, Volume2, type LucideIcon } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { getAssetPath } from '../../lib/assetPath';
import {
  DEFAULT_SIDEBAR_HERO,
  HERO_NAMES_SORTED,
  getHeroChipIconPath,
  getHeroRenderPath,
  getSidebarHeroImageStyle,
  resolveAppearanceBg,
} from '../../lib/lockerUtils';
import { SidebarActiveBackdrop, SurfaceBackdrop } from '../sidebar/surfaceArt';
import {
  getAppearanceImageEdit,
  setAppearanceImageEdit,
  readImageDataUrl,
  readRendererAsset,
  showOpenDialog,
} from '../../lib/api';
import type { AppearanceBg, AppearanceBgKind, AppearanceSurface, AppSettings } from '../../types/mod';
import type { CropRect } from '../../types/electron';
import { Button, ModalHeader, SegmentedControl, Toggle } from '../common/ui';
import Tx from '../translation/Tx';
import LockerImageCropper from '../locker/LockerImageCropper';
import { Modal } from '../common/Modal';

// The launch buttons / volume bar are wide-and-short banners; frame custom
// uploads to roughly that shape so the crop preview matches what's rendered.
// (The Sidebar backdrops use object-cover, so the exact ratio is forgiving.)
const SURFACE_ASPECT = 11 / 2;

/** Cap a freshly picked upload's long edge before it's framed/stored. The baked
 *  output is already capped (in the cropper), but the ORIGINAL source is kept for
 *  a faithful reopen; without this a 40MP photo would round-trip through IPC and
 *  sit in memory + on disk at full size. */
const MAX_SOURCE_LONG = 2560;

/** Downscale a data URL so its long edge is <= MAX_SOURCE_LONG, re-encoding in a
 *  size-appropriate format (preserve PNG/WebP alpha; everything else -> JPEG).
 *  Returns the input untouched when already within bounds or on any failure. */
async function capSourceImage(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = dataUrl;
  });
  if (!img) return dataUrl;
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  if (long <= MAX_SOURCE_LONG) return dataUrl;
  const k = MAX_SOURCE_LONG / long;
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const mime = dataUrl.slice(5, Math.max(5, dataUrl.indexOf(';')));
  const outType = mime === 'image/png' || mime === 'image/webp' ? mime : 'image/jpeg';
  return canvas.toDataURL(outType, outType === 'image/jpeg' ? 0.9 : undefined);
}

interface SurfaceConfig {
  id: AppearanceSurface;
  labelKey: string;
  fallbackLabel: string;
  /** Built-in art shown for the `default` kind (none for activeTab: its default
   *  is the plain accent glow). */
  defaultSrc: string | null;
  defaultPosition: string;
  /** Surfaces that can be fully hidden. The active tab always needs a visible
   *  highlight, so its `default` IS the accent glow and `none` is omitted. */
  allowNone: boolean;
  /** How the preview reproduces this surface's real chrome (icon, fade, slider). */
  surfaceKind: 'launch' | 'activeTab' | 'volume';
  /** Launch surfaces tint warm (vanilla) vs cool (modded); matches the Sidebar. */
  warm?: boolean;
  /** The icon the real surface shows (launch glyph / volume glyph). */
  icon?: LucideIcon;
  /** Label baked onto the real surface (launch buttons), shown in the preview. */
  innerLabelKey?: string;
}

const SURFACES: readonly SurfaceConfig[] = [
  {
    id: 'activeTab',
    labelKey: 'settings.appearance.art.surface.activeTab',
    fallbackLabel: 'Active tab',
    defaultSrc: null,
    defaultPosition: 'center',
    allowNone: false,
    surfaceKind: 'activeTab',
  },
  {
    id: 'launchVanilla',
    labelKey: 'settings.appearance.art.surface.launchVanilla',
    fallbackLabel: 'Launch Vanilla',
    defaultSrc: getAssetPath('/locker/launch-vanilla-bg.jpg'),
    defaultPosition: 'center 48%',
    allowNone: true,
    surfaceKind: 'launch',
    warm: true,
    icon: Play,
    innerLabelKey: 'sidebar.launchVanilla',
  },
  {
    id: 'launchModded',
    labelKey: 'settings.appearance.art.surface.launchModded',
    fallbackLabel: 'Launch Modded',
    defaultSrc: getAssetPath('/locker/launch-modded-bg.webp'),
    defaultPosition: 'center 45%',
    allowNone: true,
    surfaceKind: 'launch',
    warm: false,
    icon: Wand2,
    innerLabelKey: 'sidebar.launchModded',
  },
  {
    id: 'volume',
    labelKey: 'settings.appearance.art.surface.volume',
    fallbackLabel: 'Volume bar',
    defaultSrc: getAssetPath('/sidebar/preview-volume-bg.jpg'),
    defaultPosition: 'center 43%',
    allowNone: true,
    surfaceKind: 'volume',
    icon: Volume2,
  },
];

/** The source-kind buttons offered for a surface (activeTab drops `none`). */
function kindsFor(surface: SurfaceConfig): AppearanceBgKind[] {
  return surface.allowNone
    ? ['default', 'hero', 'custom', 'none']
    : ['default', 'hero', 'custom'];
}

/** Read an in-app asset URL (built-in art, hero render) as a data URL so it can be
 *  fed to the cropper and baked via canvas without tainting. A packaged renderer is
 *  served from file://, where fetch() of a file:// asset is blocked and a file://
 *  <img> taints the canvas, so there we round-trip through the main process (which
 *  mirrors how getAssetPath gates on the file: protocol). In dev (http) fetch works. */
async function urlToDataUrl(url: string): Promise<string> {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return readRendererAsset(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A miniature of the REAL surface (not a bare thumbnail), so the choice reads as
 *  "this is exactly what the launch button / active tab / volume bar will look
 *  like". Reuses the Sidebar's own backdrop primitives, then layers the surface's
 *  signature foreground chrome (launch icon + label, nav row, volume slider). */
function SurfacePreview({
  bg,
  config,
  customSrc,
  className = '',
}: {
  bg: AppearanceBg;
  config: SurfaceConfig;
  customSrc?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const base = `group relative flex items-center overflow-hidden rounded-sm ${className}`;

  if (config.surfaceKind === 'activeTab') {
    // Mirror the Sidebar's active-tab highlight: a baked image / hero render under
    // the left fade, or the plain accent glow. The foreground evokes a nav row.
    const heroSrc =
      customSrc ?? (bg.kind === 'hero' ? getHeroRenderPath(bg.hero ?? DEFAULT_SIDEBAR_HERO) : null);
    const heroImageStyle: CSSProperties =
      !customSrc && bg.kind === 'hero'
        ? getSidebarHeroImageStyle(bg.hero ?? DEFAULT_SIDEBAR_HERO)
        : { objectPosition: 'center' };
    return (
      <span className={`${base} ${heroSrc ? '' : 'bg-bg-tertiary'} border border-border`} aria-hidden>
        <SidebarActiveBackdrop heroSrc={heroSrc} heroImageStyle={heroImageStyle} />
        <span className="relative z-10 flex items-center gap-1.5 pl-2">
          <span className="h-3.5 w-3.5 flex-shrink-0 rounded-sm bg-text-primary/40" />
          <span className="h-1.5 w-10 rounded-full bg-text-primary/35" />
        </span>
      </span>
    );
  }

  const Icon = config.icon;
  if (config.surfaceKind === 'volume') {
    // Mirror the preview-volume bar: backdrop, volume glyph, then a slider line.
    return (
      <span className={`${base} bg-bg-tertiary border border-border`} aria-hidden>
        <SurfaceBackdrop
          bg={bg}
          defaultSrc={config.defaultSrc!}
          defaultPosition={config.defaultPosition}
          customSrc={customSrc}
        />
        {Icon && (
          <Icon className="relative z-10 ml-2 h-3.5 w-3.5 flex-shrink-0 text-text-primary/85 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" />
        )}
        <span className="relative z-10 mx-2 h-1 flex-1 rounded-full bg-text-primary/30">
          <span className="block h-full w-2/3 rounded-full bg-accent" />
        </span>
      </span>
    );
  }

  // Launch button: backdrop (warm/cool tint), launch glyph, and the baked label.
  // `none` renders the plain button (SurfaceBackdrop returns nothing), exactly as
  // the real button looks with art turned off.
  return (
    <span className={`${base} bg-bg-tertiary ring-1 ring-white/10`} aria-hidden>
      <SurfaceBackdrop
        bg={bg}
        defaultSrc={config.defaultSrc!}
        defaultPosition={config.defaultPosition}
        warm={config.warm}
        customSrc={customSrc}
      />
      {Icon && (
        <Icon className="relative z-10 ml-2 h-3.5 w-3.5 flex-shrink-0 text-text-primary drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)]" />
      )}
      {config.innerLabelKey && (
        <span className="relative z-10 ml-1.5 truncate text-[11px] font-semibold tracking-wide text-text-primary drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)]">
          {t(config.innerLabelKey)}
        </span>
      )}
    </span>
  );
}

/**
 * Launcher & sidebar art customization (issue: unify launcher backgrounds).
 *
 * One place to set the background of all four customizable Sidebar surfaces:
 * the Launch Modded / Launch Vanilla buttons, the active-tab highlight, and the
 * preview-volume bar. Each independently picks built-in art, a hero render, a
 * custom upload (full crop editor), or none. Replaces the old split between the
 * Appearance hero chip and the launch buttons' right-click "hide art" toggle.
 */
export default function AppearanceArtSection() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const appearanceImages = useAppStore((s) => s.appearanceImages);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const setAppearanceImage = useAppStore((s) => s.setAppearanceImage);
  const removeAppearanceImage = useAppStore((s) => s.removeAppearanceImage);

  const [editing, setEditing] = useState<AppearanceSurface | null>(null);
  const editingConfig = SURFACES.find((s) => s.id === editing) ?? null;

  // Custom-image crop flow state (only meaningful while the custom kind is shown).
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [restoredCrop, setRestoredCrop] = useState<CropRect | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which kind tab is shown inside the modal (separate from the saved kind so the
  // user can preview a different source before committing). Nothing is persisted
  // until the user hits Apply (custom commits through the cropper's own button).
  const [draftKind, setDraftKind] = useState<AppearanceBgKind>('default');
  const [draftHero, setDraftHero] = useState<string>(DEFAULT_SIDEBAR_HERO);
  const editLoadId = useRef(0);

  const close = useCallback(() => {
    setEditing(null);
    setCropSource(null);
    setRestoredCrop(undefined);
    setError(null);
    setBusy(false);
  }, []);

  const openEditor = (surface: AppearanceSurface) => {
    const current = resolveAppearanceBg(settings, surface);
    const config = SURFACES.find((s) => s.id === surface);
    const hero = current.kind === 'hero' ? current.hero ?? DEFAULT_SIDEBAR_HERO : DEFAULT_SIDEBAR_HERO;
    setEditing(surface);
    setError(null);
    setBusy(false);
    setDraftKind(current.kind);
    setDraftHero(hero);
    setCropSource(null);
    setRestoredCrop(undefined);
    // Restore framing for the saved selection (image kinds only).
    if (config) void seedForKind(surface, config, current.kind, hero, true);
  };

  // Seed the cropper with the source for a kind: the stored original + crop when
  // it matches the saved selection (so reopening restores the exact framing), or
  // the fresh source for that kind (built-in art / hero render). `custom` waits
  // for an upload; `none` and the activeTab accent-glow `default` have no source.
  const seedForKind = async (
    surface: AppearanceSurface,
    config: SurfaceConfig,
    kind: AppearanceBgKind,
    hero: string,
    restore: boolean
  ) => {
    setError(null);
    const loadId = ++editLoadId.current;
    setCropSource(null);
    setRestoredCrop(undefined);
    if (kind === 'none') return;
    if (kind === 'custom') {
      // Restore a stored custom upload only when the surface was already custom.
      if (restore && resolveAppearanceBg(settings, surface).kind === 'custom') void loadEdit(surface, loadId);
      return;
    }
    if (kind === 'default' && !config.defaultSrc) return; // accent glow, nothing to frame

    const saved = resolveAppearanceBg(settings, surface);
    const matches =
      restore && saved.kind === kind && (kind !== 'hero' || (saved.hero ?? DEFAULT_SIDEBAR_HERO) === hero);
    try {
      if (matches) {
        const edit = await getAppearanceImageEdit(surface);
        if (editLoadId.current !== loadId) return;
        if (edit) {
          setCropSource(edit.source);
          setRestoredCrop(edit.crop);
          return;
        }
      }
      // Fresh source for the kind.
      const url = kind === 'default' ? config.defaultSrc! : getHeroRenderPath(hero);
      const dataUrl = await urlToDataUrl(url);
      if (editLoadId.current !== loadId) return;
      setRestoredCrop(undefined);
      setCropSource(dataUrl);
    } catch (err) {
      if (editLoadId.current !== loadId) return;
      console.error('Failed to load appearance source', err);
      setError(t('settings.appearance.art.applyError'));
    }
  };

  // Restore a stored custom edit (original + crop), falling back to the baked image.
  const loadEdit = async (surface: AppearanceSurface, loadId = ++editLoadId.current) => {
    try {
      const edit = await getAppearanceImageEdit(surface);
      if (editLoadId.current !== loadId) return;
      if (edit) {
        setCropSource(edit.source);
        setRestoredCrop(edit.crop);
      } else {
        setCropSource(appearanceImages[surface] ?? null);
        setRestoredCrop(undefined);
      }
    } catch {
      if (editLoadId.current === loadId) setCropSource(appearanceImages[surface] ?? null);
    }
  };

  const persist = async (surface: AppearanceSurface, bg: AppearanceBg) => {
    if (!settings) return;
    const nextBackgrounds = { ...(settings.appearanceBackgrounds ?? {}), [surface]: bg };
    const patch: Partial<AppSettings> = { appearanceBackgrounds: nextBackgrounds };
    // Keep the legacy field roughly in sync so any older read path stays sane.
    if (surface === 'activeTab') {
      patch.sidebarHeroHighlight =
        bg.kind === 'hero' ? bg.hero ?? DEFAULT_SIDEBAR_HERO : bg.kind === 'none' ? null : settings.sidebarHeroHighlight;
    }
    await saveSettings({ ...settings, ...patch });
  };

  // Tabs only switch the draft kind (no auto-apply). Hero opens to its grid; the
  // other kinds seed the cropper (or, for none / accent-glow default, nothing).
  const selectKind = (kind: AppearanceBgKind) => {
    if (!editing || !editingConfig) return;
    setDraftKind(kind);
    setError(null);
    if (kind === 'hero') {
      // Show the hero grid first; picking a hero loads it into the cropper.
      editLoadId.current++;
      setCropSource(null);
      setRestoredCrop(undefined);
      return;
    }
    void seedForKind(editing, editingConfig, kind, draftHero, false);
  };

  const selectHero = (hero: string) => {
    if (!editing || !editingConfig) return;
    setDraftHero(hero);
    void seedForKind(editing, editingConfig, 'hero', hero, false);
  };

  // Commit a non-image draft (none, or the activeTab accent-glow default). Drops
  // any baked image so the live/glow render takes over. Image kinds commit through
  // the cropper's own "use image" button (it has to bake first).
  const applyDraft = async () => {
    if (!editing || busy) return;
    if (appearanceImages[editing]) await removeAppearanceImage(editing);
    const bg: AppearanceBg = draftKind === 'hero' ? { kind: 'hero', hero: draftHero } : { kind: draftKind };
    await persist(editing, bg);
    close();
  };

  // Stage a freshly chosen custom source (from the native picker or a drop) into
  // the cropper: cap its size and clear any restored framing so it centers.
  const stageCustomSource = async (dataUrl: string) => {
    try {
      const capped = await capSourceImage(dataUrl);
      editLoadId.current++;
      setRestoredCrop(undefined);
      setCropSource(capped);
    } catch (err) {
      console.error('Failed to read custom image', err);
      setError(t('settings.appearance.art.applyError'));
    }
  };

  // Open the native file picker (invoked by clicking the empty crop frame).
  const pickCustom = async () => {
    if (busy) return;
    const path = await showOpenDialog({
      title: t('settings.appearance.art.uploadImage'),
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!path) return;
    await stageCustomSource(await readImageDataUrl(path));
  };

  // Read an image file dropped onto the empty crop frame.
  const dropCustom = (file: File) => {
    if (busy) return;
    const reader = new FileReader();
    reader.onload = () => void stageCustomSource(reader.result as string);
    reader.onerror = () => setError(t('settings.appearance.art.applyError'));
    reader.readAsDataURL(file);
  };

  // Any framed image kind (default / hero / custom) bakes here and stores the
  // result as the surface image, plus the original + crop for a faithful reopen.
  const applyCrop = async ({
    dataUrl,
    source,
    crop,
  }: {
    dataUrl: string;
    hideHeroName: boolean;
    source: string;
    crop: CropRect;
  }) => {
    if (!editing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setAppearanceImage(editing, dataUrl);
      // Resume aid; non-fatal if it fails to store.
      try {
        await setAppearanceImageEdit(editing, source, crop);
      } catch (editErr) {
        console.error('Failed to store appearance image edit (resume framing)', editErr);
      }
      const bg: AppearanceBg = draftKind === 'hero' ? { kind: 'hero', hero: draftHero } : { kind: draftKind };
      await persist(editing, bg);
      close();
    } catch (err) {
      console.error('Failed to set appearance image', err);
      setError(t('settings.appearance.art.applyError'));
    } finally {
      setBusy(false);
    }
  };

  // What the modal body shows for the current draft.
  const hasDefaultArt = !!editingConfig?.defaultSrc;
  const showHeroGrid = draftKind === 'hero' && !cropSource;
  const showCropper =
    draftKind === 'custom' || (draftKind === 'default' && hasDefaultArt) || (draftKind === 'hero' && !!cropSource);
  const showFooter = !showCropper && !showHeroGrid; // none, or the activeTab accent-glow default
  // The preview header reflects the live draft (used when no cropper is shown).
  const draftBg: AppearanceBg = draftKind === 'hero' ? { kind: 'hero', hero: draftHero } : { kind: draftKind };

  return (
    <div>
      <Toggle
        checked={settings?.unifiedLaunchButton ?? false}
        onChange={(checked) => settings && void saveSettings({ ...settings, unifiedLaunchButton: checked })}
        label={<Tx k="settings.appearance.launchButtons.combine" fallback="Combine launch buttons" />}
        description={
          <Tx
            k="settings.appearance.launchButtons.combineDescription"
            fallback="Use a single launch button and switch between Modded and Vanilla with the swap icon or right-click, instead of two stacked buttons."
          />
        }
        className="mb-5"
      />

      <div className="mb-3">
        <h3 className="text-sm font-semibold text-text-primary">
          <Tx k="settings.appearance.art.title" fallback="Launcher & sidebar art" />
        </h3>
        <p className="text-xs text-text-secondary">
          <Tx
            k="settings.appearance.art.description"
            fallback="Set the background for each launch button, the active tab, and the volume bar."
          />
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {SURFACES.map((config) => {
          const bg = resolveAppearanceBg(settings, config.id);
          const kindLabel = t(`settings.appearance.art.kind.${bg.kind}`);
          const detail = bg.kind === 'hero' ? bg.hero ?? DEFAULT_SIDEBAR_HERO : kindLabel;
          return (
            <button
              key={config.id}
              type="button"
              onClick={() => openEditor(config.id)}
              className="group flex items-center gap-3 rounded-sm border border-border bg-bg-tertiary/40 p-2 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <SurfacePreview
                bg={bg}
                config={config}
                customSrc={appearanceImages[config.id]}
                className="h-9 w-36 flex-shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {t(config.labelKey, config.fallbackLabel)}
                </span>
                <span className="block truncate text-xs text-text-secondary">{detail}</span>
              </span>
              <ImageIcon className="h-4 w-4 flex-shrink-0 text-text-secondary group-hover:text-accent" aria-hidden />
            </button>
          );
        })}
      </div>

      {editing && editingConfig && (
        <Modal
          onClose={close}
          size="sm"
          dismissable={!busy}
          labelledBy="appearance-art-modal-title"
          backdropClassName="backdrop-blur-sm"
          panelClassName="relative flex max-h-[90vh] flex-col overflow-hidden"
        >
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />

            {/* Header (pinned). Close is disabled while busy to match the blocked
                Escape/backdrop (dismissable={!busy}). */}
            <ModalHeader
              title={t(editingConfig.labelKey, editingConfig.fallbackLabel)}
              titleId="appearance-art-modal-title"
              onClose={close}
              closeLabel={t('common.actions.close')}
              closeDisabled={busy}
            />

            {/* Body (scrolls) */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
              {/* Source-kind tabs (selection only; nothing is saved until Apply) */}
              <SegmentedControl
                className="mb-4"
                options={kindsFor(editingConfig).map((kind) => ({
                  value: kind,
                  label: t(`settings.appearance.art.kind.${kind}`),
                }))}
                value={draftKind}
                onChange={selectKind}
              />

              {/* Preview header only when there's no cropper acting as the preview. */}
              {showFooter && (
                <div className="mb-4">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                    {t('settings.appearance.art.preview')}
                  </span>
                  <SurfacePreview bg={draftBg} config={editingConfig} customSrc={appearanceImages[editing]} className="h-16 w-full" />
                  <p className="mt-3 text-center text-sm text-text-secondary">
                    {t(draftKind === 'none' ? 'settings.appearance.art.noneHint' : 'settings.appearance.art.defaultHint')}
                  </p>
                </div>
              )}

              {showHeroGrid && (
                <>
                  <p className="mb-2 text-xs text-text-secondary">{t('settings.appearance.art.heroHint')}</p>
                  <div className="grid max-h-[44vh] grid-cols-5 gap-2 overflow-y-auto sm:grid-cols-6">
                    {HERO_NAMES_SORTED.map((heroName) => {
                      const active = draftHero === heroName;
                      return (
                        <button
                          key={heroName}
                          type="button"
                          onClick={() => selectHero(heroName)}
                          title={heroName}
                          aria-label={heroName}
                          aria-pressed={active}
                          className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-sm border bg-bg-tertiary transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            active
                              ? 'border-accent/70 bg-accent/15'
                              : 'border-border hover:border-accent/50 hover:bg-accent/10'
                          }`}
                        >
                          <img
                            src={getHeroChipIconPath(heroName)}
                            alt=""
                            aria-hidden
                            className="h-8 w-8 object-contain"
                            loading="lazy"
                          />
                          {active && (
                            <span className="absolute right-0.5 top-0.5 rounded-sm bg-accent p-0.5 text-accent-foreground">
                              <Check className="h-2.5 w-2.5" aria-hidden />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {showCropper && (
                <div className="space-y-3 pb-1">
                  <LockerImageCropper
                    imageDataUrl={cropSource}
                    aspect={SURFACE_ASPECT}
                    nameControls={false}
                    initialCrop={restoredCrop}
                    emptyHint={t('settings.appearance.art.uploadHint')}
                    onPickClick={draftKind === 'custom' ? () => void pickCustom() : undefined}
                    onDropFile={draftKind === 'custom' ? dropCustom : undefined}
                    busy={busy}
                    onApply={applyCrop}
                  />
                  {draftKind === 'hero' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        editLoadId.current++;
                        setCropSource(null);
                        setRestoredCrop(undefined);
                      }}
                      disabled={busy}
                    >
                      {t('settings.appearance.art.changeHero')}
                    </Button>
                  )}
                </div>
              )}

              {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            </div>

            {/* Footer (pinned). Image kinds commit through the cropper's own button,
                so only the non-image states (none / accent-glow default) get Apply. */}
            {showFooter && (
              <div className="flex flex-shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
                <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
                  {t('common.actions.cancel')}
                </Button>
                <Button size="sm" onClick={() => void applyDraft()} disabled={busy}>
                  {t('common.actions.apply')}
                </Button>
              </div>
            )}
        </Modal>
      )}
    </div>
  );
}
