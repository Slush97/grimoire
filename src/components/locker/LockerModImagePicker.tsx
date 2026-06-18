import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Upload, Trash2, Copy } from 'lucide-react';
import type { Mod } from '../../types/mod';
import type { GameBananaImage } from '../../types/gamebanana';
import { Modal } from '../common/Modal';
import {
  getModDetails,
  readImageDataUrl,
  showOpenDialog,
  fetchLockerImageDataUrl,
} from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
import LockerImageCropper from './LockerImageCropper';

/** Which surface the picker is choosing an image for. The card is the 3:4
 *  skin-panel card; the thumbnail is the 3:4 image on the main Locker hero-grid
 *  card; the background is the wide 16:9 hero-detail backdrop. The thumbnail and
 *  background can both mirror the card selection in one click. */
type PickerVariant = 'card' | 'thumbnail' | 'background';

/**
 * Issue #208: pick the image that represents a skin in the Locker. A single
 * tabbed surface covers the skin's 3:4 panel card (with the hero-name overlay),
 * the 3:4 thumbnail on the main hero grid, and the hero-detail backdrop (16:9),
 * so the formerly-separate menus are unified per skin. Sources are the mod's own
 * GameBanana gallery (shown at full aspect so nothing is cropped before you
 * choose) plus a custom upload, and (thumbnail / background) a one-click mirror
 * of the card image. The left pane is a live crop adjuster locked to the active
 * tab's shape; it shows the framing surface up front (empty) and frames whatever
 * source you pick on the right. The framed image is stored locally per skin.
 */
