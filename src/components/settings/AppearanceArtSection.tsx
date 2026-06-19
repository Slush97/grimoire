import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Image as ImageIcon, Ban, Upload, X } from 'lucide-react';
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
import { getAppearanceImageEdit, setAppearanceImageEdit, readImageDataUrl, showOpenDialog } from '../../lib/api';
import type { AppearanceBg, AppearanceBgKind, AppearanceSurface, AppSettings } from '../../types/mod';
import type { CropRect } from '../../types/electron';
import { Button } from '../common/ui';
import Tx from '../translation/Tx';
import LockerImageCropper from '../locker/LockerImageCropper';

// The launch buttons / volume bar are wide-and-short banners; frame custom
// uploads to roughly that shape so the crop preview matches what's rendered.
// (The Sidebar backdrops use object-cover, so the exact ratio is forgiving.)
const SURFACE_ASPECT = 11 / 2;

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
}

const SURFACES: readonly SurfaceConfig[] = [
  {
    id: 'launchModded',
    labelKey: 'settings.appearance.art.surface.launchModded',
    fallbackLabel: 'Launch Modded',
    defaultSrc: getAssetPath('/locker/launch-modded-bg.webp'),
    defaultPosition: 'center 45%',
    allowNone: true,
  },
  {
    id: 'launchVanilla',
    labelKey: 'settings.appearance.art.surface.launchVanilla',
    fallbackLabel: 'Launch Vanilla',
    defaultSrc: getAssetPath('/locker/launch-vanilla-bg.jpg'),
    defaultPosition: 'center 48%',
    allowNone: true,
  },
  {
    id: 'activeTab',
    labelKey: 'settings.appearance.art.surface.activeTab',
    fallbackLabel: 'Active tab',
    defaultSrc: null,
    defaultPosition: 'center',
    allowNone: false,
  },
  {
    id: 'volume',
    labelKey: 'settings.appearance.art.surface.volume',
    fallbackLabel: 'Volume bar',
    defaultSrc: getAssetPath('/sidebar/preview-volume-bg.jpg'),
    defaultPosition: 'center 43%',
    allowNone: true,
  },
];

/** The source-kind buttons offered for a surface (activeTab drops `none`). */
function kindsFor(surface: SurfaceConfig): AppearanceBgKind[] {
  return surface.allowNone
    ? ['default', 'hero', 'custom', 'none']
    : ['default', 'hero', 'custom'];
}

