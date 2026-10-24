import { useLayoutEffect, type RefObject } from 'react';
import { useStableCallback } from '../../lib/useStableCallback';

/** Align after the virtual grid has mounted and measured a requested card. */
export function useInstalledEntryReveal(
  scrollRef: RefObject<HTMLElement | null>,
  entryKey: string | null,
  onReveal: (card: HTMLElement) => void,
): void {
  const reveal = useStableCallback(onReveal);
  useLayoutEffect(() => {
    if (!entryKey) return;
    let frame = 0;
    let attempts = 0;
    const align = () => {
      const card = scrollRef.current?.querySelector<HTMLElement>(
        `[data-installed-entry-key="${CSS.escape(entryKey)}"]`,
      );
      const ready = card?.closest('[data-installed-window-grid]')
        ?.getAttribute('data-installed-window-ready') === 'true';
      if (!card || !ready) {
        if (++attempts < 60) frame = requestAnimationFrame(align);
        return;
      }
      card.dispatchEvent(new Event('installed-entry-reveal', { bubbles: true }));
      card.scrollIntoView({ block: 'center' });
      frame = requestAnimationFrame(() => {
        if (!card.isConnected) {
          align();
          return;
        }
        card.scrollIntoView({ block: 'center' });
        reveal(card);
      });
    };
    frame = requestAnimationFrame(align);
    return () => cancelAnimationFrame(frame);
  }, [entryKey, scrollRef, reveal]);
}
