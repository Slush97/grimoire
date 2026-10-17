import { type CSSProperties } from 'react';

// Loading placeholders. Every skeleton shares one shimmer sweep anchored to
// the viewport (see `.skeleton` in index.css), so a screen of placeholders
// reads as a single wave instead of dozens of out-of-phase pulses. Surfaces
// come from the bg/hl tokens, so any accent and OLED mode just work.

type Rounded = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

const roundedClass: Record<Rounded, string> = {
  none: '',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  rounded?: Rounded;
}

/** A block placeholder. Size it with className or style. */
export function Skeleton({ className = '', style, rounded = 'sm' }: SkeletonProps) {
  return <div aria-hidden className={`skeleton ${roundedClass[rounded]} ${className}`} style={style} />;
}

const TEXT_WIDTHS = ['92%', '84%', '96%', '78%', '88%'];

/** Lines of text. The last line runs short, like a real paragraph. */
export function SkeletonText({
  lines = 3,
  lastWidth = '58%',
  className = '',
  lineClassName = 'h-3',
}: {
  lines?: number;
  lastWidth?: string;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div aria-hidden className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={`skeleton rounded-sm ${lineClassName}`}
          style={{ width: i === lines - 1 && lines > 1 ? lastWidth : TEXT_WIDTHS[i % TEXT_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}

/** Avatar or icon placeholder. */
export function SkeletonCircle({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <div aria-hidden className={`skeleton rounded-full flex-shrink-0 ${className}`} style={{ width: size, height: size }} />;
}

export type SkeletonCardLayout =
  | 'browse'
  | 'browse-classic'
  | 'browse-list'
  | 'installed'
  | 'installed-compact'
  | 'installed-list';

// Title and author bars vary a little per card so a grid of placeholders does
// not look stamped out.
const TITLE_WIDTHS = ['72%', '58%', '80%', '64%', '76%', '52%'];
const SUB_WIDTHS = ['38%', '46%', '30%', '42%', '34%', '50%'];

/**
 * A placeholder with the geometry of a real mod card, so nothing moves when
 * the card lands. `index` varies the text bar widths; `height` pins the frame
 * when the real grid sizes its rows explicitly (the virtualized Browse grid).
 */
export function SkeletonModCard({
  layout,
  index = 0,
  height,
  className = '',
}: {
  layout: SkeletonCardLayout;
  index?: number;
  height?: number;
  className?: string;
}) {
  const title = TITLE_WIDTHS[index % TITLE_WIDTHS.length];
  const sub = SUB_WIDTHS[index % SUB_WIDTHS.length];
  const frameStyle = height ? { height } : undefined;

  if (layout === 'browse') {
    // ReadableBrowseModCard: media 57% of the width, then title, author and a
    // stats row with the action button, all in container-query units.
    return (
      <div
        aria-hidden
        style={frameStyle}
        className={`flex w-full flex-col overflow-hidden rounded-xl border border-hl/[0.07] bg-bg-sunken [container-type:inline-size] ${className}`}
      >
        <div className="skeleton h-[57.1429cqw] flex-none rounded-t-xl" />
        <div className="flex flex-1 flex-col p-[clamp(14px,5cqw,16px)]">
          <div className="skeleton h-[clamp(10px,4.4cqw,14px)] rounded-sm" style={{ width: title }} />
          <div className="skeleton mt-[clamp(6px,2.6cqw,8px)] h-[clamp(8px,3.4cqw,10px)] rounded-sm" style={{ width: sub }} />
          <div className="mt-auto flex h-[clamp(24px,10cqw,32px)] items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="skeleton h-[clamp(8px,3.4cqw,10px)] w-[11cqw] rounded-sm" />
              <div className="skeleton h-[clamp(8px,3.4cqw,10px)] w-[11cqw] rounded-sm" />
            </div>
            <div className="skeleton h-full w-[34cqw] rounded-sm" />
          </div>
        </div>
      </div>
    );
  }

  if (layout === 'browse-classic') {
    return (
      <div aria-hidden style={frameStyle} className={`relative overflow-hidden rounded-xl border border-border bg-bg-tertiary ${height ? '' : 'aspect-[3/2]'} ${className}`}>
        <div className="skeleton absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-3">
          <div className="h-3.5 rounded-sm bg-hl/[0.06]" style={{ width: title }} />
          <div className="h-2.5 rounded-sm bg-hl/[0.05]" style={{ width: sub }} />
        </div>
      </div>
    );
  }

  if (layout === 'browse-list') {
    return (
      <div aria-hidden className={`flex items-center gap-4 rounded-xl border border-border bg-bg-secondary p-3 ${className}`}>
        <div className="skeleton h-20 w-32 flex-shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="skeleton h-3.5 rounded-sm" style={{ width: title }} />
          <div className="skeleton h-2.5 rounded-sm" style={{ width: sub }} />
          <div className="skeleton h-2.5 w-20 rounded-sm" />
        </div>
      </div>
    );
  }

  if (layout === 'installed-list') {
    // ModListRowContent: priority chip, 56px thumbnail, title + meta, toggle.
    return (
      <div aria-hidden className={`grid min-h-[58px] grid-cols-[32px_56px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-hl/[0.06] bg-bg-secondary/60 px-3 ${className}`}>
        <div className="skeleton h-5 w-7 rounded-sm" />
        <div className="skeleton h-10 w-14 rounded-lg" />
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-3 rounded-sm" style={{ width: title }} />
          <div className="skeleton h-2.5 rounded-sm" style={{ width: sub }} />
        </div>
        <div className="skeleton h-6 w-11 rounded-full" />
      </div>
    );
  }

  // Installed grid and compact cards: media, a title line, a chip + toggle row.
  const compact = layout === 'installed-compact';
  return (
    <div aria-hidden className={`flex h-full flex-col rounded-xl border border-hl/[0.06] bg-bg-secondary/60 p-2 ${className}`}>
      <div className={`skeleton w-full rounded-lg ${compact ? 'mb-2 h-[116px]' : 'mb-1.5 aspect-video'}`} />
      <div className="mt-auto px-0.5">
        <div className="flex h-[18px] items-center">
          <div className="skeleton h-3 rounded-sm" style={{ width: title }} />
        </div>
        <div className={`${compact ? 'mt-1.5' : 'mt-1'} flex h-7 items-center justify-between gap-3`}>
          <div className="skeleton h-5 w-16 rounded-sm" />
          <div className={`flex items-center gap-2 ${compact ? '' : 'pr-1'}`}>
            <div className="skeleton h-6 w-11 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
