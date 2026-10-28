import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useHeroCategoryStore } from '../../stores/heroCategoryStore';
import { installedSkinPreviewTarget } from '../../lib/installedSkinTarget';
import { ErrorBoundary } from '../common/ErrorBoundary';
import type { SkinEditSource } from '../../types/skinEditor';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
type Preview = { key: string; name: string; target: SkinEditSource; left: number; top: number; width: number; height: number };

/** Three warm viewers at most. Only the hovered viewer renders frames. */
export default function InstalledSkinPreview({ hideNsfw }: { hideNsfw: boolean }) {
  const settings = useAppStore(state => state.settings);
  const mods = useAppStore(state => state.mods);
  if (!settings?.experimentalFoundry) return null;
  // Replacements, reorder and profile changes must never reuse a stale stack.
  const revision = JSON.stringify([settings.devMode ? settings.devDeadlockPath : settings.deadlockPath,
    hideNsfw, mods.map(mod => [mod.metaKey, mod.sha256, mod.size, mod.installedAt, mod.priority, mod.skinEdit, mod.nsfw])]);
  return <PreviewCache key={revision} hideNsfw={hideNsfw} />;
}

function PreviewCache({ hideNsfw }: { hideNsfw: boolean }) {
  const { t } = useTranslation();
  const mods = useAppStore((state) => state.mods);
  const heroByCategoryId = useHeroCategoryStore(state => state.heroByCategoryId);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cached, setCached] = useState<Preview[]>([]);
  const cachedKeys = useRef(new Set<string>());
  useEffect(() => { cachedKeys.current = new Set(cached.map(item => item.key)); }, [cached]);
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
      const target = installedSkinPreviewTarget(mod, mods, heroByCategoryId);
      if (!target) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24), height = Math.min(360, window.innerHeight - 24);
      const left = rect.right + width + 12 <= window.innerWidth ? rect.right + 8 : Math.max(12, rect.left - width - 8);
      const top = Math.max(12, Math.min(rect.top, window.innerHeight - height - 12));
      const next = { key: JSON.stringify(target), target, name: mod.name, left, top, width, height };
      timer = setTimeout(() => {
        setCached(current => [...current.filter(item => item.key !== next.key), next].slice(-3));
        setPreview(next);
      }, cachedKeys.current.has(next.key) ? 0 : 120);
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
  }, [mods, hideNsfw, heroByCategoryId]);
  return createPortal(<>{cached.map(item => <aside key={item.key} hidden={item.key !== preview?.key}
    aria-label={t('installed.card.preview3d', { name: item.name })}
    className="pointer-events-none fixed z-50 overflow-hidden rounded-sm border border-border bg-bg-secondary shadow-xl"
    style={{ left: item.left, top: item.top, width: item.width, height: item.height }}>
    <div className="relative h-full">
      <ErrorBoundary><Suspense fallback={<p role="status" className="p-4 text-xs text-text-secondary">{t('foundry.skin.loading')}</p>}>
        <HeroPoseViewer {...item.target} compact active={item.key === preview?.key} />
      </Suspense></ErrorBoundary>
      <p className="absolute inset-x-0 bottom-0 truncate border-t border-border bg-bg-secondary/95 px-3 py-2 text-xs">{item.name}</p>
    </div>
  </aside>)}</>, document.body);
}
