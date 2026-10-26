import type { CSSProperties } from 'react';

/** Wrapper treatment shared by every Installed grid item, sortable or not. */
export function entryCardShell(isList: boolean): { className: string; style: CSSProperties } {
  return {
    // Windowing bounds the mounted cards. Keep their natural layout available
    // even in overscan: content-visibility placeholders would be measured as
    // row heights and leave temporary gaps when those cards enter the viewport.
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
    },
  };
}
