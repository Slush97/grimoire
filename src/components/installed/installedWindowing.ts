export type InstalledWindowView = 'grid' | 'compact' | 'list';

/** Chromium resolves auto-fill to pixel tracks in computed grid styles. */
export function installedColumnCount(template: string, viewMode: InstalledWindowView): number {
  if (viewMode === 'list') return 1;
  const tracks = template.trim().split(/\s+/).filter((track) => /^\d+(?:\.\d+)?px$/.test(track));
  return Math.max(1, tracks.length);
}

export function installedRowEstimate(width: number, viewMode: InstalledWindowView): number {
  if (viewMode === 'list') return 58;
  if (viewMode === 'compact') return 194;
  // Grid media fills the padded card's 16:9 frame. The remaining title,
  // footer, spacing and borders have a fixed combined height.
  return Math.max(75, Math.max(0, width - 18) * 9 / 16 + 75);
}

/** Read layout coordinates so CSS transforms do not change the offset. */
function layoutTop(element: HTMLElement): number {
  let top = element.offsetTop;
  let parent = element.offsetParent;
  while (parent instanceof HTMLElement) {
    top += parent.offsetTop + parent.clientTop;
    parent = parent.offsetParent;
  }
  return top;
}

export function installedGridOffset(grid: HTMLElement, scroller: HTMLElement): number {
  return layoutTop(grid) - layoutTop(scroller) - scroller.clientTop;
}

export function installedPinnedRows(
  keys: Iterable<string>,
  indexByKey: ReadonlyMap<string, number>,
  columnCount: number,
): number[] {
  const rows = new Set<number>();
  for (const key of keys) {
    const index = indexByKey.get(key);
    if (index !== undefined) rows.add(Math.floor(index / columnCount));
  }
  return [...rows].sort((a, b) => a - b);
}
