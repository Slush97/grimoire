import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { ChevronRight, GripVertical, List, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, IconButton } from '../common/ui';
import { EmptyState } from '../common/PageComponents';
import { ModListGlyph } from './ModListIcon';
import { installedListEntryKey, UNLISTED_GROUP_ID, type InstalledListGroup } from '../../lib/installedListGroups';
import { entryDisabledPreferenceKey, entryName, type ModEntry } from '../../lib/modEntries';
import { buildListDragItems, canDropListItem, listDropId, listDropSlotIndex, listHeaderDragId, listPointerIndex, listSlotId, type ListDropPosition, type ModListDrag } from '../../lib/modListDrag';
import { InstalledListAddCard, InstalledListDropSlot, InstalledListEntryDrag, type ListArrivalPoint } from './InstalledListEntryDrag';
import { InstalledListDragBoxContext, type ListDragBox } from './listDragBox';

interface GridProps {
  gridClassName: string;
  gridStyle?: CSSProperties;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
  rows: boolean;
}
interface ListGroupsProps extends GridProps {
  groups: readonly InstalledListGroup[];
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  mountLimit: number;
  onToggle: (id: string) => void;
  onManage: (id?: string) => void;
  onMove: (key: string, sourceId: string, targetId: string, beforeKey: string | null) => void;
  onReorder: (id: string, targetId: string) => void;
  dragDisabled: boolean;
  pauseUpdates: boolean;
}
interface Arrival { key: string; targetId: string; from: ListArrivalPoint | null }

// DOM order follows the slot; sortable supplies the displaced cards' transitions.
const projectedSortingStrategy = () => null;

function pointerPosition(groupId: string, point: { x: number; y: number }, current: ListDropPosition | null): ListDropPosition {
  const append = { groupId, beforeKey: null };
  const grid = document.querySelector<HTMLElement>('[data-mod-list="' + window.CSS.escape(groupId) + '"] [data-list-grid]');
  if (!grid) return append;
  const bounds = grid.getBoundingClientRect();
  const x = point.x - bounds.left;
  const y = point.y - bounds.top;
  if (x < 0 || x > bounds.width || y < 0 || y > bounds.height) return append;
  const slot = grid.querySelector<HTMLElement>('[data-list-drop-slot]');
  if (slot && x >= slot.offsetLeft && x <= slot.offsetLeft + slot.offsetWidth && y >= slot.offsetTop && y <= slot.offsetTop + slot.offsetHeight) {
    return current?.groupId === groupId ? current : append;
  }
  const cards = [...grid.querySelectorAll<HTMLElement>(':scope > [data-list-member-key]')].filter(node => !node.hasAttribute('data-list-drag-source'));
  const index = listPointerIndex(cards.map(node => ({ left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight })), { x, y }, grid.dataset.listRows === 'true');
  return { groupId, beforeKey: cards[index]?.dataset.listMemberKey ?? null };
}

function ListHeaderGrip({ group, disabled, onManage }: {
  group: InstalledListGroup;
  disabled: boolean;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, attributes, listeners } = useDraggable({ id: listHeaderDragId(group.id), disabled });
  return <IconButton ref={setNodeRef} icon={GripVertical} size="sm"
    label={t('installed.lists.reorder', { name: group.name })} disabled={disabled} onClick={onManage}
    className="cursor-grab border-transparent text-text-tertiary opacity-0 group-hover/list-header:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
    {...attributes} {...listeners} />;
}

