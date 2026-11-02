/** Thumbnail buttons are drag surfaces; controls and portal menus keep their gestures. */
export function isModCardDragTarget(target: EventTarget | null, card: HTMLElement): boolean {
  if (!(target instanceof Element) || !card.contains(target) || target.closest('[data-mod-drag-ignore]')) return false;
  const control = target.closest('button, input, textarea, select, a, [role="button"], [role="switch"], [role="slider"], [contenteditable]:not([contenteditable="false"])');
  return !control || control === card || control.hasAttribute('data-mod-drag-surface');
}
