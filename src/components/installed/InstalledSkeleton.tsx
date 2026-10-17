import type { CSSProperties } from 'react';
import type { ViewMode } from '../common/PageComponents';
import { Skeleton, SkeletonModCard } from '../common/Skeleton';

/**
 * First-load placeholder for Installed. Same scroller padding, toolbar band,
 * section header and card grid as the loaded page, so the real cards land on
 * top of their placeholders instead of shoving the layout around.
 */
export function InstalledSkeleton({ viewMode, gridStyle }: { viewMode: ViewMode; gridStyle: CSSProperties }) {
  const isList = viewMode === 'list';
  const count = viewMode === 'compact' ? 12 : isList ? 9 : 8;
  const layout = isList ? 'installed-list' : viewMode === 'compact' ? 'installed-compact' : 'installed';
  return (
    <div className="h-full overflow-hidden px-4 pb-5 sm:px-6" aria-busy="true" aria-live="polite">
      <div className="-mx-4 mb-4 border-b border-hl/5 px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2 lg:gap-3">
          <Skeleton className="h-[38px] min-w-[11rem] flex-1" rounded="lg" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
      <div className="mb-3 flex h-7 items-center justify-between gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-28" />
      </div>
      <div
        className={isList ? 'space-y-1.5' : viewMode === 'compact' ? 'grid gap-3' : 'grid gap-4'}
        style={isList ? undefined : gridStyle}
      >
        {Array.from({ length: count }, (_, i) => (
          <SkeletonModCard key={i} layout={layout} index={i} />
        ))}
      </div>
    </div>
  );
}
