import type { CSSProperties } from 'react';
import type { ViewMode } from '../common/PageComponents';

export function InstalledSkeleton({ viewMode, gridStyle }: { viewMode: ViewMode; gridStyle: CSSProperties }) {
  const isGridLike = viewMode !== 'list';
  const rows = viewMode === 'compact' ? 12 : viewMode === 'grid' ? 8 : 6;
  return (
    <div className="p-6 animate-fade-in" aria-busy="true" aria-live="polite">
      <div className="flex items-end justify-between gap-4 pb-4 border-b border-border mb-4">
        <div className="space-y-2">
          <div className="skeleton-shimmer bg-bg-tertiary rounded-md h-9 w-52" />
          <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-36" />
        </div>
        <div className="skeleton-shimmer bg-bg-tertiary rounded-lg h-9 w-56" />
      </div>
      <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-20 mb-3" />
      <div
        className={
          viewMode === 'list' ? 'space-y-2' : viewMode === 'compact' ? 'grid gap-3' : 'grid gap-4'
        }
        style={
          isGridLike
            ? gridStyle
            : undefined
        }
      >
        {Array.from({ length: rows }).map((_, i) =>
          isGridLike ? (
            <div key={i} className="rounded-lg border border-border bg-bg-secondary p-3 flex flex-col gap-3">
              <div className="skeleton-shimmer w-full aspect-video bg-bg-tertiary rounded-md" />
              <div className="flex items-center gap-3">
                <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-5 h-5" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-shimmer bg-bg-tertiary rounded h-3.5 w-3/4" />
                  <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-1/2" />
                </div>
                <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-11 h-6" />
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-border bg-bg-secondary p-4 flex items-center gap-4">
              <div className="skeleton-shimmer bg-bg-tertiary rounded w-5 h-5" />
              <div className="skeleton-shimmer bg-bg-tertiary rounded-md w-20 h-12 flex-shrink-0" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <div className="skeleton-shimmer bg-bg-tertiary rounded h-3.5 w-1/2" />
                <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-1/3" />
              </div>
              <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-11 h-6" />
              <div className="skeleton-shimmer bg-bg-tertiary rounded-md w-8 h-8" />
            </div>
          )
        )}
      </div>
    </div>
  );
}