/** A small live preview of how a surface's chosen background looks. */
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
  const base = `relative overflow-hidden rounded-sm border border-white/10 bg-bg-tertiary ${className}`;
  if (bg.kind === 'none') {
    return (
      <span className={`${base} flex items-center justify-center`} aria-hidden>
        <Ban className="h-4 w-4 text-text-secondary" />
      </span>
    );
  }
  let src: string | null = null;
  let style: CSSProperties = { objectPosition: config.defaultPosition };
  if (bg.kind === 'hero') {
    const hero = bg.hero ?? DEFAULT_SIDEBAR_HERO;
    src = getHeroRenderPath(hero);
    style = getSidebarHeroImageStyle(hero);
  } else if (bg.kind === 'custom') {
    src = customSrc ?? config.defaultSrc;
    style = { objectPosition: 'center' };
  } else {
    src = config.defaultSrc;
  }
  if (!src) {
    // activeTab default: the plain accent glow.
    return (
      <span className={`${base} bg-accent/15`} aria-hidden>
        <span className="absolute inset-0 bg-gradient-to-r from-accent/25 via-accent/10 to-transparent" />
      </span>
    );
  }
  return (
    <span className={base} aria-hidden>
      <img src={src} alt="" className="h-full w-full object-cover opacity-80" style={style} />
      <span className="absolute inset-0 bg-gradient-to-r from-bg-primary/70 via-bg-primary/30 to-transparent" />
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
  // user can preview a different source before committing).
  const [draftKind, setDraftKind] = useState<AppearanceBgKind>('default');
  const editLoadId = useRef(0);

  const close = useCallback(() => {
    setEditing(null);
    setCropSource(null);
    setRestoredCrop(undefined);
    setError(null);
    setBusy(false);
  }, []);

  // Close the modal on Escape.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, close]);

  const openEditor = (surface: AppearanceSurface) => {
    const current = resolveAppearanceBg(settings, surface);
    setEditing(surface);
    setError(null);
    setBusy(false);
    setDraftKind(current.kind);
    setCropSource(null);
    setRestoredCrop(undefined);
    if (current.kind === 'custom') void loadEdit(surface);
  };

  // Seed the cropper with the stored original + crop so reopening restores the
  // exact framing (best-effort: falls back to the baked image, then empty).
  const loadEdit = async (surface: AppearanceSurface) => {
    const loadId = ++editLoadId.current;
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

  // Default / None apply immediately and close; if leaving custom, drop the
  // stored bytes so they don't linger.
  const chooseKind = async (kind: AppearanceBgKind) => {
    if (!editing || !editingConfig) return;
    setDraftKind(kind);
    setError(null);
    if (kind === 'default' || kind === 'none') {
      if (resolveAppearanceBg(settings, editing).kind === 'custom') {
        await removeAppearanceImage(editing);
      }
      await persist(editing, { kind });
      close();
      return;
    }
    if (kind === 'hero') {
      setCropSource(null);
      return;
    }
    // custom: load any prior edit to seed the cropper.
    setCropSource(null);
    setRestoredCrop(undefined);
    void loadEdit(editing);
  };

  const chooseHero = async (hero: string) => {
    if (!editing) return;
    await persist(editing, { kind: 'hero', hero });
    close();
  };

  // Picking a NEW source discards the restored crop so the cropper centers it.
  const stageSource = (dataUrl: string) => {
    editLoadId.current++;
    setRestoredCrop(undefined);
    setCropSource(dataUrl);
  };

  const pickCustom = async () => {
    if (busy) return;
    const path = await showOpenDialog({
      title: t('settings.appearance.art.uploadImage', 'Upload image'),
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!path) return;
    try {
      const dataUrl = await readImageDataUrl(path);
      stageSource(dataUrl);
    } catch (err) {
      console.error('Failed to read custom image', err);
      setError(t('settings.appearance.art.applyError', 'Could not apply that image.'));
    }
  };

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
      await persist(editing, { kind: 'custom' });
      close();
    } catch (err) {
      console.error('Failed to set appearance image', err);
      setError(t('settings.appearance.art.applyError', 'Could not apply that image.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
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
              className="group flex items-center gap-3 rounded-sm border border-white/10 bg-bg-tertiary/40 p-2 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <SurfacePreview
                bg={bg}
                config={config}
                customSrc={appearanceImages[config.id]}
                className="h-9 w-16 flex-shrink-0"
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

      {editing && editingConfig && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
          onClick={close}
          role="presentation"
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-sm border border-white/10 bg-bg-secondary p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.appearance.art.editNamed', {
              surface: t(editingConfig.labelKey, editingConfig.fallbackLabel),
            })}
          >
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-text-primary tracking-wide font-reaver">
                {t(editingConfig.labelKey, editingConfig.fallbackLabel)}
              </h3>
              <button
                type="button"
                onClick={close}
                title={t('common.actions.close')}
                aria-label={t('common.actions.close')}
                className="flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-text-secondary transition-colors hover:border-white/25 hover:bg-white/5 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Source-kind tabs */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              {kindsFor(editingConfig).map((kind) => {
                const active = draftKind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => void chooseKind(kind)}
                    aria-pressed={active}
                    className={`rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active
                        ? 'border-accent/70 bg-accent/15 text-text-primary'
                        : 'border-white/10 bg-bg-tertiary text-text-secondary hover:border-accent/40 hover:text-text-primary'
                    }`}
                  >
                    {t(`settings.appearance.art.kind.${kind}`)}
                  </button>
                );
              })}
            </div>

            {draftKind === 'hero' && (
              <div className="grid max-h-[50vh] grid-cols-5 gap-2 overflow-y-auto sm:grid-cols-6">
                {HERO_NAMES_SORTED.map((heroName) => {
                  const current = resolveAppearanceBg(settings, editing);
                  const active = current.kind === 'hero' && (current.hero ?? DEFAULT_SIDEBAR_HERO) === heroName;
                  return (
                    <button
                      key={heroName}
                      type="button"
                      onClick={() => void chooseHero(heroName)}
                      title={heroName}
                      aria-label={heroName}
                      aria-pressed={active}
                      className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-sm border bg-bg-tertiary transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        active
                          ? 'border-accent/70 bg-accent/15'
                          : 'border-white/10 hover:border-accent/50 hover:bg-accent/10'
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
            )}

            {draftKind === 'custom' && (
              <div className="space-y-3">
                <LockerImageCropper
                  imageDataUrl={cropSource}
                  aspect={SURFACE_ASPECT}
                  initialCrop={restoredCrop}
                  emptyHint={t('settings.appearance.art.uploadHint', 'Upload an image to frame it.')}
                  busy={busy}
                  onApply={applyCrop}
                />
                <Button variant="secondary" size="sm" onClick={() => void pickCustom()} disabled={busy}>
                  <Upload className="h-4 w-4" />
                  <Tx k="settings.appearance.art.uploadImage" fallback="Upload image" />
                </Button>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
