import type { BrowseLayout } from '../../stores/appStore';

export type ViewMode = 'grid' | 'list';
export type BrowseCardDesign = 'classic' | 'readable';

export const BROWSE_READABLE_CARD_GOLDEN = 280;

export type BrowseReadableDensity = 'micro' | 'compact' | 'full';

export function getReadableCardTargetWidth(cardSize: number): number {
  return Math.max(1, Math.round(cardSize));
}

export function getReadableCardGridGap(targetWidth: number): number {
  if (targetWidth <= 180) return 8;
  if (targetWidth >= BROWSE_READABLE_CARD_GOLDEN) return 16;

  const progress = (targetWidth - 180) / (BROWSE_READABLE_CARD_GOLDEN - 180);
  return Math.round(8 + 8 * progress);
}

export function getReadableDensity(targetWidth: number): BrowseReadableDensity {
  if (targetWidth < 180) return 'micro';
  if (targetWidth < 240) return 'compact';
  return 'full';
}

// Every result reserves the same title and footer rows. Sound playback lives
// inside the artwork, so it does not change the grid geometry.
function estimateReadableCardBodyHeight(density: BrowseReadableDensity): number {
  return density === 'micro' ? 16 + 32 + 8 + 24 : 24 + 40 + 4 + 16 + 8 + 28;
}

export function estimateBrowseRowHeight(
  columnWidth: number,
  layout: BrowseLayout,
  cardDesign: BrowseCardDesign
): number {
  if (layout === 'list') return 112;
  if (cardDesign === 'classic') {
    return Math.ceil(columnWidth * (2 / 3));
  }

  const density = getReadableDensity(columnWidth);
  const mediaHeight = Math.max(0, columnWidth - 2) * (9 / 16);
  return Math.ceil(mediaHeight + estimateReadableCardBodyHeight(density) + 2);
}
