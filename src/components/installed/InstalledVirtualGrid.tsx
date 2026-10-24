import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { ModEntry } from '../../lib/modEntries';
import { installedColumnCount, installedGridOffset, installedPinnedRows, installedRowEstimate, type InstalledWindowView } from './installedWindowing';

type InstalledVirtualGridProps = {
  entries: readonly ModEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  gridClassName: string;
  gridStyle?: CSSProperties;
  viewMode: InstalledWindowView;
  renderEntry: (entry: ModEntry, renderContent: boolean) => ReactNode;
  getEntryKey?: (entry: ModEntry) => string;
  revealEntryKey?: string | null;
  draggingKey?: string | null;
  dragging?: boolean;
};

const entryKey = (entry: ModEntry) => entry.key;
const FOCUSABLE = 'button, a[href], input, select, textarea, audio[controls], [tabindex]';

function focusableElements(cell: HTMLElement): HTMLElement[] {
  return [...cell.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    (element.checkVisibility?.() ?? true),
  );
}

/** Range changes stay inside this boundary instead of rendering the entire page. */
export const InstalledVirtualGrid = memo(function InstalledVirtualGrid({
  entries, scrollRef, gridClassName, gridStyle, viewMode, renderEntry,
  getEntryKey = entryKey, revealEntryKey = null, draggingKey = null, dragging = false,
}: InstalledVirtualGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ columns: 1, width: 0, columnGap: 0, rowGap: 0, margin: 0, ready: false, viewMode });
  const geometryRef = useRef(geometry);
  const resizeAnchor = useRef<{ key: string; delta: number } | null>(null);
  const [interactiveKeys, setInteractiveKeys] = useState<ReadonlySet<string>>(new Set());
  const [pendingFocus, setPendingFocus] = useState<{ key: string; backwards: boolean } | null>(null);
  const keys = useMemo(() => entries.map(getEntryKey), [entries, getEntryKey]);
  const indexByKey = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys]);
  const hasInteractivePins = interactiveKeys.size > 0 || pendingFocus !== null;
  const columnCount = geometry.columns;
  const rowCount = Math.ceil(entries.length / columnCount);
  const pinnedRows = useMemo(() => {
    const pinned = new Set(interactiveKeys);
    if (pendingFocus) pinned.add(pendingFocus.key);
    for (const target of [revealEntryKey, draggingKey]) {
      if (!target) continue;
      const index = indexByKey.get(target) ?? entries.findIndex((entry) => entry.key === target);
      if (index >= 0 && index !== undefined) pinned.add(keys[index]);
    }
    return installedPinnedRows(pinned, indexByKey, columnCount);
  }, [interactiveKeys, pendingFocus, revealEntryKey, draggingKey, indexByKey, entries, keys, columnCount]);
  const extractRange = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) =>
    [...new Set([...defaultRangeExtractor(range), ...pinnedRows])].sort((a, b) => a - b), [pinnedRows]);
  const getRowKey = useCallback((index: number) => keys[index * columnCount] ?? index, [keys, columnCount]);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => installedRowEstimate(geometry.width, viewMode),
    overscan: 3,
    gap: geometry.rowGap,
    scrollMargin: geometry.margin,
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor: extractRange,
    getItemKey: getRowKey,
  });

  useLayoutEffect(() => { geometryRef.current = geometry; }, [geometry]);
  useEffect(() => {
    setInteractiveKeys((previous) => {
      const retained = new Set([...previous].filter((key) => indexByKey.has(key)));
      return retained.size === previous.size ? previous : retained;
    });
    setPendingFocus((previous) => previous && !indexByKey.has(previous.key) ? null : previous);
  }, [indexByKey]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    const connect = () => {
      frame = 0;
      const scroller = scrollRef.current;
      // Child layout effects can run before the enclosing scroller's ref is
      // attached. Retry after the commit instead of leaving geometry unbound.
      if (!scroller) { frame = requestAnimationFrame(connect); return; }
      const measure = () => {
        const style = getComputedStyle(grid);
        const previous = geometryRef.current;
        const resolvedColumns = installedColumnCount(style.gridTemplateColumns, viewMode);
        // Regrouping rows recreates their card children. Keep the current row
        // grouping until an inline editor, menu or playing preview releases it.
        const columns = hasInteractivePins && previous.ready && previous.viewMode === viewMode ? previous.columns : resolvedColumns;
        const columnGap = parseFloat(style.columnGap) || (viewMode === 'compact' ? 12 : 16);
        const rowGap = viewMode === 'list' ? 6 : parseFloat(style.rowGap) || columnGap;
        const width = Math.max(0, (grid.clientWidth - columnGap * (columns - 1)) / columns);
        const margin = installedGridOffset(grid, scroller);
        if (previous.ready && (previous.columns !== columns || previous.width !== width) &&
          scroller.scrollTop >= previous.margin && scroller.scrollTop < previous.margin + rowVirtualizer.getTotalSize()) {
          const row = rowVirtualizer.getVirtualItems().find((candidate) => candidate.end > scroller.scrollTop);
          const key = row && keys[row.index * previous.columns];
          if (row && key) resizeAnchor.current = { key, delta: Math.max(0, scroller.scrollTop - row.start) };
        }
        setGeometry((previous) => previous.columns === columns && previous.width === width &&
          previous.columnGap === columnGap && previous.rowGap === rowGap && previous.margin === margin && previous.ready
          && previous.viewMode === viewMode ? previous : { columns, width, columnGap, rowGap, margin, ready: true, viewMode });
      };
      const scheduleMeasure = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
      };
      measure();
      observer = new ResizeObserver(scheduleMeasure);
      observer.observe(grid);
      // Earlier sections can move this grid without changing its dimensions.
      let ancestor: HTMLElement | null = grid;
      while (ancestor && ancestor !== scroller) {
        for (let sibling = ancestor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) observer.observe(sibling);
        ancestor = ancestor.parentElement;
        if (ancestor) observer.observe(ancestor);
      }
    };
    connect();
    return () => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [scrollRef, gridClassName, gridStyle, viewMode, hasInteractivePins, keys, rowVirtualizer]);

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, geometry.width, columnCount, viewMode]);
  useLayoutEffect(() => {
    const anchor = resizeAnchor.current;
    if (!anchor) return;
    resizeAnchor.current = null;
    const index = indexByKey.get(anchor.key);
    if (index === undefined) return;
    rowVirtualizer.getVirtualItems();
    const row = rowVirtualizer.measurementsCache[Math.floor(index / columnCount)];
    if (row) {
      // measure() schedules a React update. Reserve its new height immediately
      // so the browser cannot clamp this scroll against the previous columns.
      if (spacerRef.current) spacerRef.current.style.height = `${rowVirtualizer.getTotalSize()}px`;
      rowVirtualizer.scrollToOffset(row.start + Math.min(anchor.delta, Math.max(0, row.size - 1)));
    }
  }, [rowVirtualizer, geometry.width, columnCount, viewMode, indexByKey]);
  const totalHeight = rowVirtualizer.getTotalSize();
  useLayoutEffect(() => {
    gridRef.current?.dispatchEvent(new Event('installed-virtual-grid-resize', { bubbles: true }));
  }, [totalHeight, geometry.margin, geometry.ready, columnCount]);

  const refreshCell = useCallback((cell: HTMLElement) => {
    const key = cell.dataset.installedWindowKey;
    if (!key || !cell.isConnected) return;
    const pinned = cell.contains(document.activeElement) || cell.matches('[data-state="open"]') ||
      !!cell.querySelector('[data-state="open"]') || [...cell.querySelectorAll('audio')].some((audio) => !audio.paused && !audio.ended);
    setInteractiveKeys((previous) => {
      if (previous.has(key) === pinned) return previous;
      const next = new Set(previous);
      if (pinned) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onInteraction = (event: Event) => {
      const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-installed-window-key]') : null;
      if (!cell) return;
      refreshCell(cell);
      // focusout fires before activeElement has moved to its next owner.
      if (event.type === 'focusout') {
        const timer = setTimeout(() => { timers.delete(timer); refreshCell(cell); }, 0);
        timers.add(timer);
      }
    };
    const eventTypes = ['focusin', 'focusout', 'play', 'pause', 'ended'];
    for (const type of eventTypes) grid.addEventListener(type, onInteraction, true);
    const observer = new MutationObserver((mutations) => {
      const cells = new Set<HTMLElement>();
      for (const mutation of mutations) {
        const cell = mutation.target instanceof Element ? mutation.target.closest<HTMLElement>('[data-installed-window-key]') : null;
        if (cell) cells.add(cell);
      }
      for (const cell of cells) refreshCell(cell);
    });
    observer.observe(grid, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    return () => {
      observer.disconnect();
      for (const type of eventTypes) grid.removeEventListener(type, onInteraction, true);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [refreshCell]);

  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const cell = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-installed-window-key]') ?? [])]
      .find((candidate) => candidate.dataset.installedWindowKey === pendingFocus.key);
    if (!cell) return;
    const controls = focusableElements(cell);
    const target = pendingFocus.backwards ? controls.at(-1) : controls[0];
    target?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
    const cell = event.target.closest<HTMLElement>('[data-installed-window-key]');
    const key = cell?.dataset.installedWindowKey;
    if (!cell || !key) return;
    const controls = focusableElements(cell);
    if (event.target !== (event.shiftKey ? controls[0] : controls.at(-1))) return;
    const index = indexByKey.get(key);
    if (index === undefined) return;
    const nextKey = keys[index + (event.shiftKey ? -1 : 1)];
    if (!nextKey) return;
    const mounted = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-installed-window-key]') ?? [])]
      .some((candidate) => candidate.dataset.installedWindowKey === nextKey && candidate.querySelector(FOCUSABLE));
    if (!mounted) {
      event.preventDefault();
      setPendingFocus({ key: nextKey, backwards: event.shiftKey });
    }
  };

  const virtualRows = rowVirtualizer.getVirtualItems();
  const heavyRows = new Set(virtualRows.map((row) => row.index));
  const rows = dragging ? rowVirtualizer.measurementsCache : virtualRows;
  return <div
    ref={gridRef}
    className={gridClassName}
    style={gridStyle}
    data-installed-virtual-grid=""
    data-installed-window-grid=""
    data-installed-window-ready={geometry.ready ? 'true' : 'false'}
    onKeyDownCapture={onKeyDown}
  >
    <div ref={spacerRef} className="relative w-full" style={{ height: totalHeight, gridColumn: '1 / -1', overflowAnchor: 'none' }}>
      {rows.map((row) => {
        const renderContent = heavyRows.has(row.index);
        const start = row.index * columnCount;
        return <div
          key={row.key}
          ref={renderContent ? rowVirtualizer.measureElement : undefined}
          data-index={row.index}
          data-installed-window-row={row.index}
          className="absolute left-0 top-0 grid w-full"
          style={{
            top: row.start - geometry.margin,
            gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            columnGap: geometry.columnGap,
            height: renderContent ? undefined : row.size,
          }}
        >
          {entries.slice(start, start + columnCount).map((entry, offset) => <div
            key={keys[start + offset]}
            className="flex min-w-0 flex-col"
            data-installed-window-key={keys[start + offset]}
            data-installed-window-entry-key={entry.key}
          >{renderEntry(entry, renderContent)}</div>)}
        </div>;
      })}
    </div>
  </div>;
});
