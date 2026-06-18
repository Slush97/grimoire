import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Sparkles, Upload, Trash2 } from 'lucide-react';
import type { Mod } from '../../types/mod';
import type { GameBananaImage } from '../../types/gamebanana';
import type { HeroPoseSkinSource } from '../../types/portrait';
import { Modal } from '../common/Modal';
import { getModDetails, readImageDataUrl, showOpenDialog } from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { HeroCardBaker } from '../../lib/heroCardBake';

/**
 * Issue #208: pick the image that represents a skin in the Locker. Sources are
 * the mod's own GameBanana gallery (fetched on demand) plus a custom upload.
 * The chosen image is stored locally (per skin) and used for the skin's card +
 * the hero card backdrop when this skin is active.
 */
export function LockerModImagePicker({
  mod,
  skinKey,
  heroName,
  skinSources,
  onClose,
}: {
  mod: Mod;
  skinKey: string;
  /** Canonical hero name, when this skin belongs to a hero. Enables the
   *  "Generate from installed skin" 3D bake action. */
  heroName?: string;
  /** Enabled visual VPK stack for the hero (load order), fed to the 3D bake.
   *  Omitted for sound mods / unassigned skins (no bake offered). */
  skinSources?: HeroPoseSkinSource[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const hasOverride = useAppStore((s) => Boolean(s.lockerModImages[skinKey]));
  const setImage = useAppStore((s) => s.setLockerModImage);
  const removeImage = useAppStore((s) => s.removeLockerModImage);
  const applyCardImage = useAppStore((s) => s.applyLockerCardImage);
  const showToast = useToastStore((s) => s.showToast);

  const [images, setImages] = useState<GameBananaImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [baking, setBaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The bake is only meaningful for a hero with at least one enabled skin in
  // the stack (the model is posed from the equipped look).
  const canBake = Boolean(heroName && skinSources && skinSources.length > 0);

  // Pull the mod's gallery from GameBanana. Local-only mods (no id) skip this
  // and just offer the custom upload + current thumbnail.
  useEffect(() => {
    if (typeof mod.gameBananaId !== 'number' || mod.gameBananaId <= 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getModDetails(mod.gameBananaId, mod.sourceSection)
      .then((details) => {
        if (!cancelled) setImages(details.previewMedia?.images ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(t('locker.modImage.galleryError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mod.gameBananaId, mod.sourceSection, t]);

  const apply = async (source: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setImage(skinKey, source);
      onClose();
    } catch (err) {
      console.error('Failed to set Locker skin image', err);
      setError(t('locker.modImage.applyError'));
    } finally {
      setBusy(false);
    }
  };

  const pickCustom = async () => {
    if (busy) return;
    const path = await showOpenDialog({
      title: t('locker.modImage.dialogTitle'),
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!path) return;
    try {
      const dataUrl = await readImageDataUrl(path);
      await apply(dataUrl);
    } catch (err) {
      console.error('Failed to read custom image', err);
      setError(t('locker.modImage.applyError'));
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeImage(skinKey);
      onClose();
    } catch (err) {
      console.error('Failed to remove Locker skin image', err);
      setError(t('locker.modImage.applyError'));
    } finally {
      setBusy(false);
    }
  };

  // Bake a 3D snapshot of the equipped skin over its panorama backdrop and
  // store it as this skin's Locker image. Uses a throwaway one-shot baker (a
  // single render, then disposed) since this is a single-card action.
  const generateFromSkin = async () => {
    if (busy || baking || !heroName || !skinSources) return;
    setBaking(true);
    setError(null);
    const baker = new HeroCardBaker();
    try {
      const dataUrl = await baker.bakeHeroCard(heroName, skinKey, skinSources);
      // bakeHeroCard already persisted the PNG via the main process; just sync
      // the store so the open Locker card refreshes without a reload.
      applyCardImage(skinKey, dataUrl);
      onClose();
    } catch (err) {
      console.error('Failed to bake Locker card from skin', err);
      setError(t('locker.cardBake.error'));
      showToast(t('locker.cardBake.errorToast', { hero: heroName }), { tone: 'error' });
    } finally {
      baker.dispose();
      setBaking(false);
    }
  };

  // Gallery choices, plus the mod's own thumbnail if it isn't already the first
  // gallery image (local mods often have only the thumbnail).
  const galleryUrls = images.map((img) => ({
    full: `${img.baseUrl}/${img.file}`,
    thumb: `${img.baseUrl}/${img.file530 || img.file}`,
  }));
  const choices =
    galleryUrls.length > 0
      ? galleryUrls
      : mod.thumbnailUrl
        ? [{ full: mod.thumbnailUrl, thumb: mod.thumbnailUrl }]
        : [];

  return (
    <Modal onClose={onClose} labelledBy={titleId} size="lg" panelClassName="flex max-h-[80vh] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-base font-semibold text-text-primary">
            {t('locker.modImage.title')}
          </h2>
          <p className="truncate text-xs text-text-secondary" title={mod.name}>
            {mod.name}
          </p>
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-red-500/60 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('locker.modImage.reset')}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {canBake && (
          <div className="mb-4">
            <button
              type="button"
              onClick={generateFromSkin}
              disabled={busy || baking}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/50 bg-accent/10 py-3 text-sm font-medium text-text-primary transition-colors hover:border-accent/70 hover:bg-accent/20 disabled:opacity-50"
            >
              {baking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {baking ? t('locker.cardBake.generating') : t('locker.cardBake.generate')}
            </button>
            <p className="mt-1.5 px-0.5 text-center text-[11px] leading-snug text-text-secondary">
              {t('locker.cardBake.hint')}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={pickCustom}
          disabled={busy || baking}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm font-medium text-text-secondary transition-colors hover:border-accent/60 hover:text-text-primary disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {t('locker.modImage.uploadCustom')}
        </button>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('locker.modImage.loadingGallery')}
          </div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-red-400">{error}</div>
        ) : choices.length > 0 ? (
          <>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t('locker.modImage.fromMod')}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {choices.map((choice) => (
                <button
                  key={choice.full}
                  type="button"
                  onClick={() => apply(choice.full)}
                  disabled={busy}
                  className="group relative aspect-video overflow-hidden rounded-lg border border-border bg-bg-tertiary transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none disabled:opacity-50"
                >
                  <img
                    src={choice.thumb}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    loading="lazy"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
                    <Check className="h-6 w-6 text-white" />
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-sm text-text-secondary">
            {t('locker.modImage.noGallery')}
          </div>
        )}
      </div>
    </Modal>
  );
}
