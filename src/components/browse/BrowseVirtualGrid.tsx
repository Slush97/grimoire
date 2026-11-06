import { memo, useEffect, useLayoutEffect, useRef, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { browseModKey, browseModSection } from '../../lib/browseSections';
import type { GameBananaMod } from '../../types/gamebanana';
import type { BrowseLayout } from '../../stores/appStore';
import type { BrowseCardDesign, ViewMode } from './cardGeometry';
import { MemoizedModCard } from './BrowseModCard';

const BROWSE_GRID_OVERSCAN_ROWS = 4;

/** One pending page at a time, with a screen of lead time and a quiet fallback
 * at the actual bottom if scrolling overtakes the next response. */
export function BrowseLoadMore({ scrollRef, hasMore, loading, paused, needsMore, queryKey, onLoadMore, children }: {
  scrollRef: RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  loading: boolean;
  paused: boolean;
  needsMore: boolean;
  queryKey: string;
  onLoadMore: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const markerRef = useRef<HTMLDivElement>(null);
  const requested = useRef(false);
  useEffect(() => {
    requested.current = false;
    if (!hasMore || loading || paused) return;
    let active = true;
    const load = () => {
      if (!active || requested.current) return;
      requested.current = true;
      onLoadMore();
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load();
    }, { root: scrollRef.current, threshold: 0, rootMargin: '0px 0px 900px 0px' });
    if (markerRef.current) observer.observe(markerRef.current);
    // A filtered response or buffered partial row may need another page even
    // when the toolbar pushes the marker below the initial viewport.
    if (needsMore) queueMicrotask(load);
    return () => { active = false; observer.disconnect(); };
  }, [hasMore, loading, paused, needsMore, queryKey, onLoadMore, scrollRef]);
  return <div ref={markerRef} className="flex items-center justify-center p-4">
    {loading && <span role="status" className="text-xs text-text-secondary">{t('browse.loadMore.loadingMore')}</span>}
    {children}
  </div>;
}

type BrowseVirtualGridProps = {
  mods: GameBananaMod[];
  scrollRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  initialScrollOffset: number;
  columnCount: number;
  columnWidth: number;
  cardHeight: number;
  gridGap: number;
  layout: BrowseLayout;
  viewMode: ViewMode;
  cardDesign: BrowseCardDesign;
  cardSize: number;
  installedIds: Set<string>;
  installedByGbId: Map<string, { id: string; enabled: boolean }>;
  queuedByModId: Map<number, { position: number }>;
  downloadingModId?: number;
  volume: number;
  onVolumeChange: (volume: number) => void;
  hideNsfwPreviews: boolean;
  playingModId: string | null;
  onPlayingModIdChange: Dispatch<SetStateAction<string | null>>;
  suppressHoverIntentRef: RefObject<boolean>;
  actionContextKey: string;
  onModClick: (mod: GameBananaMod) => void;
  onQuickDownload: (mod: GameBananaMod, anchor?: HTMLElement) => void;
  onEnable: (id: string) => void;
};

// Keep range updates inside the grid. Scrolling must not re-render Browse's
// filters, menus or details wiring, and typing must not reconcile the rows
// until the debounced results actually change.
export const BrowseVirtualGrid = memo(function BrowseVirtualGrid({
  mods,
  scrollRef,
  gridRef,
  initialScrollOffset,
  columnCount,
  columnWidth,
  cardHeight,
  gridGap,
  layout,
  viewMode,
  cardDesign,
  cardSize,
  installedIds,
  installedByGbId,
  queuedByModId,
  downloadingModId,
  volume,
  onVolumeChange,
  hideNsfwPreviews,
  playingModId,
  onPlayingModIdChange,
  suppressHoverIntentRef,
  actionContextKey,
  onModClick,
  onQuickDownload,
  onEnable,
}: BrowseVirtualGridProps) {
  const rowHeight = cardHeight + gridGap;
  const virtualRowCount = Math.ceil(mods.length / columnCount);
  const rowVirtualizer = useVirtualizer({
    count: virtualRowCount,
    getScrollElement: () => scrollRef.current,
    initialOffset: initialScrollOffset,
    estimateSize: () => rowHeight,
    overscan: BROWSE_GRID_OVERSCAN_ROWS,
  });

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, rowHeight, columnCount, gridGap, cardDesign]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  return (
    <div
      ref={gridRef}
      className="relative w-full"
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
    >
      {virtualRows.map((virtualRow) => {
        const rowStart = virtualRow.index * columnCount;
        const rowMods = mods.slice(rowStart, rowStart + columnCount);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            className={layout === 'list' ? 'absolute left-0 top-0 w-full' : 'absolute left-0 top-0 grid w-full'}
            style={{
              transform: `translateY(${virtualRow.start}px)`,
              height: `${cardHeight}px`,
              gridTemplateColumns:
                layout === 'list'
                  ? undefined
                  : `repeat(${columnCount}, minmax(0, 1fr))`,
              gap: layout === 'list' ? undefined : `${gridGap}px`,
            }}
          >
            {rowMods.map((mod) => {
              const queuedState = queuedByModId.get(mod.id);
              const itemKey = browseModKey(mod);
              const installedLocal = installedByGbId.get(itemKey);
              return (
                <div
                  key={itemKey}
                  className="min-w-0 [contain:layout_style]"
                >
                  <MemoizedModCard
                    key={itemKey}
                    mod={mod}
                    installed={installedIds.has(itemKey)}
                    installedDisabled={!!installedLocal && !installedLocal.enabled}
                    downloading={downloadingModId === mod.id}
                    queuePosition={queuedState?.position}
                    viewMode={viewMode}
                    cardDesign={cardDesign}
                    cardSize={cardSize}
                    cardWidth={columnWidth}
                    cardHeight={cardHeight}
                    section={browseModSection(mod)}
                    volume={volume}
                    onVolumeChange={onVolumeChange}
                    hideNsfwPreviews={hideNsfwPreviews}
                    isPlaying={playingModId === itemKey}
                    suppressHoverIntentRef={suppressHoverIntentRef}
                    enableModId={installedLocal && !installedLocal.enabled ? installedLocal.id : undefined}
                    actionContextKey={actionContextKey}
                    onPlayingChange={(playing) => {
                      onPlayingModIdChange((prev) => {
                        if (playing) return itemKey;
                        return prev === itemKey ? null : prev;
                      });
                    }}
                    onClick={() => onModClick(mod)}
                    onQuickDownload={(anchor) => onQuickDownload(mod, anchor)}
                    onEnable={installedLocal && !installedLocal.enabled
                      ? () => onEnable(installedLocal.id)
                      : undefined}
                    priority={virtualRow.index === 0}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
});
