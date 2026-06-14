import { useEffect, useMemo, useState } from 'react';
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
import CardCropper from './CardCropper';
import type { CustomCardSlot, HeroPortrait } from '../../types/portrait';

interface HeroCardPickerProps {
  heroName: string;
}

const VARIANT_LABEL: Record<string, string> = {
  card: 'Card',
  vertical: 'Vertical',
  card_critical: 'Low HP',
  card_gloat: 'Gloat',
  minimap: 'Minimap',
  small: 'Small',
  other: 'Other',
};

/** Display order for the variant strip. The full "card" cover reads first,
 *  then the rest roughly by prominence; unknown variants sort last. */
const VARIANT_ORDER = ['card', 'vertical', 'card_critical', 'card_gloat', 'minimap', 'small', 'other'];

function variantRank(variant: string): number {
  const i = VARIANT_ORDER.indexOf(variant);
  return i === -1 ? VARIANT_ORDER.length : i;
}

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

/**
 * EXPERIMENTAL: surfaces the hero card/portrait art the user's installed mods
 * ship (decoded on demand via `vpkmerge portrait`) and applies the chosen one.
 * Applying splits that hero's `panorama/images/heroes/<codename>_` art out of
 * its source mod and folds it into a single Locker-managed cosmetics VPK that
 * wins by load order. Clicking the active card again reverts to default.
 */
