import { useEffect, useRef, type RefObject } from 'react';
import { ELASTIC, rubberBand, rubberBandInverse, springSettled, springStep, wheelDeltaPx } from './elasticOverscroll';

const SCROLLS = /(auto|scroll|overlay)/;

/** In-flow direct children move with the bounce; sticky, fixed and absolute ones stay put. */
function bounceTargets(scroller: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of scroller.children) {
    if (!(child instanceof HTMLElement)) continue;
    // Leave alone anything that positions itself or carries its own transform.
    if (child.style.transform) continue;
    const position = getComputedStyle(child).position;
    if (position !== 'static' && position !== 'relative') continue;
    // A transform makes the element the containing block for its fixed
    // descendants, so one that is showing would jump. Skip the bounce then.
    for (const fixed of child.querySelectorAll<HTMLElement>('.fixed')) {
      if (fixed.getClientRects().length > 0) return [];
    }
    out.push(child);
  }
  return out;
}

/**
 * True when something between the wheel target and the scroller should keep
 * the event: a text field, a dialog, a fixed overlay, another elastic
 * scroller, or a nested scroller that can still move in that direction (or
 * stops scroll chaining).
 */
function claimedBelow(target: EventTarget | null, scroller: HTMLElement, down: boolean): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== scroller; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return true;
    if (el.dataset.elastic !== undefined || el.getAttribute('role') === 'dialog') return true;
    const style = getComputedStyle(el);
    if (style.position === 'fixed') return true;
    if (el.scrollHeight > el.clientHeight + 1 && SCROLLS.test(style.overflowY)) {
      const canMove = down ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0.5;
      if (canMove || style.overscrollBehaviorY !== 'auto') return true;
    }
  }
  return false;
}

/**
 * Rubber-band overscroll for a scroll container: a wheel or touchpad scroll
 * that pushes past the top or bottom drags the content a little way with
 * resistance, and an underdamped spring snaps it back (with a small
 * overshoot) once input stops.
 *
 * Passive listener, never preventDefault: native scrolling is untouched. The
 * in-flow children carry a transform only while displaced and go back to no
 * transform at rest, so sticky and fixed descendants behave normally. Nothing
 * runs per scroll event; the rAF loop exists only during a bounce.
 *
 * Chromium rubber-bands only the root scroller (macOS natively, Windows behind
 * the ElasticOverscroll flag). Grimoire's document never scrolls, so this
 * never doubles up with a native bounce.
 *
 * Follows the ref to whatever element it holds after each render, so a page
 * that swaps its scroller in after a loading state still gets the bounce.
 */
export function useElasticOverscroll(ref: RefObject<HTMLElement | null>): void {
  const bound = useRef<{ el: HTMLElement; detach: () => void } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (bound.current?.el === el) return;
    bound.current?.detach();
    bound.current = el ? { el, detach: attachElasticOverscroll(el) } : null;
  });
  useEffect(
    () => () => {
      bound.current?.detach();
      bound.current = null;
    },
    [],
  );
}

/** Wire the bounce to one scroller. Returns the teardown. */
function attachElasticOverscroll(scroller: HTMLElement): () => void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  scroller.dataset.elastic = '';

  let targets: HTMLElement[] = [];
  let offset = 0;
  let velocity = 0;
  let pull = 0;
  let pulling = false;
  let held = false;
  let lastInput = 0;
  let lastFrame = 0;
  let frame = 0;

  const paint = (y: number) => {
    const transform = y === 0 ? '' : `translate3d(0px, ${y.toFixed(2)}px, 0px)`;
    for (const el of targets) el.style.transform = transform;
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    paint(0);
    targets = [];
    offset = velocity = pull = 0;
    pulling = held = false;
  };

  const tick = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, now - lastFrame) / 1000);
    lastFrame = now;
    if (pulling && now - lastInput > ELASTIC.releaseDelayMs) pulling = false;
    const target = pulling ? rubberBand(pull) : 0;
    [offset, velocity] = pulling
      ? springStep(offset, velocity, target, ELASTIC.followRate, dt)
      : springStep(offset, velocity, target, ELASTIC.returnRate, dt, ELASTIC.returnDamping);
    if (!pulling && springSettled(offset, velocity, 0)) {
      stop();
      return;
    }
    paint(offset);
    frame = requestAnimationFrame(tick);
  };

  const onWheel = (e: WheelEvent) => {
    if (held || e.ctrlKey || e.shiftKey || e.buttons !== 0 || reducedMotion.matches) return;
    const dy = wheelDeltaPx(e.deltaY, e.deltaMode, scroller.clientHeight);
    if (dy === 0 || Math.abs(wheelDeltaPx(e.deltaX, e.deltaMode, scroller.clientWidth)) > Math.abs(dy)) return;
    const down = dy > 0;
    const top = scroller.scrollTop;
    let atEdge = !down && top <= 0.5;
    if (down) {
      const max = scroller.scrollHeight - scroller.clientHeight;
      atEdge = max > 1 && top >= max - 1;
    } else if (atEdge && scroller.scrollHeight - scroller.clientHeight <= 1) {
      atEdge = false;
    }
    if (!atEdge) {
      // Scrolling back away from the edge: let go so the spring returns.
      if (pulling && Math.sign(pull) === (down ? 1 : -1)) pulling = false;
      return;
    }
    if (claimedBelow(e.target, scroller, down)) return;
    if (!frame) {
      targets = bounceTargets(scroller);
      if (targets.length === 0) return;
      offset = velocity = 0;
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    }
    // Content follows the pull: down past the top moves it down (+).
    const sign = down ? -1 : 1;
    if (!pulling || Math.sign(pull) !== sign) {
      pull = Math.sign(offset) === sign ? rubberBandInverse(offset) : 0;
      pulling = true;
    }
    pull += sign * Math.abs(dy) * ELASTIC.inputScale;
    lastInput = performance.now();
  };

  // A press during a bounce freezes the content until release. Moving it
  // mid-press would put a different element under the release, and Chromium
  // would then fire the click on their common ancestor instead of the card.
  const onPointerDown = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    held = true;
    pulling = false;
    velocity = 0;
  };

  const onPointerUp = () => {
    if (!held) return;
    held = false;
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  };

  scroller.addEventListener('wheel', onWheel, { passive: true });
  scroller.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true, capture: true });
  return () => {
    scroller.removeEventListener('wheel', onWheel);
    scroller.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('pointerup', onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', onPointerUp, { capture: true });
    stop();
    delete scroller.dataset.elastic;
  };
}