function ListSection({ group, collapsed, mountLimit, onToggle, onManage, dragDisabled, active, dragBox, placement, arrival, gridClassName, gridStyle, renderEntry, rows }: GridProps & {
  group: InstalledListGroup;
  collapsed: boolean;
  mountLimit: number;
  onToggle: () => void;
  onManage: (id?: string) => void;
  dragDisabled: boolean;
  active: ModListDrag | null;
  dragBox: ListDragBox | null;
  placement: ListDropPosition | null;
  arrival: Arrival | null;
}) {
  const { t } = useTranslation();
  const contentId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || active?.kind !== 'entry') return;
    // Offscreen cards replace estimated heights as they appear. Keep the drop targets still.
    grid.style.minHeight = grid.offsetHeight + 'px';
    return () => { grid.style.removeProperty('min-height'); };
  }, [active]);
  const isList = group.id !== UNLISTED_GROUP_ID;
  const { setNodeRef, isOver } = useDroppable({
    id: listDropId(group.id),
    disabled: dragDisabled || (active?.kind === 'list' && !isList),
  });
  const over = isOver && active && canDropListItem(active, group.id);
  const landed = arrival?.targetId === group.id;
  const incomingKey = landed ? arrival.key : null;
  const arrivalFrom = landed ? arrival.from : null;
  const cards = useMemo(() => group.entries.slice(0, mountLimit).map((entry) => {
    const occurrence = installedListEntryKey(group.id, entry);
    return <InstalledListEntryDrag key={occurrence} id={occurrence} entry={entry} disabled={dragDisabled}
      arriving={incomingKey === entryDisabledPreferenceKey(entry)} arrivalFrom={arrivalFrom}>
      {renderEntry(entry, occurrence)}
    </InstalledListEntryDrag>;
  }), [group.entries, group.id, mountLimit, dragDisabled, incomingKey, arrivalFrom, renderEntry]);
  const source = active?.kind === 'entry' && active.sourceId === group.id ? active : null;
  const sourceKey = source ? installedListEntryKey(group.id, source.entry) : null;
  const sourceIndex = source ? group.entries.findIndex(entry => entry.key === source.entry.key) : -1;
  const originalBefore = sourceIndex < 0 ? null : group.entries[sourceIndex + 1];
  const beforeKey = placement?.groupId === group.id ? placement.beforeKey : originalBefore ? entryDisabledPreferenceKey(originalBefore) : null;
  // Every destination reserves one slot so moving it cannot shift other list headers.
  const slotIndex = active?.kind === 'entry' && (source || !group.entries.some(entry => entryDisabledPreferenceKey(entry) === entryDisabledPreferenceKey(active.entry)))
    ? listDropSlotIndex(group.entries, active.entry, beforeKey) : null;
  const slot = slotIndex === null ? null : <InstalledListDropSlot key={listSlotId(group.id)} groupId={group.id} index={slotIndex}
    height={group.entries.length ? dragBox?.height || 160 : Math.min(dragBox?.height || 160, 72)} over={!!over} />;
  const visibleCards = sourceKey ? cards.filter(card => card.key !== sourceKey) : cards;
  const displayedCards = slot ? [...visibleCards.slice(0, slotIndex ?? 0), slot, ...visibleCards.slice(slotIndex ?? 0)] : visibleCards;
  const sortableItems = useMemo(() => {
    const ids = group.entries.slice(0, mountLimit).map(entry => installedListEntryKey(group.id, entry)).filter(id => id !== sourceKey);
    if (slotIndex !== null) ids.splice(slotIndex, 0, listSlotId(group.id));
    return ids;
  }, [group.entries, group.id, mountLimit, sourceKey, slotIndex]);
  return <section ref={setNodeRef} data-mod-list={group.id} data-drop-active={over || undefined} data-drop-complete={landed || undefined}
    className={'rounded-sm ' + (over ? 'outline outline-2 outline-offset-4 outline-accent' : '')}>
    <div className="group/list-header flex items-center gap-2">
      <h2 className="min-w-0 flex-1">
        <button type="button" aria-expanded={!collapsed} aria-controls={contentId} onClick={onToggle}
          className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          <ChevronRight aria-hidden className={'h-4 w-4 shrink-0 text-text-tertiary ' + (collapsed ? '' : 'rotate-90')} />
          <span data-list-label className="inline-flex min-w-0 items-center gap-2">
            <ModListGlyph icon={group.icon} />
            <span className="min-w-0 truncate font-semibold">{isList ? group.name : t('installed.lists.unlisted')}</span>
            <span className={landed ? 'mod-list-count-pop' : ''} title={t('installed.lists.memberCount', { count: group.entries.length })}>
              <Badge className="tabular-nums">{group.entries.length}</Badge>
            </span>
          </span>
        </button>
      </h2>
      {isList && <>
        <ListHeaderGrip group={group} disabled={dragDisabled} onManage={() => onManage(group.id)} />
        <IconButton icon={Plus} size="sm" label={t('installed.lists.editMembers', { name: group.name })}
          disabled={dragDisabled} onClick={() => onManage(group.id)}
          className="border-transparent opacity-0 group-hover/list-header:opacity-100 focus-visible:opacity-100" />
      </>}
    </div>
    <div id={contentId} hidden={collapsed}>
      {!collapsed && <div className="pb-4">
        {group.entries.length > 0 || slot || isList ? <SortableContext items={sortableItems} strategy={projectedSortingStrategy}>
          <div ref={gridRef} data-list-grid data-list-rows={rows} className={'relative ' + gridClassName} style={gridStyle}>
            {displayedCards}
            {sourceKey && cards.find(card => card.key === sourceKey)}
            {group.entries.length === 0 && !slot && <InstalledListAddCard label={t('installed.lists.addMods')} disabled={dragDisabled} onClick={() => onManage(group.id)} />}
          </div>
        </SortableContext> : <div className="h-8" />}
      </div>}
    </div>
  </section>;
}