export default function HeroCardPicker({ heroName }: HeroCardPickerProps) {
  const loadMods = useAppStore((s) => s.loadMods);
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
        title: `Choose an image for the ${VARIANT_LABEL[slot.variant] ?? slot.variant} card`,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
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
        title: `Export ${heroName} custom card`,
        defaultPath: `${safeName}_custom_card_dir.vpk`,
        filters: [{ name: 'VPK addon', extensions: ['vpk'] }],
      });
      if (!destPath) return;
      setExporting(true);
      const written = await exportCustomHeroCard(heroName, uploads, destPath);
      showToast(`Exported to ${written}`, { tone: 'success', duration: 6000 });
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
      variants: [...variants].sort((a, b) => variantRank(a.variant) - variantRank(b.variant)),
    }));
  }, [portraits]);

  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <div className="flex items-center gap-2">
        <Images className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Hero Card</h3>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Experimental
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        Card art found in your installed mods. Each mod may ship several portrait
        variants; click a card to apply that mod's full set for {heroName}, and click
        the applied card again to revert to default.
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" /> Decoding portraits...
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="break-words">{actionError}</span>
        </div>
      )}

      {!loading && !error && fileGroups.length === 0 && (
        <p className="py-2 text-xs text-text-secondary">
          No card art found in your installed mods for {heroName}.
        </p>
      )}

      {fileGroups.length > 0 && (
        <div className="space-y-2.5">
          {fileGroups.map((group) => {
            const isApplied = activeSource === group.modFileName;
            const isBusy = busySource === group.modFileName;
            return (
              <button
                type="button"
                key={group.modFileName}
                disabled={busySource !== null}
                onClick={() => handlePick(group.modFileName)}
                title={`${group.modFileName} · ${group.variants.length} portrait(s)`}
                // Card tokens shared with the Skins grid / Global view so the
                // Cards tab reads as a sibling of Skins: accent border + glow
                // when applied, dim glass at rest. backdrop-blur on the resting
                // state too since these sit directly over the hero portrait.
                className={`group relative block w-full overflow-hidden rounded-[10px] border text-left backdrop-blur-sm transition-[border-color,background-color,box-shadow] duration-200 disabled:cursor-not-allowed ${
                  isApplied
                    ? 'border-accent bg-accent/[0.08] shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-6px_var(--color-accent)] hover:bg-accent/[0.12]'
                    : 'border-white/[0.08] bg-[#141414]/55 hover:border-white/[0.16]'
                } ${busySource !== null && !isBusy ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
                  <span className="truncate text-xs font-semibold text-text-primary">
                    {group.modFileName.replace(/_dir\.vpk$/, '')}
                  </span>
                  {isApplied ? (
                    <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-foreground">
                      <Check className="h-2.5 w-2.5" /> Applied
                    </span>
                  ) : (
                    <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-text-secondary">
                      {group.variants.length} portrait{group.variants.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {/* Uniform aspect-3/4 tiles in a fixed grid keep the strip tidy
                    regardless of each variant's native aspect. max-w/h-full
                    contains the art without ever upscaling it, so tiny minimap
                    art stays crisp instead of blurring up to a forced height. */}
                <div className="grid grid-cols-4 gap-2 p-3">
                  {group.variants.map((p, i) => (
                    <figure key={`${p.variant}:${i}`} className="min-w-0">
                      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-border/50 bg-bg-primary/40">
                        <img
                          src={p.dataUrl}
                          alt={`${heroName} ${VARIANT_LABEL[p.variant] ?? p.variant}`}
                          title={`${VARIANT_LABEL[p.variant] ?? p.variant} · ${p.width}x${p.height} · ${p.formatName}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <figcaption className="mt-1 truncate text-center text-[9px] uppercase tracking-wide text-text-secondary">
                        {VARIANT_LABEL[p.variant] ?? p.variant}
                      </figcaption>
                    </figure>
                  ))}
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
          className={`space-y-3 rounded-[10px] border p-3 backdrop-blur-sm transition-[border-color,box-shadow] duration-200 ${
            customApplied
              ? 'border-accent bg-accent/[0.08] shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-6px_var(--color-accent)]'
              : 'border-white/[0.08] bg-[#141414]/55'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Upload className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-text-primary">Upload your own</span>
            </div>
            {customApplied ? (
              <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-foreground">
                <Check className="h-2.5 w-2.5" /> Applied
              </span>
            ) : (
              <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-text-secondary">
                {slots.length} slot{slots.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-[11px] leading-snug text-text-secondary">
            Click a slot to choose an image and crop it to that variant's exact size. Fill only the
            variants you want to change, then apply. Unfilled variants stay default.
          </p>

          {/* One tile per variant the base game ships. An empty slot shows the
              default art dimmed with an upload hint; a filled slot shows the
              cropped result with a clear (x) button. Each tile keeps the
              variant's true aspect so the preview matches the in-game shape. */}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {slots.map((slot) => {
              const pick = picks[slot.variant];
              return (
                <figure key={slot.variant} className="relative min-w-0">
                  <button
                    type="button"
                    disabled={customBusy}
                    onClick={() => handlePickVariant(slot)}
                    title={`${VARIANT_LABEL[slot.variant] ?? slot.variant} · ${slot.width} x ${slot.height}`}
                    style={{ aspectRatio: `${slot.width} / ${slot.height}` }}
                    className="group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border/50 bg-bg-primary/40 transition-colors hover:border-accent/50 disabled:cursor-not-allowed"
                  >
                    <img
                      src={pick ?? slot.baseDataUrl}
                      alt={`${heroName} ${VARIANT_LABEL[slot.variant] ?? slot.variant}`}
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
                      title="Clear image"
                      aria-label={`Clear ${VARIANT_LABEL[slot.variant] ?? slot.variant} image`}
                      className="absolute right-1 top-1 z-10 cursor-pointer rounded-full bg-black/75 p-1 text-white/90 shadow-sm ring-1 ring-white/10 transition-colors hover:bg-black/90 hover:text-white disabled:cursor-not-allowed"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <figcaption className="mt-1 text-center">
                    <span className="block truncate text-[9px] uppercase tracking-wide text-text-secondary">
                      {VARIANT_LABEL[slot.variant] ?? slot.variant}
                    </span>
                    <span className="block text-[9px] tabular-nums text-text-secondary/70">
                      {slot.width} x {slot.height}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
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
                ? 'Applying...'
                : customApplied && !dirty
                  ? 'Applied'
                  : customApplied
                    ? 'Update custom card'
                    : 'Apply custom card'}
            </button>
            <button
              type="button"
              disabled={exporting || customBusy || !hasPicks}
              onClick={handleExportCustom}
              title="Save this custom card as a standalone .vpk file"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-white/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export VPK
            </button>
            {customApplied && (
              <button
                type="button"
                disabled={customBusy}
                onClick={handleRevertCustom}
                className="inline-flex cursor-pointer items-center rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-white/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Revert
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
          variantLabel={VARIANT_LABEL[cropping.slot.variant] ?? cropping.slot.variant}
          onCancel={() => setCropping(null)}
          onCrop={handleCropDone}
        />
      )}
    </section>
  );
}
