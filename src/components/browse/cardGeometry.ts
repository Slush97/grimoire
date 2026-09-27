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

function estimateReadableCardBodyHeight(density: BrowseReadableDensity, section: string): number {
  const isSound = section === 'Sound';

  // The category/hero/NSFW chips now float over the thumbnail (revealed on
  // hover), so the body no longer reserves a chip row or its margin.
  if (density === 'micro') {
    return 8 + 16 + (isSound ? 8 + 28 : 0) + 8 + 24 + 8;
  }

  if (density === 'compact') {
    return 12 + 29 + (isSound ? 10 + 22 : 0) + 10 + 24 + 2;
  }

  return 14 + 32 + (isSound ? 10 + 38 : 0) + 10 + 28 + 6;
}

export function estimateBrowseRowHeight(
  columnWidth: number,
  layout: BrowseLayout,
  cardDesign: BrowseCardDesign,
  section: string
): number {
  if (layout === 'list') return 112;
  if (cardDesign === 'classic') {
    return Math.ceil(columnWidth * (2 / 3));
  }

  const density = getReadableDensity(columnWidth);
  const mediaHeight =
    density === 'micro'
      ? columnWidth * 0.5625
      : density === 'compact'
        ? columnWidth * 0.56
        : columnWidth * 0.571429;
  const bodyHeight = estimateReadableCardBodyHeight(density, section);

  return Math.ceil(mediaHeight + bodyHeight);
}
