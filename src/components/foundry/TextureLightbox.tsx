import { useEffect, useState } from 'react';
import { ImageOff, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { foundryFullImage } from '../../lib/api';
import type { TextureGridItem } from '../../types/foundry';

interface TextureLightboxProps {
  /** The asset to enlarge, or null when closed. Drives the Modal open state so
   *  the exit animation plays on close. */
  item: TextureGridItem | null;
  /** Resolved hero display name for item.hero, when the codename maps to one. */
  heroName?: string;
  onClose: () => void;
}

/**
 * Enlarge-on-click preview for a Foundry texture/icon. The grid thumbnail is
 * 128px; clicking a card decodes the entry at full size on demand (main-side,
 * served over the grimoire-foundry: scheme) and shows it here. While the
 * full-res decode is in flight the 128px thumb stands in (scaled up, so the
 * modal never flashes empty); a decode failure falls back to that thumb too.
 */
export default function TextureLightbox({ item, heroName, onClose }: TextureLightboxProps) {
  const { t } = useTranslation();
  // The full-res result is tagged with the path it belongs to, so `loading` and
  // `fullUrl` derive from whether it matches the open asset. This keeps the
  // effect free of synchronous resets (it only sets state in the async callback).
  const [full, setFull] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    const { category, path } = item;
    foundryFullImage(category, path)
      .then((url) => {
        if (!cancelled) setFull({ path, url });
      })
      .catch(() => {
        if (!cancelled) setFull({ path, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  const resolved = item && full?.path === item.path ? full : null;
  const loading = !!item && !resolved;
  const fullUrl = resolved?.url ?? null;
  const display = fullUrl ?? item?.thumbUrl ?? null;
  const dims =
    item?.sourceWidth && item?.sourceHeight ? `${item.sourceWidth} x ${item.sourceHeight}` : null;

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      size="none"
      panelClassName="max-w-3xl flex flex-col"
      backdropClassName="bg-black/80"
    >
      {item && (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold capitalize text-text-primary" title={item.label}>
                {item.label || t('foundry.lightbox.unnamed', '(unnamed)')}
              </h2>
              <p className="truncate text-xs text-text-secondary" title={item.path}>
                {heroName ? `${heroName} · ` : ''}
                {item.path}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-sm p-1 text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              aria-label={t('common.actions.close', 'Close')}
            >
              <X size={18} />
            </button>
          </div>

          <div className="relative flex min-h-[280px] items-center justify-center bg-bg-tertiary p-6">
            {display ? (
              <img
                src={display}
                alt={item.label}
                className="max-h-[60vh] w-auto max-w-full object-contain [image-rendering:auto]"
                draggable={false}
              />
            ) : (
              <ImageOff size={40} className="text-text-secondary/40" />
            )}
            {loading && (
              <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-sm bg-black/50 px-2 py-1 text-[11px] text-white/80">
                <Loader2 size={12} className="animate-spin" />
                {t('foundry.lightbox.decoding', 'Decoding full size...')}
              </div>
            )}
          </div>

          {dims && (
            <div className="border-t border-border px-4 py-2 text-[11px] text-text-secondary">
              {t('foundry.lightbox.nativeSize', 'Native size')}: {dims}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
