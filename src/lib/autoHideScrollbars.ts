/**
 * macOS-style auto-hiding scrollbars for `.scrollbar-glass` panels: the thumb
 * surfaces only while the panel is actively scrolling, then disappears after a
 * short idle. A single capture-phase listener covers every current and future
 * glass panel without per-component wiring (the standard `scroll` event does
 * not bubble, but a capture-phase listener on the document still catches it).
 *
 * Reveal is gated on scroll activity, not hover, so at rest nothing sits over
 * the hero art.
 */

const IDLE_MS = 700;
const timers = new WeakMap<HTMLElement, number>();

function handleScroll(event: Event): void {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !el.classList.contains('scrollbar-glass')) return;

    el.classList.add('is-scrolling');
    const existing = timers.get(el);
    if (existing !== undefined) window.clearTimeout(existing);
    timers.set(
        el,
        window.setTimeout(() => {
            el.classList.remove('is-scrolling');
            timers.delete(el);
        }, IDLE_MS),
    );
}

let installed = false;

/** Install the global scroll-activity listener. Idempotent. */
export function initAutoHideScrollbars(): void {
    if (installed) return;
    installed = true;
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
}
