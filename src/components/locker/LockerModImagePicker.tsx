import { useEffect, useId, useRef, useState } from 'react';
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
  getLockerModImageEdit,
  setLockerModImageEdit,
} from '../../lib/api';
import type { CropRect } from '../../types/electron';
import { useAppStore } from '../../stores/appStore';
import LockerImageCropper from './LockerImageCropper';

/** Which surface the picker is choosing an image for. NOTE the display labels
 *  are inverted from these internal names (the names map to the storage dirs and
 *  can't change without migrating saved images):
 *    - `thumbnail` -> labelled "Locker image": the 3:4 image on the main Locker
 *      hero-grid card. The prominent surface, so it's the default tab.
 *    - `card`      -> labelled "Card thumbnail": the 16:9 skin-panel card
 *      (aspect-video media) in the hero detail view.
 *    - `background`-> labelled "Background": the wide 16:9 hero-detail backdrop.
 *  The card and background tabs can both mirror the "Locker image" (thumbnail)
 *  selection in one click. */
type PickerVariant = 'card' | 'thumbnail' | 'background';

/**
 * Issue #208: pick the image that represents a skin in the Locker. A single
 * tabbed surface covers the skin's 16:9 panel card (with the hero-name overlay),
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
  initialVariant = 'thumbnail',
  lockerImageDataUrl,
  onClose,
}: {
  mod: Mod;
  skinKey: string;
  heroName: string;
  /** Which tab opens first. */
  initialVariant?: PickerVariant;
  /** The skin's current "Locker image" (the grid-thumbnail surface), offered as
   *  a one-click "Use Locker image" mirror on the Card thumbnail and Background
   *  tabs. */
  lockerImageDataUrl?: string;
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

  // Per-surface config, resolved for the active tab. `namePreview` shows the
  // hero-name overlay in the cropper where the real surface renders one;
  // `allowHideName` shows the "hide hero name" toggle. The hero name is only
  // baked over the image on the main hero-grid card (the thumbnail surface), so
  // that's the only tab with the toggle. The skin-panel card prints its title as
  // separate text (no overlay), and the backdrop's name logo is its own page
  // layer (not part of the framed image), so neither previews a name.
  const surface = {
    card: {
      // The skin-panel card media is aspect-video (16:9), so frame to match it
      // (issue #208 follow-up). The baked 16:9 output then drops cleanly into the
      // card's object-cover with no re-crop.
      aspect: 16 / 9,
      namePosition: 'card' as const,
      namePreview: false,
      allowHideName: false,
      override: lockerModImages[skinKey],
      hideName: lockerHideHeroName[skinKey],
      setImage: setCardImage,
      setHide: setCardHideName,
      remove: removeCardImage,
    },
    thumbnail: {
      aspect: 3 / 4,
      namePosition: 'card' as const,
      namePreview: true,
      allowHideName: true,
      override: lockerModThumbnails[skinKey],
      hideName: lockerThumbHideHeroName[skinKey],
      setImage: setThumbnail,
      setHide: setThumbHideName,
      remove: removeThumbnail,
    },
    background: {
      aspect: 16 / 9,
      namePosition: 'backdrop' as const,
      // The hero-detail page draws the hero-name logo as its own layer over the
      // backdrop, never baked into the backdrop image. So previewing a name over
      // the background you're framing is misleading: the framed image carries no
      // name. Don't overlay one here.
      namePreview: false,
      allowHideName: false,
      override: lockerModBackgrounds[skinKey],
      hideName: lockerBgHideHeroName[skinKey],
      setImage: setBackground,
      setHide: setBgHideName,
      remove: removeBackground,
    },
  }[tab];

  const hasOverride = Boolean(surface.override);
  const initialHideHeroName = Boolean(surface.hideName);
  // The Locker image (grid thumbnail) can be mirrored into the card and backdrop
  // in one click; it's the only surface that never shows the mirror (you can't
  // mirror it onto itself).
  const showMirror = tab !== 'thumbnail' && Boolean(lockerImageDataUrl);

  // The stored (baked) override for a given surface, used to seed the editor so
  // reopening shows the last crop instead of an empty frame and the user can
  // adjust from there (issue #208 follow-up).
  const overrideFor = (v: PickerVariant) =>
    v === 'card'
      ? lockerModImages[skinKey]
      : v === 'thumbnail'
        ? lockerModThumbnails[skinKey]
        : lockerModBackgrounds[skinKey];

  const [images, setImages] = useState<GameBananaImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The image being framed in the crop adjuster (as a data URL), null = none.
  // Seeded with the active surface's existing image so the editor opens on the
  // last crop rather than empty.
  const [cropSource, setCropSource] = useState<string | null>(
    () => overrideFor(initialVariant) ?? null
  );
  // When the active surface has a stored full-fidelity edit (original source +
  // crop), this holds its crop rect so the cropper restores the exact framing
  // (and the user can zoom out / pan to reveal area cropped outside the baked
  // frame). Undefined = no stored edit; the cropper centers the baked seed / a
  // freshly picked source instead.
  const [restoredCrop, setRestoredCrop] = useState<CropRect | undefined>(undefined);

  // Identifies the latest edit-load request so a slow fetch from a previous tab
  // can't clobber the current one (the cropper remounts per tab via key={tab},
  // but the async result still has to be discarded if the tab changed again).
  // Also flipped to a fresh value on unmount via `mounted` so a late resolve is a
  // no-op rather than a setState on an unmounted component.
  const editLoadId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Load the stored full-fidelity edit (original source + crop) for a tab. If
  // present, swap the cropper onto the original at the saved framing; if absent,
  // leave the synchronous baked-seed behavior and clear any restored crop.
  const loadEdit = (variant: PickerVariant) => {
    const reqId = ++editLoadId.current;
    getLockerModImageEdit(variant, skinKey)
      .then((edit) => {
        if (!mounted.current || editLoadId.current !== reqId) return; // stale
        if (edit) {
          setCropSource(edit.source);
          setRestoredCrop(edit.crop);
        } else {
          setRestoredCrop(undefined);
        }
      })
      .catch(() => {
        // Non-fatal: degrade to the baked-seed framing already in cropSource.
        if (mounted.current && editLoadId.current === reqId) setRestoredCrop(undefined);
      });
  };

  // On open, try to upgrade the initial tab's baked seed to its full edit.
  useEffect(() => {
    loadEdit(initialVariant);
    // Runs once on mount; subsequent tab loads go through switchTab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching tabs swaps the target aspect, so any staged framing no longer
  // applies; reseed with the new surface's stored image (or empty if none), then
  // try to upgrade to its full-fidelity edit.
  const switchTab = (next: PickerVariant) => {
    if (next === tab) return;
    setTab(next);
    setCropSource(overrideFor(next) ?? null);
    setRestoredCrop(undefined);
    setError(null);
    loadEdit(next);
  };

  // Picking a NEW source (gallery / upload / mirror) discards the restored crop
  // so the cropper centers the new pick instead of forcing the old framing.
  const stageSource = (dataUrl: string) => {
    editLoadId.current++; // cancel any in-flight edit load for this tab
    setRestoredCrop(undefined);
    setCropSource(dataUrl);
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
      stageSource(dataUrl);
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
      stageSource(dataUrl);
    } catch (err) {
      console.error('Failed to read custom image', err);
      setError(t('locker.modImage.applyError'));
    }
  };

  // Commit the framed image (+ the hero-name choice) for the active tab, close.
  // Also persists the ORIGINAL source + normalized crop rect so the editor can be
  // reopened on the exact framing and reveal area cropped outside the baked frame.
  const applyCrop = async ({
    dataUrl,
    hideHeroName,
    source,
    crop,
  }: {
    dataUrl: string;
    hideHeroName: boolean;
    source: string;
    crop: CropRect;
  }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await surface.setImage(skinKey, dataUrl);
      await surface.setHide(skinKey, hideHeroName);
      // The full-fidelity edit (original + crop) is a best-effort resume aid; if
      // it fails to store, the baked image + hide flag still persisted above, so
      // don't let it block the save or the close (the editor just degrades to a
      // baked seed on the next open).
      try {
        await setLockerModImageEdit(tab, skinKey, source, crop);
      } catch (editErr) {
        console.error('Failed to store Locker image edit (resume framing)', editErr);
      }
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

      {/* Tabs: the grid thumbnail (3:4) leads as the default since it's the most
          visible surface (and the only one that bakes the hero name over the
          image); the skin-panel card (16:9) and the backdrop (16:9) follow as
          independent per-skin surfaces. */}
      <div className="flex gap-1 overflow-x-auto border-b border-border px-4">
        <button
          type="button"
          onClick={() => switchTab('thumbnail')}
          className={tabClass(tab === 'thumbnail')}
        >
          {t('locker.modImage.tabThumbnail')}
        </button>
        <button type="button" onClick={() => switchTab('card')} className={tabClass(tab === 'card')}>
          {t('locker.modImage.tabCard')}
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
            nameControls={surface.namePreview}
            allowHideName={surface.allowHideName}
            namePosition={surface.namePosition}
            heroName={heroName}
            initialHideHeroName={initialHideHeroName}
            initialCrop={restoredCrop}
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
              onClick={() => {
                // Mirror only renders when lockerImageDataUrl is present.
                if (!busy && lockerImageDataUrl) stageSource(lockerImageDataUrl);
              }}
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
