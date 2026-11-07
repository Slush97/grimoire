import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, MoveDiagonal, MoveDiagonal2, Pin, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useCategoryStore } from '../../stores/categoryStore';
import { installedSkinPreviewTarget } from '../../lib/installedSkinTarget';
import { installedPropTarget, type PropPreviewTarget } from '../../lib/installedPropPreview';
import { PIN_PREVIEW_EVENT, pinInstalledPreview, type PreviewPin } from '../../lib/installedPreviewPin';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { IconButton } from '../common/ui';
import type { SkinEditSource } from '../../types/skinEditor';
import type { Mod } from '../../types/mod';

const HeroPoseViewer = lazy(() => import('../locker/HeroPoseViewer'));
const PropModelViewer = lazy(() => import('./PropModelViewer'));
type PreviewTarget = { kind: 'hero'; source: SkinEditSource } | ({ kind: 'prop' } & PropPreviewTarget);
type Shown = { key: string; target: PreviewTarget; name: string; counter?: string };
type Peek = Shown & { pin: PreviewPin; left: number; top: number; width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };

/** Warm viewers kept around, so stepping back and forth through a few files stays instant. */
const WARM_VIEWERS = 4;
/** Wheel distance per file step: one mouse notch, or a short trackpad swipe. */
const WHEEL_STEP = 50;
/** Alt+drag turn rate: one full turn per 360px. */
const TURN_PER_PX = (Math.PI * 2) / 360;
/** Pinned panel: opens at the right edge below the page toolbar, then goes wherever it is dragged. */
const PANEL = { width: 360, height: 480, margin: 16, top: 64, minWidth: 240, minHeight: 280 };
const PANEL_STORAGE_KEY = 'grimoire.installed.previewPanel';

function defaultBox(): Box {
  return { x: window.innerWidth - PANEL.width - PANEL.margin, y: PANEL.top, width: PANEL.width, height: PANEL.height };
}

/** Keeps the panel on screen and no larger than the window. */
function fitBox(box: Box): Box {
  const width = Math.min(Math.max(PANEL.minWidth, box.width), window.innerWidth - 2 * PANEL.margin);
  const height = Math.min(Math.max(PANEL.minHeight, box.height), window.innerHeight - 2 * PANEL.margin);
  return {
    width, height,
    x: Math.min(Math.max(PANEL.margin, box.x), window.innerWidth - width - PANEL.margin),
    y: Math.min(Math.max(PANEL.margin, box.y), window.innerHeight - height - PANEL.margin),
  };
}

function readBox(): Box {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) ?? 'null');
    if (raw && typeof raw === 'object' && (['x', 'y', 'width', 'height'] as const).every(k => Number.isFinite((raw as Record<string, unknown>)[k]))) return raw as Box;
  } catch { /* storage may be unavailable */ }
  return defaultBox();
}

function saveBox(box: Box): void {
  try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(box)); } catch { /* storage may be unavailable */ }
}

const inPreview = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-installed-preview]');

const variantLabel = (mod: Mod) => mod.variantLabel ?? mod.fileDescription ?? mod.sourceFileName ?? mod.fileName;
const stepPin = (pin: PreviewPin, by: number): PreviewPin => ({ keys: pin.keys, index: (pin.index + by + pin.keys.length) % pin.keys.length });

function previewKeysOf(anchor: HTMLElement): string[] {
  const own = anchor.dataset.modPreviewKey;
  try {
    const keys: unknown = JSON.parse(anchor.dataset.modPreviewVariants ?? 'null');
    if (Array.isArray(keys) && keys.every(key => typeof key === 'string') && keys.length) return keys;
  } catch { /* fall through to the card's own file */ }
  return own ? [own] : [];
}

/**
 * Hold Alt over a card to peek at it in 3D. Alt+drag turns the model without limit (the peek stays on
 * that card until Alt is released), and Alt+wheel steps through a grouped card's files. The peek sits
 * against the card's edge, so the mouse can move onto it: it then stays without Alt until the mouse
 * leaves it, and works like the pinned panel. Alt+click, the card menu or the peek's pin button pins
 * it to a panel that stays open and can be moved and resized; Alt-peeking another card then swaps
 * into the panel.
 * Only the visible viewer renders frames.
 */