function InstalledListGroupsView({ groups, collapsed, showEmpty, mountLimit, onToggle, onManage, onMove, onReorder, dragDisabled, gridClassName, gridStyle, renderEntry, rows }: ListGroupsProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<ModListDrag | null>(null);
  const [dragBox, setDragBox] = useState<ListDragBox | null>(null);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [placement, setPlacement] = useState<ListDropPosition | null>(null);
  const placementRef = useRef<ListDropPosition | null>(null);
  const pointerTarget = useRef<ListDropPosition | null>(null);
  const keyboardTarget = useRef<ListDropPosition | null>(null);
  const updatePlacement = (next: ListDropPosition | null) => {
    if (next?.groupId === placementRef.current?.groupId && next?.beforeKey === placementRef.current?.beforeKey) return;
    placementRef.current = next;
    setPlacement(next);
  };
  const dragItems = useMemo(() => buildListDragItems(groups), [groups]);
  const dropGroups = useMemo(() => groups.some((group) => group.id === UNLISTED_GROUP_ID) ? groups
    : [...groups, { id: UNLISTED_GROUP_ID, name: '', entries: [] }], [groups]);
  const targets = useMemo(() => new Map(dropGroups.map((group) => [listDropId(group.id), group])), [dropGroups]);
  useEffect(() => {
    if (!arrival) return;
    const timer = window.setTimeout(() => setArrival(null), 300);
    return () => window.clearTimeout(timer);
  }, [arrival]);

  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { active: id, context, currentCoordinates }) => {
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    const item = dragItems.get(String(id));
    if (!item) return;
    const choices = dropGroups.filter((group) => item.kind !== 'list' || group.id !== UNLISTED_GROUP_ID);
    const current = choices.findIndex((group) => group.id === keyboardTarget.current?.groupId);
    let target = choices[current];
    let next: ListDropPosition;
    if (item.kind === 'entry' && target && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const entries = target.entries.filter(entry => entryDisabledPreferenceKey(entry) !== entryDisabledPreferenceKey(item.entry));
      const index = listDropSlotIndex(target.entries, item.entry, keyboardTarget.current?.beforeKey ?? null);
      const entry = entries[Math.max(0, Math.min(entries.length, index + direction))];
      next = { groupId: target.id, beforeKey: entry ? entryDisabledPreferenceKey(entry) : null };
    } else {
      target = choices[Math.max(0, Math.min(choices.length - 1, current + direction))];
      if (!target) return;
      next = { groupId: target.id, beforeKey: null };
    }
    const rect = target && context.droppableRects.get(listDropId(target.id));
    if (!target || !rect || !context.collisionRect) return;
    event.preventDefault();
    keyboardTarget.current = next;
    updatePlacement(next);
    return {
      x: currentCoordinates.x + rect.left + rect.width / 2 - context.collisionRect.left - context.collisionRect.width / 2,
      y: currentCoordinates.y + rect.top + 20 - context.collisionRect.top - context.collisionRect.height / 2,
    };
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const collisionDetection: CollisionDetection = (args) => {
    const item = dragItems.get(String(args.active.id));
    if (!item) return [];
    const containers = args.droppableContainers.filter((container) => {
      const target = targets.get(String(container.id));
      return target && (item.kind !== 'list' || target.id !== UNLISTED_GROUP_ID);
    });
    if (!args.pointerCoordinates) {
      const id = keyboardTarget.current && listDropId(keyboardTarget.current.groupId);
      return id && containers.some((container) => container.id === id) ? [{ id }] : [];
    }
    const hit = document.elementFromPoint(args.pointerCoordinates.x, args.pointerCoordinates.y)?.closest('[data-mod-list]')?.getAttribute('data-mod-list');
    const target = hit && containers.find((container) => targets.get(String(container.id))?.id === hit);
    pointerTarget.current = target && hit ? pointerPosition(hit, args.pointerCoordinates, placementRef.current) : null;
    return target ? [{ id: target.id }] : [];
  };
  const targetName = (id: string) => id === UNLISTED_GROUP_ID ? t('installed.lists.unlisted') : targets.get(listDropId(id))?.name ?? '';
  const positionedGroup = placement && targets.get(listDropId(placement.groupId));
  const positionAnnouncement = active?.kind === 'entry' && placement && positionedGroup
    ? t('installed.lists.dropPosition', { position: listDropSlotIndex(positionedGroup.entries, active.entry, placement.beforeKey) + 1,
      count: positionedGroup.entries.filter(entry => entryDisabledPreferenceKey(entry) !== entryDisabledPreferenceKey(active.entry)).length + 1,
      name: targetName(positionedGroup.id) }) : '';
  const visibleGroups = dropGroups.filter((group) => group.entries.length > 0 || (group.id === UNLISTED_GROUP_ID ? active?.kind === 'entry' : showEmpty || active?.kind === 'entry'));
  const emptyState = groups.some((group) => group.id !== UNLISTED_GROUP_ID) ? null : <EmptyState icon={List}
    title={t('installed.lists.emptyTitle')} description={t('installed.lists.emptyHint')}
    action={<Button variant="secondary" onClick={() => onManage()}>{t('installed.lists.manageTitle')}</Button>} className="py-12" />;
  const mountLimits = new Map<string, number>();
  let remaining = mountLimit;
  for (const group of visibleGroups) {
    mountLimits.set(group.id, remaining);
    if (!collapsed.has(group.id)) remaining = Math.max(0, remaining - group.entries.length);
  }
  return <DndContext sensors={sensors} collisionDetection={collisionDetection}
    accessibility={{
      screenReaderInstructions: { draggable: t('installed.lists.dragCardInstructions') },
      announcements: {
        onDragStart: ({ active: item }) => {
          const drag = dragItems.get(String(item.id));
          return drag ? t(drag.kind === 'entry' ? 'installed.lists.movingMod' : 'installed.lists.pickedUp', { name: drag.kind === 'entry' ? entryName(drag.entry) : targetName(drag.id) }) : undefined;
        },
        onDragOver: ({ over }) => {
          const target = over && targets.get(String(over.id));
          return target ? t('installed.lists.dropInto', { name: targetName(target.id) }) : undefined;
        },
        onDragEnd: ({ active: item, over }) => {
          const drag = dragItems.get(String(item.id));
          const target = over && targets.get(String(over.id));
          return drag && target && canDropListItem(drag, target.id)
            ? t('installed.lists.movedTo', { name: targetName(target.id) }) : t('installed.lists.dragCancelled');
        },
        onDragCancel: () => t('installed.lists.dragCancelled'),
      },
    }}
    onDragStart={({ active: item }) => {
      const drag = dragItems.get(String(item.id)) ?? null;
      setActive(drag);
      const node = document.querySelector<HTMLElement>('[data-list-drag-id="' + window.CSS.escape(String(item.id)) + '"]');
      setDragBox(node ? { left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight } : null);
      setArrival(null);
      const groupId = drag?.kind === 'entry' ? drag.sourceId : drag?.id;
      const entries = groups.find(group => group.id === groupId)?.entries ?? [];
      const index = drag?.kind === 'entry' ? entries.findIndex(entry => entry.key === drag.entry.key) : -1;
      const next = entries[index + 1];
      const initial = groupId ? { groupId, beforeKey: index >= 0 && next ? entryDisabledPreferenceKey(next) : null } : null;
      keyboardTarget.current = initial;
      pointerTarget.current = initial;
      updatePlacement(initial);
    }}
    onDragMove={({ activatorEvent }) => updatePlacement(activatorEvent.type === 'keydown' ? keyboardTarget.current : pointerTarget.current)}
    onDragOver={({ activatorEvent }) => updatePlacement(activatorEvent.type === 'keydown' ? keyboardTarget.current : pointerTarget.current)}
    onDragCancel={() => { setActive(null); keyboardTarget.current = null; pointerTarget.current = null; updatePlacement(null); }}
    onDragEnd={({ active: item, over, activatorEvent }) => {
      const drag = dragItems.get(String(item.id));
      const target = over && targets.get(String(over.id));
      if (drag && target && canDropListItem(drag, target.id)) {
        if (drag.kind === 'list') onReorder(drag.id, target.id);
        else {
          const key = entryDisabledPreferenceKey(drag.entry);
          const preview = document.querySelector<HTMLElement>('[data-list-drag-preview]')?.getBoundingClientRect();
          const position = activatorEvent.type === 'keydown' ? keyboardTarget.current : pointerTarget.current;
          onMove(key, drag.sourceId, target.id, position?.groupId === target.id ? position.beforeKey : null);
          setArrival({ key, targetId: target.id, from: preview ? { left: preview.left, top: preview.top } : null });
          if (activatorEvent.type === 'keydown') requestAnimationFrame(() => {
            const occurrence = window.CSS.escape(installedListEntryKey(target.id, drag.entry));
            const card = document.querySelector<HTMLElement>('[data-list-drag-id="' + occurrence + '"]');
            const header = document.querySelector<HTMLElement>('[data-mod-list="' + window.CSS.escape(target.id) + '"] h2 button');
            (card ?? header)?.focus({ preventScroll: true });
          });
        }
      }
      setActive(null);
      keyboardTarget.current = null;
      pointerTarget.current = null;
      updatePlacement(null);
    }}>
    <InstalledListDragBoxContext.Provider value={dragBox}>
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{positionAnnouncement}</div>
    {emptyState}
    {visibleGroups.length === 0 && !emptyState ? <p className="py-8 text-center text-sm text-text-secondary">{t('installed.lists.noMatches')}</p>
      : <div className="divide-y divide-border">
        {visibleGroups.map((group) => <ListSection key={group.id} group={group} collapsed={collapsed.has(group.id)}
          mountLimit={mountLimits.get(group.id) ?? 0} onToggle={() => onToggle(group.id)} onManage={onManage}
          dragDisabled={dragDisabled} active={active} dragBox={dragBox} placement={placement} arrival={arrival} gridClassName={gridClassName} gridStyle={gridStyle} renderEntry={renderEntry} rows={rows} />)}
      </div>}
    </InstalledListDragBoxContext.Provider>
    {createPortal(<DragOverlay adjustScale={false} zIndex={30} dropAnimation={arrival || reducedMotion ? null : { duration: 180 }}
      style={{ pointerEvents: 'none', ...(active?.kind === 'list' ? { width: 220 } : {}) }}>
      {active && <div inert aria-hidden data-list-drag-preview className="mod-list-drag-preview rounded-xl shadow-2xl ring-1 ring-accent/30">
        {active.kind === 'entry' ? renderEntry(active.entry, 'drag-preview') : <div className="flex items-center gap-2 rounded-sm border border-border bg-bg-secondary p-3 text-sm text-text-primary shadow-xl">
          <ModListGlyph icon={groups.find((group) => group.id === active.id)?.icon} />{targetName(active.id)}
        </div>}
      </div>}
    </DragOverlay>, document.body)}
  </DndContext>;
}

// The modal edits membership immediately; its obscured card grid catches up on close.
export const InstalledListGroups = memo(InstalledListGroupsView, (previous, next) => previous.pauseUpdates && next.pauseUpdates);
