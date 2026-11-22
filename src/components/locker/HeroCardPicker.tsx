import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Images, Loader2, AlertCircle, Check, Upload, X, Download } from 'lucide-react';
import {
  applyCustomHeroCard,
  applyHeroCard,
  exportCustomHeroCard,
  getActiveHeroCard,
  getAppliedCustomCard,
  getCustomCardSlots,
  getHeroPortraits,
  readImageDataUrl,
  revealPath,
  revertHeroCard,
  showOpenDialog,
  showSaveDialog,
} from '../../lib/api';
import { showToast } from '../../stores/toastStore';
import { useAppStore } from '../../stores/appStore';
import { heroCardVariantLabel, heroCardVariantRank } from '../../lib/heroCardVariants';
import CardCropper from './CardCropper';
import type { CustomCardSlot, HeroPortrait } from '../../types/portrait';

interface HeroCardPickerProps {
  heroName: string;
}

// About 75% of the old full-width tiles before moving another pair to the next row.
const PORTRAIT_GRID_CLASS = 'grid grid-cols-[repeat(2,minmax(0,8rem))] justify-center gap-2 @min-[26rem]/portraits:grid-cols-[repeat(4,minmax(0,8rem))] @min-[39.25rem]/portraits:grid-cols-[repeat(6,minmax(0,8rem))]';

/** A cheap order-independent fingerprint of the current picks, used to tell
 *  whether the slots differ from what was last applied (drives the Apply vs
 *  Applied vs Update button state). Length + tail avoids hashing whole data
 *  URLs while staying collision-safe in practice. */
function picksSignature(picks: Record<string, string>): string {
  return Object.keys(picks)
    .sort()
    .map((v) => `${v}#${picks[v].length}#${picks[v].slice(-32)}`)
    .join('|');
}

interface PortraitFileGroup {
  modFileName: string;
  variants: HeroPortrait[];
}

/** Keep the filename secondary, and give long names the whole available row. */
function PortraitSourceLabel({ name, fileName }: { name: string; fileName: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const fileRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const container = containerRef.current, label = nameRef.current, file = fileRef.current;
    const bar = container?.parentElement;
    if (!container || !label || !file || !bar) return;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const style = getComputedStyle(bar);
      const width = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const hide = name === fileName || label.scrollWidth >= width / 2;
      file.hidden = hide;
      label.style.flexShrink = hide ? '1' : '0';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar); observer.observe(label);
    void document.fonts?.ready.then(update);
    return () => { cancelled = true; observer.disconnect(); };
  }, [name, fileName]);
  return <span ref={containerRef} className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden" data-portrait-source-label>
    <span ref={nameRef} className="min-w-0 truncate text-sm font-semibold text-text-primary" title={name}>{name}</span>
    <span ref={fileRef} hidden className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={fileName}>{fileName}</span>
  </span>;
}

/**
 * EXPERIMENTAL: surfaces the hero card/portrait art the user's installed mods
 * ship (decoded on demand via `vpkmerge portrait`) and applies the chosen one.
 * Applying splits that hero's `panorama/images/heroes/<codename>_` art out of
 * its source mod and folds it into a single Locker-managed cosmetics VPK that
 * wins by load order. Clicking the active card again reverts to default.
 */
