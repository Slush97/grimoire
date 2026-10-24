import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { installedSkinTarget } from '../../lib/installedSkinTarget';
import { ErrorBoundary } from '../common/ErrorBoundary';
import type { SkinEditSource } from '../../types/skinEditor';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
type Preview = { name: string; target: SkinEditSource; left: number; top: number; width: number; height: number };

/** One transient WebGL viewer for the whole Installed page. */
export default function InstalledSkinPreview({ hideNsfw }: { hideNsfw: boolean }) {
  const { t } = useTranslation();
  const mods = useAppStore((state) => state.mods);
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    let anchor: HTMLElement | null = null;
    let alt = false;
    let dismissed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => { clearTimeout(timer); setPreview(null); };
    const show = () => {
      close();
      if (!alt || !anchor || dismissed) return;
      const mod = mods.find((item) => item.metaKey === anchor?.dataset.modPreviewKey);
      if (!mod || (hideNsfw && mod.nsfw)) return;
      const target = installedSkinTarget(mod);
      if (!target) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24), height = Math.min(360, window.innerHeight - 24);
      const left = rect.right + width + 12 <= window.innerWidth ? rect.right + 8 : Math.max(12, rect.left - width - 8);
      const top = Math.max(12, Math.min(rect.top, window.innerHeight - height - 12));
      timer = setTimeout(() => setPreview({ target, name: mod.name, left, top, width, height }), 180);
    };
    const over = (event: PointerEvent) => {
      const next = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-mod-preview-key]') : null;
      if (next === anchor) return;
      anchor = next; dismissed = false; alt = event.altKey;
      show();
    };
    const out = (event: PointerEvent) => { if (!event.relatedTarget) { anchor = null; close(); } };
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { dismissed = true; close(); }
      if (event.key === 'Alt' && !alt) { alt = true; dismissed = false; show(); }
    };
    const up = (event: KeyboardEvent) => { if (event.key === 'Alt' || !event.altKey) { alt = false; close(); } };
    const blur = () => { alt = false; anchor = null; close(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('contextmenu', close);
    return () => {
      close();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [mods, hideNsfw]);
  if (!preview) return null;
  return createPortal(<aside aria-label={t('installed.card.preview3d', { name: preview.name })}
    className="pointer-events-none fixed z-50 overflow-hidden rounded-sm border border-border bg-bg-secondary shadow-xl"
    style={{ left: preview.left, top: preview.top, width: preview.width, height: preview.height }}>
    <div className="relative h-full">
      <ErrorBoundary key={preview.target.skinSources[0]?.metaKey}><Suspense fallback={<p role="status" className="p-4 text-xs text-text-secondary">{t('foundry.skin.loading')}</p>}>
        <HeroPoseViewer key={JSON.stringify(preview.target)} {...preview.target} compact />
      </Suspense></ErrorBoundary>
      <p className="absolute inset-x-0 bottom-0 truncate border-t border-border bg-bg-secondary/95 px-3 py-2 text-xs">{preview.name}</p>
    </div>
  </aside>, document.body);
}
