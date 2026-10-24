import type { CSSProperties } from 'react';

/** Wrapper treatment shared by every Installed grid item, sortable or not. */
export function entryCardShell(isList: boolean): { className: string; style: CSSProperties } {
  return {
    // content-visibility:auto skips layout + paint for offscreen cards (most of
    // the cost of mounting a large library) but implies contain:paint, which
    // clips whatever the card paints outside its box AND traps it in its own
    // stacking context. On grid/compact, hover lifts the card: that expansion
    // would be cropped and stuck behind neighbors. CSS
    // lifts containment and z on hover while idle, or while focused/showing a
    // menu. Scrolling keeps containment because decorative hover is suppressed.
    // overflow-anchor:none opts every card out of the browser's scroll
    // anchoring. Without it, pinning a card near the bottom of a long library
    // dragged the viewport along with it: Chrome had picked that card as the
    // scroll anchor, so when the star moved it to the top of the disabled
    // section the scroller "helpfully" followed it thousands of pixels up.
    // Excluding cards leaves the grid container as the anchor, which never
    // moves on a reorder, so the view stays put through pin / unpin / delete.
    className: `installed-entry-shell flex flex-col [overflow-anchor:none] ${isList ? '' : 'installed-entry-shell-grid'}`,
    style: {
      position: 'relative',
      // Sizing estimate for the content-visibility skip. The property itself
      // lives in CSS (not here) so an idle :hover can lift it, see
      // above. The `auto` keyword keeps the real size once a card has been
      // rendered; the estimate only stands in before first view. dnd-kit drag
      // measurement is unaffected: offscreen items still have placeholder boxes.
      containIntrinsicSize: isList ? 'auto 72px' : 'auto 280px',
    },
  };
}
