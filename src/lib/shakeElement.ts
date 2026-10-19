/** Brief feedback for a blocked action, without changing layout or drag transforms. */
export function shakeElement(element: Element | null): void {
  if (!element?.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  for (const animation of element.getAnimations()) {
    if (animation.id === 'blocked-action-shake') animation.cancel();
  }
  element.animate(
    { translate: ['0 0', '-4px 0', '4px 0', '-3px 0', '3px 0', '0 0'] },
    { id: 'blocked-action-shake', duration: 280, easing: 'ease-in-out' },
  );
}
