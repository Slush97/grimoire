import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { ChevronRight, GripVertical, List, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, IconButton } from '../common/ui';
import { EmptyState } from '../common/PageComponents';
import { ModListGlyph } from './ModListIcon';
import { installedListEntryKey, UNLISTED_GROUP_ID, type InstalledListGroup } from '../../lib/installedListGroups';
import { entryDisabledPreferenceKey, entryName, type ModEntry } from '../../lib/modEntries';
import { buildListDragItems, canDropListItem, listDropId, listHeaderDragId, type ModListDrag } from '../../lib/modListDrag';
import { InstalledListEntryDrag } from './InstalledListEntryDrag';

interface GridProps {
  gridClassName: string;
  gridStyle?: CSSProperties;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}
interface ListGroupsProps extends GridProps {
  groups: readonly InstalledListGroup[];
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  mountLimit: number;
  onToggle: (id: string) => void;
  onManage: (id?: string) => void;
  onMove: (key: string, sourceId: string, targetId: string) => void;
  onReorder: (id: string, targetId: string) => void;
  dragDisabled: boolean;
  pauseUpdates: boolean;
}
interface Arrival { key: string; targetId: string }

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

function ListSection({ group, collapsed, mountLimit, onToggle, onManage, dragDisabled, active, arrival, gridClassName, gridStyle, renderEntry }: GridProps & {
  group: InstalledListGroup;
  collapsed: boolean;
  mountLimit: number;
  onToggle: () => void;
  onManage: (id?: string) => void;
  dragDisabled: boolean;
  active: ModListDrag | null;
  arrival: Arrival | null;
}) {
  const { t } = useTranslation();
  const contentId = useId();
  const isList = group.id !== UNLISTED_GROUP_ID;
  const { setNodeRef, isOver } = useDroppable({
    id: listDropId(group.id),
    disabled: dragDisabled || (active?.kind === 'list' && !isList),
  });
  const over = isOver && active && canDropListItem(active, group.id);
  const landed = arrival?.targetId === group.id;
  const incomingKey = landed ? arrival.key : null;
  const cards = useMemo(() => group.entries.slice(0, mountLimit).map((entry) => {
    const occurrence = installedListEntryKey(group.id, entry);
    return <InstalledListEntryDrag key={occurrence} id={occurrence} entry={entry} disabled={dragDisabled}
      arriving={incomingKey === entryDisabledPreferenceKey(entry)}>
      {renderEntry(entry, occurrence)}
    </InstalledListEntryDrag>;
  }), [group.entries, group.id, mountLimit, dragDisabled, incomingKey, renderEntry]);
  return <section ref={setNodeRef} data-mod-list={group.id} data-drop-complete={landed || undefined}
    className={'rounded-sm ' + (over ? 'bg-accent/5 ring-2 ring-inset ring-accent' : '')}>
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
        {group.entries.length > 0 ? <div className={gridClassName} style={gridStyle}>
          {cards}
        </div> : isList ? <div className="py-3">
          <Button variant="ghost" size="sm" icon={Plus} disabled={dragDisabled} onClick={() => onManage(group.id)}>{t('installed.lists.addMods')}</Button>
        </div> : <div className="h-8" />}
      </div>}
    </div>
  </section>;
}

function InstalledListGroupsView({ groups, collapsed, showEmpty, mountLimit, onToggle, onManage, onMove, onReorder, dragDisabled, gridClassName, gridStyle, renderEntry }: ListGroupsProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<ModListDrag | null>(null);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const keyboardTarget = useRef<string | null>(null);
  const dragItems = useMemo(() => buildListDragItems(groups), [groups]);
  const dropGroups = useMemo(() => groups.some((group) => group.id === UNLISTED_GROUP_ID) ? groups
    : [...groups, { id: UNLISTED_GROUP_ID, name: '', entries: [] }], [groups]);
  const targets = useMemo(() => new Map(dropGroups.map((group) => [listDropId(group.id), group])), [dropGroups]);
  useEffect(() => {
    if (!arrival) return;
    const timer = window.setTimeout(() => setArrival(null), 420);
    return () => window.clearTimeout(timer);
  }, [arrival]);

  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { active: id, context, currentCoordinates }) => {
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    const item = dragItems.get(String(id));
    if (!item) return;
    const choices = dropGroups.filter((group) => item.kind !== 'list' || group.id !== UNLISTED_GROUP_ID);
    const current = choices.findIndex((group) => group.id === keyboardTarget.current);
    const target = choices[Math.max(0, Math.min(choices.length - 1, current + direction))];
    const rect = target && context.droppableRects.get(listDropId(target.id));
    if (!target || !rect || !context.collisionRect) return;
    event.preventDefault();
    keyboardTarget.current = target.id;
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
      const id = keyboardTarget.current && listDropId(keyboardTarget.current);
      return id && containers.some((container) => container.id === id) ? [{ id }] : [];
    }
    const hit = document.elementFromPoint(args.pointerCoordinates.x, args.pointerCoordinates.y)?.closest('[data-mod-list]')?.getAttribute('data-mod-list');
    const target = hit && containers.find((container) => targets.get(String(container.id))?.id === hit);
    return target ? [{ id: target.id }] : [];
  };
  const targetName = (id: string) => id === UNLISTED_GROUP_ID ? t('installed.lists.unlisted') : targets.get(listDropId(id))?.name ?? '';
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
      setArrival(null);
      keyboardTarget.current = drag?.kind === 'entry' ? drag.sourceId : drag?.id ?? null;
    }}
    onDragCancel={() => { setActive(null); keyboardTarget.current = null; }}
    onDragEnd={({ active: item, over, activatorEvent }) => {
      const drag = dragItems.get(String(item.id));
      const target = over && targets.get(String(over.id));
      if (drag && target && canDropListItem(drag, target.id)) {
        if (drag.kind === 'list') onReorder(drag.id, target.id);
        else {
          const key = entryDisabledPreferenceKey(drag.entry);
          onMove(key, drag.sourceId, target.id);
          setArrival({ key, targetId: target.id });
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
    }}>
    {emptyState}
    {visibleGroups.length === 0 && !emptyState ? <p className="py-8 text-center text-sm text-text-secondary">{t('installed.lists.noMatches')}</p>
      : <div className="divide-y divide-border">
        {visibleGroups.map((group) => <ListSection key={group.id} group={group} collapsed={collapsed.has(group.id)}
          mountLimit={mountLimits.get(group.id) ?? 0} onToggle={() => onToggle(group.id)} onManage={onManage}
          dragDisabled={dragDisabled} active={active} arrival={arrival} gridClassName={gridClassName} gridStyle={gridStyle} renderEntry={renderEntry} />)}
      </div>}
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
