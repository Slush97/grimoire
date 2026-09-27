import { getHeroChipIconPath } from '../../lib/lockerUtils';
import type { BrowseReadableChip, BrowseReadableChipTone } from './cardUtils';

export const BROWSE_READABLE_MAX_VISIBLE_CHIPS = 3;
const BROWSE_READABLE_CHIP_GAP_WIDTH = 6;
const BROWSE_READABLE_CHIP_OVERFLOW_WIDTH = 30;
const BROWSE_READABLE_HERO_CHIP_WIDTH = 24;

function readableChipTone(tone: BrowseReadableChipTone = 'neutral', onImage = false): string {
  // On-image chips float over the thumbnail (revealed on hover), so they need an
  // opaque dark backdrop + blur to stay legible over bright art, mirroring the
  // hero-gallery badge treatment.
  if (onImage) {
    switch (tone) {
      case 'accent':
        return 'border-accent/40 bg-black/55 text-accent backdrop-blur-sm';
      case 'danger':
        return 'border-state-danger/45 bg-black/55 text-state-danger backdrop-blur-sm';
      case 'info':
        return 'border-state-info/40 bg-black/55 text-state-info backdrop-blur-sm';
      default:
        return 'border-hl/20 bg-black/55 text-white/90 backdrop-blur-sm';
    }
  }
  switch (tone) {
    case 'accent':
      return 'border-accent/25 bg-accent/[0.08] text-accent';
    case 'danger':
      return 'border-state-danger/30 bg-state-danger/[0.09] text-state-danger';
    case 'info':
      return 'border-state-info/25 bg-state-info/[0.08] text-state-info';
    default:
      return 'border-hl/[0.1] bg-hl/[0.04] text-text-secondary';
  }
}

function estimateReadableChipWidth(label: string): number {
  // ~6px per character at the chip's 11px font, plus horizontal padding.
  return Math.ceil(label.length * 6 + 14);
}

function BrowseReadableChipBadge({ chip, onImage = false }: { chip: BrowseReadableChip; onImage?: boolean }) {
  if (chip.hero) {
    return (
      <img
        src={getHeroChipIconPath(chip.hero)}
        alt={chip.label}
        title={chip.label}
        loading="lazy"
        draggable={false}
        className={`h-6 w-6 shrink-0 rounded-full object-cover ${onImage ? 'ring-1 ring-black/40' : ''}`}
      />
    );
  }
  return (
    <span
      title={chip.label}
      className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-sm border px-2 text-2xs font-medium leading-none ${readableChipTone(
        chip.tone,
        onImage
      )}`}
    >
      {chip.label}
    </span>
  );
}

export function BrowseReadableChipRow({
  chips,
  availableWidth,
  maxVisible = BROWSE_READABLE_MAX_VISIBLE_CHIPS,
  onImage = false,
}: {
  chips: BrowseReadableChip[];
  availableWidth: number;
  maxVisible?: number;
  onImage?: boolean;
}) {
  const visibleChips: BrowseReadableChip[] = [];
  let usedWidth = 0;
  const rowWidth = Math.max(48, availableWidth);
  const orderedChips = [...chips];

  for (const [index, chip] of orderedChips.entries()) {
    if (visibleChips.length >= maxVisible) break;

    const remainingAfter = orderedChips.length - index - 1;
    const chipWidth = chip.hero ? BROWSE_READABLE_HERO_CHIP_WIDTH : estimateReadableChipWidth(chip.label);
    const gapBefore = visibleChips.length > 0 ? BROWSE_READABLE_CHIP_GAP_WIDTH : 0;
    const overflowReserve = remainingAfter > 0 ? BROWSE_READABLE_CHIP_GAP_WIDTH + BROWSE_READABLE_CHIP_OVERFLOW_WIDTH : 0;

    if (usedWidth + gapBefore + chipWidth + overflowReserve > rowWidth) break;

    visibleChips.push(chip);
    usedWidth += gapBefore + chipWidth;
  }

  const hiddenChips = orderedChips.filter(
    (chip) => !visibleChips.some((visible) => visible.label === chip.label && visible.tone === chip.tone)
  );

  return (
    <div className="flex h-6 min-w-0 items-start gap-[clamp(5px,2.1429cqw,7px)] overflow-visible">
      {visibleChips.map((chip, index) => (
        <BrowseReadableChipBadge key={`${chip.label}-${index}`} chip={chip} onImage={onImage} />
      ))}
      {hiddenChips.length > 0 && (
        <div className="group/hidden relative shrink-0">
          <span
            title={`${hiddenChips.length} more`}
            className={`inline-flex h-6 items-center rounded-sm border px-2 text-2xs font-medium leading-none ${
              onImage
                ? 'border-hl/20 bg-black/55 text-white/90 backdrop-blur-sm'
                : 'border-hl/[0.1] bg-hl/[0.04] text-text-secondary'
            }`}
          >
            +{hiddenChips.length}
          </span>
          <div className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-20 hidden min-w-max max-w-[180px] flex-wrap gap-1 rounded-md border border-hl/[0.08] bg-bg-secondary/96 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md group-hover/hidden:flex">
            {hiddenChips.map((chip, index) => (
              <BrowseReadableChipBadge key={`${chip.label}-overflow-${index}`} chip={chip} onImage={onImage} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