export default function InstalledSkinPreview({ hideNsfw }: { hideNsfw: boolean }) {
  const settings = useAppStore(state => state.settings);
  const mods = useAppStore(state => state.mods);
  // Lives above the cache so a mod toggle (which rebuilds the cache) keeps the panel open.
  const [pin, setPin] = useState<PreviewPin | null>(null);
  const [box, setBox] = useState<Box>(readBox);
  if (!settings) return null;
  // Replacements, reorder and profile changes must never reuse a stale stack.
  const revision = JSON.stringify([settings.devMode ? settings.devDeadlockPath : settings.deadlockPath,
    hideNsfw, mods.map(mod => [mod.metaKey, mod.sha256, mod.size, mod.installedAt, mod.priority, mod.skinEdit, mod.nsfw])]);
  return <PreviewCache key={revision} hideNsfw={hideNsfw} pin={pin} setPin={setPin} box={box} setBox={setBox} />;
}

function PreviewCache({ hideNsfw, pin, setPin, box, setBox }: {
  hideNsfw: boolean;
  pin: PreviewPin | null;
  setPin: Dispatch<SetStateAction<PreviewPin | null>>;
  box: Box;
  setBox: Dispatch<SetStateAction<Box>>;
}) {
  const { t } = useTranslation();
  const mods = useAppStore((state) => state.mods);
  const taxonomyContext = useCategoryStore(useShallow(state => ({
    heroByCategoryId: state.heroByCategoryId, heroNames: state.heroNames, pathsByModel: state.pathsByModel,
  })));
  const [peek, setPeek] = useState<Peek | null>(null);
  const [cached, setCached] = useState<Shown[]>([]);
  const cachedKeys = useRef(new Set<string>());
  useEffect(() => { cachedKeys.current = new Set(cached.map(item => item.key)); }, [cached]);
  const pinRef = useRef(pin);
  useEffect(() => { pinRef.current = pin; }, [pin]);
  // Model angle while peeking (radians, null is front-on), turned by Alt+drag.
  const turn = useRef<number | null>(null);

  const resolve = useCallback((keys: readonly string[], index: number): Shown | null => {
    const mod = mods.find((item) => item.metaKey === keys[index]);
    if (!mod || (hideNsfw && mod.nsfw)) return null;
    const hero = installedSkinPreviewTarget(mod, mods, taxonomyContext);
    const prop = hero ? null : installedPropTarget(mod);
    const target: PreviewTarget | null = hero ? { kind: 'hero', source: hero } : prop ? { kind: 'prop', ...prop } : null;
    if (!target) return null;
    return keys.length > 1
      ? { key: JSON.stringify(target), target, name: variantLabel(mod), counter: `${index + 1}/${keys.length}` }
      : { key: JSON.stringify(target), target, name: mod.name };
  }, [mods, hideNsfw, taxonomyContext]);
  const warm = useCallback((item: Shown) => {
    setCached(current => [...current.filter(entry => entry.key !== item.key), item].slice(-WARM_VIEWERS));
  }, []);
  /** Pins `next` (null unpins). A file with nothing to show leaves the panel as it is. */
  const pinTo = useCallback((next: PreviewPin | null) => {
    const item = next ? resolve(next.keys, next.index) : null;
    if (next && !item) return;
    if (item) warm(item);
    setPin(next);
  }, [resolve, warm, setPin]);
  const pinned = useMemo(() => pin ? resolve(pin.keys, pin.index) : null, [pin, resolve]);

  useEffect(() => {
    let anchor: HTMLElement | null = null;
    let keys: string[] = [];
    let index = 0;
    let wheel = 0;
    let alt = false;
    let dismissed = false;
    // An Alt+drag in progress, and whether the peek stays on its card until Alt is released.
    let drag: { id: number; x: number; moved: boolean; card: HTMLElement } | null = null;
    let held = false;
    // The mouse is on the peek itself: it stays open without Alt until the mouse leaves it.
    let reached = false;
    let swallowClick = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => { clearTimeout(timer); setPeek(null); };
    const hide = () => { reached = false; close(); };
    // Switching files leaves the current peek up until the next one is ready, so the mouse never
    // falls through a gap onto the card below.
    const show = () => {
      clearTimeout(timer);
      if (!(alt || reached) || !anchor || dismissed) { setPeek(null); return; }
      const item = resolve(keys, index);
      if (!item) { setPeek(null); return; }
      const delay = cachedKeys.current.has(item.key) ? 0 : 120;
      if (pinRef.current) {
        const next = { keys, index };
        timer = setTimeout(() => pinTo(next), delay);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24), height = Math.min(360, window.innerHeight - 24);
      // Flush against the card, so moving onto the peek never crosses another card.
      const left = rect.right + width + 12 <= window.innerWidth ? rect.right : Math.max(12, rect.left - width);
      const top = Math.max(12, Math.min(rect.top, window.innerHeight - height - 12));
      const pin = { keys, index };
      timer = setTimeout(() => { warm(item); setPeek({ ...item, pin, left, top, width, height }); }, delay);
    };
    const over = (event: PointerEvent) => {
      if (drag || held) return;
      alt = event.altKey;
      if (inPreview(event.target)) {
        if (anchor && !pinRef.current) reached = true;
        return;
      }
      const left = reached;
      reached = false;
      const next = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-mod-preview-key]') : null;
      if (next === anchor) { if (left) show(); return; }
      anchor = next; dismissed = false;
      keys = next ? previewKeysOf(next) : [];
      index = Math.max(0, keys.indexOf(next?.dataset.modPreviewKey ?? ''));
      wheel = 0;
      turn.current = null;
      show();
    };
    const out = (event: PointerEvent) => { if (!event.relatedTarget && !drag && !held) { anchor = null; hide(); } };
    // Alt+drag grabs the peeked card: the pointer is captured, so leaving the card keeps turning it.
    const press = (event: PointerEvent) => {
      swallowClick = false;
      if (!event.altKey || event.button !== 0 || !anchor || dismissed) return;
      if (!(event.target instanceof Element) || !anchor.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      anchor.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, moved: false, card: anchor };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!drag.moved) { drag.moved = true; held = true; drag.card.style.cursor = 'grabbing'; }
      drag.x = event.clientX;
      turn.current = (turn.current ?? 0) + dx * TURN_PER_PX;
    };
    const release = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag.card.style.cursor = '';
      swallowClick = drag.moved;
      drag = null;
    };
    // Stops text selection and native drag-and-drop from starting under an Alt+drag.
    const mousedown = (event: MouseEvent) => {
      if (event.altKey && event.button === 0 && event.target instanceof Node && anchor?.contains(event.target)) event.preventDefault();
    };
    // Alt+wheel steps through a grouped card's files (or the pinned panel's) instead of scrolling.
    const step = (event: WheelEvent) => {
      if (!event.altKey) return;
      const inPanel = event.target instanceof Element && !!event.target.closest('[data-installed-preview-panel]');
      const current = inPanel ? pinRef.current : anchor && !dismissed ? { keys, index } : null;
      if (!current || current.keys.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      wheel += event.deltaY;
      if (Math.abs(wheel) < WHEEL_STEP) return;
      const by = Math.sign(wheel);
      wheel = 0;
      if (inPanel) { pinTo(stepPin(current, by)); return; }
      index = (index + by + keys.length) % keys.length;
      show();
    };
    // Alt+click pins the card instead of its usual click.
    const click = (event: MouseEvent) => {
      if (swallowClick) { swallowClick = false; event.preventDefault(); event.stopPropagation(); return; }
      if (!event.altKey || event.button !== 0) return;
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-mod-preview-key]') : null;
      if (!card) return;
      const cardKeys = previewKeysOf(card);
      const cardIndex = card === anchor ? index : Math.max(0, cardKeys.indexOf(card.dataset.modPreviewKey ?? ''));
      if (!resolve(cardKeys, cardIndex)) return;
      event.preventDefault();
      event.stopPropagation();
      hide();
      pinTo({ keys: cardKeys, index: cardIndex });
    };
    const pinEvent = (event: Event) => { hide(); pinTo((event as CustomEvent<PreviewPin>).detail); };
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pinRef.current) pinTo(null);
        else { dismissed = true; hide(); }
      }
      if (event.key === 'Alt' && !alt) { alt = true; dismissed = false; show(); }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key !== 'Alt' && event.altKey) return;
      alt = false; held = false;
      if (!reached) close();
    };
    const blur = () => { alt = false; held = false; anchor = null; hide(); };
    // Right-drag pans inside the peek, which ends in a contextmenu event: that one must not close it.
    const menu = (event: MouseEvent) => { if (!inPreview(event.target)) hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('mousedown', mousedown, true);
    document.addEventListener('click', click, true);
    window.addEventListener(PIN_PREVIEW_EVENT, pinEvent);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('wheel', step, { capture: true, passive: false });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('contextmenu', menu);
    return () => {
      close();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('mousedown', mousedown, true);
      if (drag) drag.card.style.cursor = '';
      document.removeEventListener('click', click, true);
      window.removeEventListener(PIN_PREVIEW_EVENT, pinEvent);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('wheel', step, { capture: true });
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('contextmenu', menu);
    };
  }, [resolve, warm, pinTo]);

  // A rebuilt cache (after a mod change) still has the pinned file to show.
  const viewers = pinned && !cached.some(item => item.key === pinned.key) ? [...cached, pinned].slice(-WARM_VIEWERS) : cached;
  const panel = fitBox(box);
  // The resize grip sits on the bottom corner facing the middle of the window, so a panel against
  // either edge can still grow.
  const growLeft = panel.x + panel.width / 2 > window.innerWidth / 2;
  const reshape = (event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize') => {
    if (event.button !== 0 || (mode === 'move' && event.target instanceof Element && event.target.closest('button'))) return;
    event.preventDefault();
    const element = event.currentTarget;
    const from = { x: event.clientX, y: event.clientY };
    let last = panel;
    const follow = (moved: PointerEvent) => {
      const dx = moved.clientX - from.x, dy = moved.clientY - from.y;
      if (mode === 'move') last = fitBox({ ...panel, x: panel.x + dx, y: panel.y + dy });
      else if (growLeft) {
        const right = panel.x + panel.width;
        const width = Math.min(Math.max(PANEL.minWidth, panel.width - dx), right - PANEL.margin);
        last = fitBox({ x: right - width, y: panel.y, width, height: panel.height + dy });
      } else last = fitBox({ ...panel, width: panel.width + dx, height: panel.height + dy });
      setBox(last);
    };
    const stop = () => {
      element.removeEventListener('pointermove', follow);
      element.removeEventListener('pointerup', stop);
      element.removeEventListener('pointercancel', stop);
      saveBox(last);
    };
    element.setPointerCapture(event.pointerId);
    element.addEventListener('pointermove', follow);
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointercancel', stop);
  };
  return createPortal(<>{viewers.map(item => {
    const isPinned = item.key === pinned?.key;
    const shown = pinned ? isPinned : item.key === peek?.key;
    const label = isPinned ? pinned : peek;
    return <aside key={item.key} hidden={!shown} data-installed-preview data-installed-preview-panel={isPinned || undefined}
      aria-label={t('installed.card.preview3d', { name: label?.name ?? '' })}
      className="fixed z-50 overflow-hidden rounded-sm border border-border bg-bg-secondary shadow-xl"
      style={isPinned ? { left: panel.x, top: panel.y, width: panel.width, height: panel.height }
        : shown && peek ? { left: peek.left, top: peek.top, width: peek.width, height: peek.height } : undefined}>
      <div className="flex h-full flex-col">
        {isPinned && pin && <div onPointerDown={(event) => reshape(event, 'move')}
          className="flex cursor-grab touch-none items-center gap-1 border-b border-border py-1 pr-1 pl-3 text-xs select-none active:cursor-grabbing">
          <span className="min-w-0 flex-1 truncate">{pinned.name}</span>
          {pinned.counter && <>
            <IconButton size="sm" icon={ChevronLeft} label={t('installed.preview.previousFile')} onClick={() => pinTo(stepPin(pin, -1))} />
            <span className="tabular-nums text-text-secondary">{pinned.counter}</span>
            <IconButton size="sm" icon={ChevronRight} label={t('installed.preview.nextFile')} onClick={() => pinTo(stepPin(pin, 1))} />
          </>}
          <IconButton size="sm" icon={X} label={t('common.actions.close')} onClick={() => pinTo(null)} />
        </div>}
        <div className="relative min-h-0 flex-1">
          <ErrorBoundary><Suspense fallback={<p role="status" className="p-4 text-xs text-text-secondary">{t('foundry.skin.loading')}</p>}>
            {item.target.kind === 'hero'
              ? <HeroPoseViewer {...item.target.source} compact active={shown} turn={turn} />
              : <PropModelViewer metaKey={item.target.metaKey} cacheKey={item.target.cacheKey} entry={item.target.entry} active={shown} turn={turn} />}
          </Suspense></ErrorBoundary>
          {!isPinned && peek && shown && <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-border bg-bg-secondary/95 py-1 pr-1 pl-3 text-xs">
            <span className="min-w-0 flex-1 truncate">{peek.name}</span>
            {peek.counter && <span className="shrink-0 tabular-nums text-text-secondary">{peek.counter}</span>}
            <IconButton size="sm" icon={Pin} label={t('installed.preview.pin')}
              onClick={() => pinInstalledPreview(peek.pin.keys, peek.pin.keys[peek.pin.index] ?? '')} />
          </div>}
          {isPinned && <div onPointerDown={(event) => reshape(event, 'resize')} title={t('installed.preview.resize')}
            className={`absolute bottom-0 flex h-5 w-5 touch-none items-center justify-center text-text-tertiary hover:text-text-primary ${growLeft ? 'left-0 cursor-nesw-resize' : 'right-0 cursor-nwse-resize'}`}>
            {growLeft ? <MoveDiagonal className="h-3 w-3" aria-hidden /> : <MoveDiagonal2 className="h-3 w-3" aria-hidden />}
          </div>}
        </div>
      </div>
    </aside>;
  })}</>, document.body);
}