export default function HeroCardPicker({ heroName }: HeroCardPickerProps) {
  const { t } = useTranslation();
  const loadMods = useAppStore((s) => s.loadMods);
  const mods = useAppStore(s => s.mods);
  const modsByKey = useMemo(() => new Map(mods.map(mod => [mod.metaKey, mod])), [mods]);
  // This component is remounted per hero (the parent LockerHeroView is keyed
  // by hero.id), so initial state stands in for the per-hero reset.
  const [portraits, setPortraits] = useState<HeroPortrait[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The source VPK filename whose card is currently applied for this hero.
  const [activeSource, setActiveSource] = useState<string | null>(null);
  // The source filename mid-apply/revert (drives the per-tile spinner).
  const [busySource, setBusySource] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Custom-upload state: the base-derived variant slots, the user's chosen PNG
  // per variant (path + preview data URL), and a busy flag during build.
  const [slots, setSlots] = useState<CustomCardSlot[]>([]);
  // Per-variant cropped output, keyed by variant: a PNG data URL already at the
  // variant's exact target size (produced by the cropper).
  const [picks, setPicks] = useState<Record<string, string>>({});
  // Signature of the picks last applied (or restored from disk on load), so we
  // can show Applied when nothing changed and re-enable on edit. null = unapplied.
  const [appliedSig, setAppliedSig] = useState<string | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The variant currently open in the cropper, with its source image + slot.
  const [cropping, setCropping] = useState<{ slot: CustomCardSlot; sourceDataUrl: string } | null>(
    null
  );

  const customApplied = activeSource?.startsWith('custom:') ?? false;
  const picksSig = useMemo(() => picksSignature(picks), [picks]);
  const hasPicks = Object.keys(picks).length > 0;
  // Dirty == there are picks that differ from what's applied. Drives the button.
  const dirty = hasPicks && picksSig !== appliedSig;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPicks({});
    setAppliedSig(null);
    Promise.all([
      getHeroPortraits(heroName),
      getActiveHeroCard(heroName),
      getCustomCardSlots(heroName),
      // Restore the user's previously-applied custom art so it persists across
      // restarts (the applied card lives on disk; this re-decodes it to data URLs).
      getAppliedCustomCard(heroName),
    ])
      .then(([list, activeCard, cardSlots, applied]) => {
        if (!active) return;
        setPortraits(list);
        setActiveSource(activeCard?.sourceFileName ?? null);
        setSlots(cardSlots);
        if (applied.length > 0) {
          const restored: Record<string, string> = {};
          for (const a of applied) restored[a.variant] = a.dataUrl;
          setPicks(restored);
          setAppliedSig(picksSignature(restored));
        }
      })
      .catch((err) => {
        if (active) setError(String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [heroName]);

  const handlePick = async (modFileName: string) => {
    if (busySource) return;
    setBusySource(modFileName);
    setActionError(null);
    try {
      if (activeSource === modFileName) {
        await revertHeroCard(heroName);
        setActiveSource(null);
      } else {
        const result = await applyHeroCard(heroName, modFileName);
        setActiveSource(result.activeSourceFileName);
      }
      // Rebuild changed the cosmetics VPK and possibly the load order; refresh
      // the shared mod list so Installed/Locker stay in sync.
      await loadMods({ silent: true });
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusySource(null);
    }
  };

  const handlePickVariant = async (slot: CustomCardSlot) => {
    if (customBusy) return;
    try {
      const path = await showOpenDialog({
        title: t('locker.cards.chooseImageForCard', {
          variant: heroCardVariantLabel(slot.variant, t),
        }),
        filters: [{ name: t('common.fileTypes.images'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (!path) return;
      const sourceDataUrl = await readImageDataUrl(path);
      setActionError(null);
      setCropping({ slot, sourceDataUrl });
    } catch (err) {
      setActionError(String(err));
    }
  };

  const handleCropDone = (dataUrl: string) => {
    if (!cropping) return;
    const variant = cropping.slot.variant;
    setPicks((prev) => ({ ...prev, [variant]: dataUrl }));
    setCropping(null);
  };

  const handleClearVariant = (variant: string) => {
    setPicks((prev) => {
      const next = { ...prev };
      delete next[variant];
      return next;
    });
  };

  const handleApplyCustom = async () => {
    const uploads = Object.entries(picks).map(([variant, dataUrl]) => ({ variant, dataUrl }));
    if (uploads.length === 0 || customBusy || !dirty) return;
    const sigAtApply = picksSig;
    setCustomBusy(true);
    setActionError(null);
    try {
      const result = await applyCustomHeroCard(heroName, uploads);
      setActiveSource(result.activeSourceFileName);
      // Mark these exact picks as applied so the button reads "Applied" until
      // the user changes a slot.
      setAppliedSig(sigAtApply);
      await loadMods({ silent: true });
    } catch (err) {
      setActionError(String(err));
    } finally {
      setCustomBusy(false);
    }
  };

  const handleRevertCustom = async () => {
    if (customBusy) return;
    setCustomBusy(true);
    setActionError(null);
    try {
      await revertHeroCard(heroName);
      setActiveSource(null);
      setPicks({});
      setAppliedSig(null);
      await loadMods({ silent: true });
    } catch (err) {
      setActionError(String(err));
    } finally {
      setCustomBusy(false);
    }
  };

  const handleExportCustom = async () => {
    const uploads = Object.entries(picks).map(([variant, dataUrl]) => ({ variant, dataUrl }));
    if (uploads.length === 0 || exporting || customBusy) return;
    setActionError(null);
    try {
      const safeName = heroName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const destPath = await showSaveDialog({
        title: t('locker.cards.exportDialogTitle', { hero: heroName }),
        defaultPath: `${safeName}_custom_card_dir.vpk`,
        filters: [{ name: t('common.fileTypes.vpkAddon'), extensions: ['vpk'] }],
      });
      if (!destPath) return;
      setExporting(true);
      const written = await exportCustomHeroCard(heroName, uploads, destPath);
      showToast(t('locker.cards.exportedToast', { path: written }), { tone: 'success', duration: 6000 });
      // Open the OS file browser at the exported file so they can find it.
      void revealPath(written);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setExporting(false);
    }
  };

  // Group every decoded portrait under the mod file it came from. A single
  // file usually ships several variants (card, vertical, low-HP, gloat...), and
  // apply works on the whole per-hero prefix, so the file is the selectable
  // unit and its variants are shown side by side for preview.
  const fileGroups = useMemo<PortraitFileGroup[]>(() => {
    const byFile = new Map<string, HeroPortrait[]>();
    for (const p of portraits) {
      const arr = byFile.get(p.modFileName) ?? [];
      arr.push(p);
      byFile.set(p.modFileName, arr);
    }
    return Array.from(byFile.entries()).map(([modFileName, variants]) => ({
      modFileName,
      variants: [...variants].sort((a, b) => heroCardVariantRank(a.variant) - heroCardVariantRank(b.variant)),
    }));
  }, [portraits]);

  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <div className="flex items-center gap-2">
        <Images className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">{t('locker.cards.heroCard')}</h3>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">
          {t('locker.cards.experimental')}
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        {t('locker.cards.intro', { hero: heroName })}
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('locker.cards.decodingPortraits')}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 py-2 text-xs text-state-danger">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 py-2 text-xs text-state-danger">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="break-words">{actionError}</span>
        </div>
      )}

      {!loading && !error && fileGroups.length === 0 && (
        <p className="py-2 text-xs text-text-secondary">
          {t('locker.cards.noCardArt', { hero: heroName })}
        </p>
      )}

      {fileGroups.length > 0 && (
        <div className="space-y-2.5">
          {fileGroups.map((group) => {
            const sourceMod = modsByKey.get(group.modFileName);
            const fileName = sourceMod?.fileName ?? group.modFileName.split(/[\\/]/).pop() ?? group.modFileName;
            const modName = sourceMod?.name ?? fileName;
            const isApplied = activeSource === group.modFileName;
            const isBusy = busySource === group.modFileName;
            return (
              <button
                type="button"
                key={group.modFileName}
                disabled={busySource !== null}
                onClick={() => handlePick(group.modFileName)}
                title={t('locker.cards.fileGroupTitle', {
                  file: group.modFileName,
                  count: group.variants.length,
                })}
                // Card tokens shared with the Skins grid / Global view so the
                // Cards tab reads as a sibling of Skins: accent border + glow
                // when applied, dim glass at rest. backdrop-blur on the resting
                // state too since these sit directly over the hero portrait.
                className={`group relative block w-full overflow-hidden rounded-[10px] border bg-bg-secondary/90 text-left backdrop-blur-sm transition-[border-color,background-color,box-shadow] duration-200 disabled:cursor-not-allowed ${
                  isApplied
                    ? 'border-accent shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-6px_var(--color-accent)]'
                    : 'border-hl/[0.08] hover:border-hl/[0.16]'
                } ${busySource !== null && !isBusy ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/50 bg-bg-secondary/95 px-3 py-2" data-portrait-source-header>
                  <PortraitSourceLabel name={modName} fileName={fileName} />
                  {isApplied ? (
                    <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-2xs font-semibold text-accent-foreground">
                      <Check className="h-2.5 w-2.5" /> {t('locker.cards.applied')}
                    </span>
                  ) : (
                    <span className="flex-shrink-0 text-2xs text-text-secondary">
                      {t('locker.cards.portraitCount', { count: group.variants.length })}
                    </span>
                  )}
                </div>
                {/* Uniform aspect-3/4 tiles in a responsive grid keep the strip tidy
                    regardless of each variant's native aspect. max-w/h-full
                    contains the art without ever upscaling it, so tiny minimap
                    art stays crisp instead of blurring up to a forced height. */}
                <div className="p-3">
                  <div className="@container/portraits">
                    <div className={PORTRAIT_GRID_CLASS} data-locker-portrait-grid>
                      {group.variants.map((p, i) => (
                        <figure key={`${p.variant}:${i}`} className="min-w-0">
                          <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-border/50 bg-bg-primary/40">
                            <img
                              src={p.dataUrl}
                              alt={`${heroName} ${heroCardVariantLabel(p.variant, t)}`}
                              title={`${heroCardVariantLabel(p.variant, t)} · ${p.width}x${p.height} · ${p.formatName}`}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <figcaption title={heroCardVariantLabel(p.variant, t)} className="mt-1 truncate text-center text-xs leading-5 text-text-primary">
                            {heroCardVariantLabel(p.variant, t)}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                </div>
                {isBusy && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && slots.length > 0 && (
        <div
          className={`space-y-3 rounded-[10px] border bg-bg-secondary/90 p-3 backdrop-blur-sm transition-[border-color,box-shadow] duration-200 ${
            customApplied
              ? 'border-accent shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-6px_var(--color-accent)]'
              : 'border-hl/[0.08]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Upload className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-text-primary">{t('locker.cards.uploadYourOwn')}</span>
            </div>
            {customApplied ? (
              <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-2xs font-semibold text-accent-foreground">
                <Check className="h-2.5 w-2.5" /> {t('locker.cards.applied')}
              </span>
            ) : (
              <span className="flex-shrink-0 text-2xs text-text-secondary">
                {t('locker.cards.slotCount', { count: slots.length })}
              </span>
            )}
          </div>
          <p className="text-2xs leading-snug text-text-secondary">
            {t('locker.cards.uploadInstructions')}
          </p>

          {/* One tile per variant the base game ships. An empty slot shows the
              default art dimmed with an upload hint; a filled slot shows the
              cropped result with a clear (x) button. Each tile keeps the
              variant's true aspect so the preview matches the in-game shape. */}
          <div className="@container/portraits">
            <div className={PORTRAIT_GRID_CLASS} data-locker-portrait-grid>
              {slots.map((slot) => {
                const pick = picks[slot.variant];
                return (
                  <figure key={slot.variant} className="relative min-w-0">
                    <button
                      type="button"
                      disabled={customBusy}
                      onClick={() => handlePickVariant(slot)}
                      title={`${heroCardVariantLabel(slot.variant, t)} · ${slot.width} x ${slot.height}`}
                      style={{ aspectRatio: `${slot.width} / ${slot.height}` }}
                      className="group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border/50 bg-bg-primary/40 transition-colors hover:border-accent/50 disabled:cursor-not-allowed"
                    >
                      <img
                        src={pick ?? slot.baseDataUrl}
                        alt={`${heroName} ${heroCardVariantLabel(slot.variant, t)}`}
                        className={`max-h-full max-w-full object-contain ${pick ? '' : 'opacity-30'}`}
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white/0 transition-colors group-hover:bg-black/55 group-hover:text-white/90">
                        <Upload className="h-4 w-4" />
                      </span>
                    </button>
                    {pick && (
                      <button
                        type="button"
                        disabled={customBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearVariant(slot.variant);
                        }}
                        title={t('locker.cards.clearImage')}
                        aria-label={t('locker.cards.clearVariantImage', {
                          variant: heroCardVariantLabel(slot.variant, t),
                        })}
                        className="absolute right-1 top-1 z-10 cursor-pointer rounded-full bg-black/75 p-1 text-white/90 shadow-sm ring-1 ring-hl/10 transition-colors hover:bg-black/90 hover:text-white disabled:cursor-not-allowed"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <figcaption className="mt-1 text-center">
                      <span title={heroCardVariantLabel(slot.variant, t)} className="block truncate text-xs leading-5 text-text-primary">
                        {heroCardVariantLabel(slot.variant, t)}
                      </span>
                      <span className="block truncate text-2xs tabular-nums text-text-secondary">
                        {slot.width} x {slot.height}
                      </span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              // Clickable only when there's something new to apply. After apply
              // it reads "Applied" and stays disabled until a slot changes.
              disabled={customBusy || !dirty}
              onClick={handleApplyCustom}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                customApplied && !dirty
                  ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                  : 'bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50'
              }`}
            >
              {customBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {customBusy
                ? t('locker.cards.applying')
                : customApplied && !dirty
                  ? t('locker.cards.applied')
                  : customApplied
                    ? t('locker.cards.updateCustomCard')
                    : t('locker.cards.applyCustomCard')}
            </button>
            <button
              type="button"
              disabled={exporting || customBusy || !hasPicks}
              onClick={handleExportCustom}
              title={t('locker.cards.exportVpkTitle')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-hl/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {t('locker.cards.exportVpk')}
            </button>
            {customApplied && (
              <button
                type="button"
                disabled={customBusy}
                onClick={handleRevertCustom}
                className="inline-flex cursor-pointer items-center rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-hl/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('locker.cards.revert')}
              </button>
            )}
          </div>
        </div>
      )}

      {cropping && (
        <CardCropper
          imageDataUrl={cropping.sourceDataUrl}
          targetWidth={cropping.slot.width}
          targetHeight={cropping.slot.height}
          variantLabel={heroCardVariantLabel(cropping.slot.variant, t)}
          onCancel={() => setCropping(null)}
          onCrop={handleCropDone}
        />
      )}
    </section>
  );
}
