import type { CSSProperties } from 'react';

/** Wrapper treatment shared by every Installed grid item, sortable or not. */
export function entryCardShell(isList: boolean): { className: string; style: CSSProperties } {
  return {
    // content-visibility:auto skips layout + paint for offscreen cards (most of
    // the cost of mounting a large library) but implies contain:paint, which
    // clips whatever the card paints outside its box AND traps it in its own
    // stacking context. On grid/compact the enabled-card :hover lifts + scales
    // the card: that expansion would be cropped and stuck behind neighbors. So
    // on hover we lift containment (-> visible) and raise z so the expanded card
    // renders whole and on top. The has-menu-open lift does the same for an open
    // action menu that would otherwise paint behind the next card.
    // overflow-anchor:none opts every card out of the browser's scroll
    // anchoring. Without it, pinning a card near the bottom of a long library
    // dragged the viewport along with it: Chrome had picked that card as the
    // scroll anchor, so when the star moved it to the top of the disabled
    // section the scroller "helpfully" followed it thousands of pixels up.
    // Excluding cards leaves the grid container as the anchor, which never
    // moves on a reorder, so the view stays put through pin / unpin / delete.
    className: `flex flex-col has-[[data-card-menu-open]]:z-20 [overflow-anchor:none] [content-visibility:auto] ${isList ? '' : 'hover:[content-visibility:visible] hover:z-10'}`,
    style: {
      position: 'relative',
      // Sizing estimate for the content-visibility skip. The property itself
      // lives in className (not here) so a :hover variant can lift it, see
      // above. The `auto` keyword keeps the real size once a card has been
      // rendered; the estimate only stands in before first view. dnd-kit drag
      // measurement is unaffected: offscreen items still have placeholder boxes.
      containIntrinsicSize: isList ? 'auto 72px' : 'auto 280px',
    },
  };
}
