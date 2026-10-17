import { memo, useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { GameBananaMod } from '../../types/gamebanana';
import type { BrowseLayout } from '../../stores/appStore';
import type { BrowseCardDesign, ViewMode } from './cardGeometry';
import { MemoizedModCard } from './BrowseModCard';

const BROWSE_GRID_OVERSCAN_ROWS = 4;

type BrowseVirtualGridProps = {
  mods: GameBananaMod[];
  scrollRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  columnCount: number;
  columnWidth: number;
  cardHeight: number;
  gridGap: number;
  layout: BrowseLayout;
  viewMode: ViewMode;
  cardDesign: BrowseCardDesign;
  cardSize: number;
  section: string;
  installedIds: Set<number>;
  installedByGbId: Map<number, { id: string; enabled: boolean }>;
  queuedByModId: Map<number, { position: number }>;
  downloadingModId?: number;
  volume: number;
  onVolumeChange: (volume: number) => void;
  hideNsfwPreviews: boolean;
  playingModId: number | null;
  onPlayingModIdChange: Dispatch<SetStateAction<number | null>>;
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
  columnCount,
  columnWidth,
  cardHeight,
  gridGap,
  layout,
  viewMode,
  cardDesign,
  cardSize,
  section,
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
            {rowMods.map((mod, index) => {
              const queuedState = queuedByModId.get(mod.id);
              const installedLocal = installedByGbId.get(mod.id);
              return (
                <div
                  key={mod.id}
                  className="browse-result-card min-w-0 [contain:layout_style]"
                  style={{ animationDelay: `${Math.min(index * 18, 72)}ms` }}
                >
                  <MemoizedModCard
                    key={mod.id}
                    mod={mod}
                    installed={installedIds.has(mod.id)}
                    installedDisabled={!!installedLocal && !installedLocal.enabled}
                    downloading={downloadingModId === mod.id}
                    queuePosition={queuedState?.position}
                    viewMode={viewMode}
                    cardDesign={cardDesign}
                    cardSize={cardSize}
                    cardWidth={columnWidth}
                    cardHeight={cardHeight}
                    section={section}
                    volume={volume}
                    onVolumeChange={onVolumeChange}
                    hideNsfwPreviews={hideNsfwPreviews}
                    isPlaying={playingModId === mod.id}
                    suppressHoverIntentRef={suppressHoverIntentRef}
                    enableModId={installedLocal && !installedLocal.enabled ? installedLocal.id : undefined}
                    actionContextKey={actionContextKey}
                    onPlayingChange={(playing) => {
                      onPlayingModIdChange((prev) => {
                        if (playing) return mod.id;
                        return prev === mod.id ? null : prev;
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