export function LockerModImagePicker({
  mod,
  skinKey,
  heroName,
  initialVariant = 'card',
  cardImageDataUrl,
  onClose,
}: {
  mod: Mod;
  skinKey: string;
  heroName: string;
  /** Which tab opens first. */
  initialVariant?: PickerVariant;
  /** The skin's current card image, offered as a "Use Locker image" mirror in
   *  the thumbnail and background tabs. */
  cardImageDataUrl?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();

  const [tab, setTab] = useState<PickerVariant>(initialVariant);

  // Read every per-surface store slice up front (hooks can't be conditional),
  // then resolve the ones the active tab needs below.
  const lockerModImages = useAppStore((s) => s.lockerModImages);
  const lockerModThumbnails = useAppStore((s) => s.lockerModThumbnails);
  const lockerModBackgrounds = useAppStore((s) => s.lockerModBackgrounds);
  const lockerHideHeroName = useAppStore((s) => s.lockerHideHeroName);
  const lockerThumbHideHeroName = useAppStore((s) => s.lockerThumbHideHeroName);
  const lockerBgHideHeroName = useAppStore((s) => s.lockerBgHideHeroName);
  const setCardImage = useAppStore((s) => s.setLockerModImage);
  const setThumbnail = useAppStore((s) => s.setLockerModThumbnail);
  const setBackground = useAppStore((s) => s.setLockerModBackground);
  const setCardHideName = useAppStore((s) => s.setLockerModImageHideName);
  const setThumbHideName = useAppStore((s) => s.setLockerModThumbnailHideName);
  const setBgHideName = useAppStore((s) => s.setLockerModBackgroundHideName);
  const removeCardImage = useAppStore((s) => s.removeLockerModImage);
  const removeThumbnail = useAppStore((s) => s.removeLockerModThumbnail);
  const removeBackground = useAppStore((s) => s.removeLockerModBackground);

  // Per-surface config, resolved for the active tab.
  const surface = {
    card: {
      aspect: 3 / 4,
      namePosition: 'card' as const,
      override: lockerModImages[skinKey],
      hideName: lockerHideHeroName[skinKey],
      setImage: setCardImage,
      setHide: setCardHideName,
      remove: removeCardImage,
    },
    thumbnail: {
      aspect: 3 / 4,
      namePosition: 'card' as const,
      override: lockerModThumbnails[skinKey],
      hideName: lockerThumbHideHeroName[skinKey],
      setImage: setThumbnail,
      setHide: setThumbHideName,
      remove: removeThumbnail,
    },
    background: {
      aspect: 16 / 9,
      namePosition: 'backdrop' as const,
      override: lockerModBackgrounds[skinKey],
      hideName: lockerBgHideHeroName[skinKey],
      setImage: setBackground,
      setHide: setBgHideName,
      remove: removeBackground,
    },
  }[tab];

  const hasOverride = Boolean(surface.override);
  const initialHideHeroName = Boolean(surface.hideName);
  // The card image can be mirrored into the thumbnail and backdrop in one click.
  const showMirror = tab !== 'card' && Boolean(cardImageDataUrl);

  const [images, setImages] = useState<GameBananaImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The image being framed in the crop adjuster (as a data URL), null = none.
  const [cropSource, setCropSource] = useState<string | null>(null);

  // Switching tabs swaps the target aspect, so any staged framing no longer
  // applies; clear it back to the empty preview for the new surface.
  const switchTab = (next: PickerVariant) => {
    if (next === tab) return;
    setTab(next);
    setCropSource(null);
    setError(null);
  };

  // Pull the mod's gallery from GameBanana. Local-only mods (no id) skip this
  // and just offer the custom upload + current thumbnail. Shared across tabs.
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

  // Stage a chosen gallery image (a remote URL or data URL) into the adjuster.
  const stageGallery = async (url: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = url.startsWith('data:') ? url : await fetchLockerImageDataUrl(url);
      setCropSource(dataUrl);
    } catch (err) {
      console.error('Failed to load gallery image for cropping', err);
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
      setCropSource(dataUrl);
    } catch (err) {
      console.error('Failed to read custom image', err);
      setError(t('locker.modImage.applyError'));
    }
  };

  // Commit the framed image (+ the hero-name choice) for the active tab, close.
  const applyCrop = async ({
    dataUrl,
    hideHeroName,
  }: {
    dataUrl: string;
    hideHeroName: boolean;
  }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await surface.setImage(skinKey, dataUrl);
      await surface.setHide(skinKey, hideHeroName);
      onClose();
    } catch (err) {
      console.error('Failed to set Locker skin image', err);
      setError(t('locker.modImage.applyError'));
      setCropSource(null);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await surface.remove(skinKey);
      onClose();
    } catch (err) {
      console.error('Failed to remove Locker skin image', err);
      setError(t('locker.modImage.applyError'));
    } finally {
      setBusy(false);
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

  const tabClass = (active: boolean) =>
    `relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? 'border-accent text-text-primary'
        : 'border-transparent text-text-secondary hover:text-text-primary'
    }`;

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      size="none"
      panelClassName="flex max-h-[90vh] w-full max-w-3xl flex-col"
    >
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

      {/* Tabs: the skin-panel card (3:4) is the default; the grid thumbnail
          (3:4) and the backdrop (16:9) are independent per-skin surfaces. */}
      <div className="flex gap-1 overflow-x-auto border-b border-border px-4">
        <button type="button" onClick={() => switchTab('card')} className={tabClass(tab === 'card')}>
          {t('locker.modImage.tabCard')}
        </button>
        <button
          type="button"
          onClick={() => switchTab('thumbnail')}
          className={tabClass(tab === 'thumbnail')}
        >
          {t('locker.modImage.tabThumbnail')}
        </button>
        <button
          type="button"
          onClick={() => switchTab('background')}
          className={tabClass(tab === 'background')}
        >
          {t('locker.modImage.tabBackground')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* Left pane: live crop adjuster, locked to the active tab's shape. Shown
            empty up front so the framing surface is previewed before a pick.
            Sized to the window by the cropper; scrolls itself only as a fallback
            on very short windows so it never clips. */}
        <div className="flex-shrink-0 overflow-y-auto">
          <LockerImageCropper
            key={tab}
            imageDataUrl={cropSource}
            aspect={surface.aspect}
            nameControls
            namePosition={surface.namePosition}
            heroName={heroName}
            initialHideHeroName={initialHideHeroName}
            emptyHint={t('locker.modImage.cropEmptyHint')}
            busy={busy}
            onApply={applyCrop}
          />
        </div>

        {/* Right pane: source picker (upload + gallery), scrolls independently. */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {showMirror && (
            <button
              type="button"
              onClick={() => !busy && setCropSource(cardImageDataUrl ?? null)}
              disabled={busy}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/5 py-3 text-sm font-medium text-text-primary transition-colors hover:border-accent/70 hover:bg-accent/10 disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              {t('locker.modImage.useLockerImage')}
            </button>
          )}
          <button
            type="button"
            onClick={pickCustom}
            disabled={busy}
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
              {/* Masonry: each image at its natural aspect so nothing is cropped
                  before you pick. Framing happens in the crop adjuster after. */}
              <div className="columns-2 gap-2 [&>*]:mb-2">
                {choices.map((choice) => (
                  <button
                    key={choice.full}
                    type="button"
                    onClick={() => stageGallery(choice.full)}
                    disabled={busy}
                    className="group relative block w-full break-inside-avoid overflow-hidden rounded-lg border border-border bg-bg-tertiary transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none disabled:opacity-50"
                  >
                    <img
                      src={choice.thumb}
                      alt=""
                      className="block h-auto w-full transition-transform duration-200 group-hover:scale-105"
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
      </div>
    </Modal>
  );
}
