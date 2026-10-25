import { useCallback, useEffect, useRef, useState } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import type { BrowseReadableChip, BrowseReadableChipTone } from './cardUtils';

export const BROWSE_READABLE_MAX_VISIBLE_CHIPS = 3;
const BROWSE_READABLE_CHIP_GAP_WIDTH = 6;
const BROWSE_READABLE_CHIP_OVERFLOW_WIDTH = 30;

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
      default:
        return 'border-hl/20 bg-black/55 text-white/90 backdrop-blur-sm';
    }
  }
  switch (tone) {
    case 'accent':
      return 'border-accent/25 bg-accent/[0.08] text-accent';
    case 'danger':
      return 'border-state-danger/30 bg-state-danger/[0.09] text-state-danger';
    default:
      return 'border-hl/[0.1] bg-hl/[0.04] text-text-secondary';
  }
}

function estimateReadableChipWidth(label: string): number {
  // ~6px per character at the chip's 11px font, plus horizontal padding.
  return Math.ceil(label.length * 6 + 14);
}

function BrowseReadableChipBadge({ chip, onImage = false, wrap = false }: { chip: BrowseReadableChip; onImage?: boolean; wrap?: boolean }) {
  return (
    <span
      title={chip.label}
      className={`inline-flex min-h-6 shrink-0 items-center rounded-sm border px-2 text-2xs font-medium leading-none ${wrap ? 'max-w-full whitespace-normal break-words py-1' : 'h-6 whitespace-nowrap'} ${readableChipTone(
        chip.tone,
        onImage
      )}`}
    >
      {chip.label}
    </span>
  );
}

function BrowseReadableChipOverflow({ chips, onImage }: { chips: BrowseReadableChip[]; onImage: boolean }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    if (document.activeElement !== anchorRef.current) closeTimer.current = setTimeout(close, 120);
  };
  useEffect(() => cancelClose, [cancelClose]);
  const labels = chips.map(chip => chip.label).join(', ');

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title={labels}
        aria-label={labels}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={scheduleClose}
        onFocus={show}
        onBlur={scheduleClose}
        onClick={event => { event.stopPropagation(); show(); }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        }}
        className={`inline-flex h-6 shrink-0 items-center rounded-sm border px-2 text-2xs font-medium leading-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
          onImage
            ? 'border-hl/20 bg-black/55 text-white/90 backdrop-blur-sm'
            : 'border-hl/[0.1] bg-hl/[0.04] text-text-secondary'
        }`}
      >
        +{chips.length}
      </button>
      <AnchoredPopover open={open} onClose={close} anchorRef={anchorRef} width={180} align="start" ariaLabel={labels}>
        <div
          className="flex flex-wrap gap-1 p-2"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onClick={event => event.stopPropagation()}
        >
          {chips.map((chip, index) => <BrowseReadableChipBadge key={`${chip.label}-${index}`} chip={chip} wrap />)}
        </div>
      </AnchoredPopover>
    </>
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
    const chipWidth = estimateReadableChipWidth(chip.label);
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
        <BrowseReadableChipOverflow chips={hiddenChips} onImage={onImage} />
      )}
    </div>
  );
}
