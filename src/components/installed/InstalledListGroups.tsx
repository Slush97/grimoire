import { memo, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronRight, GripVertical, List, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, IconButton } from '../common/ui';
import { EmptyState } from '../common/PageComponents';
import { ModListGlyph } from './ModListIcon';
import { installedListEntryKey, UNLISTED_GROUP_ID, type InstalledListGroup } from '../../lib/installedListGroups';
import type { ModEntry } from '../../lib/modEntries';
import { MOD_LIST_DRAG_TYPE, readModListDrag, type ModListDrag } from '../../lib/modListDrag';
import { InstalledListEntryDrag } from './InstalledListEntryDrag';

function ListSection({ group, collapsed, mountLimit, onToggle, onManage, onDrop, dragDisabled, gridClassName, gridStyle, renderEntry }: {
  group: InstalledListGroup;
  collapsed: boolean;
  mountLimit: number;
  onToggle: () => void;
  onManage: (id?: string) => void;
  onDrop: (drag: ModListDrag, targetId: string) => void;
  dragDisabled: boolean;
  gridClassName: string;
  gridStyle?: CSSProperties;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const contentId = useId();
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!over) return;
    const finish = () => setOver(false);
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(); };
    window.addEventListener('dragend', finish, true);
    window.addEventListener('drop', finish, true);
    window.addEventListener('blur', finish);
    window.addEventListener('keydown', cancel, true);
    return () => {
      window.removeEventListener('dragend', finish, true);
      window.removeEventListener('drop', finish, true);
      window.removeEventListener('blur', finish);
      window.removeEventListener('keydown', cancel, true);
    };
  }, [over]);
  const isList = group.id !== UNLISTED_GROUP_ID;
  return <section data-mod-list={group.id}
    className={`rounded-sm ${over ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''}`}
    onDragOver={(event) => {
      if (!isList || dragDisabled || !event.dataTransfer.types.includes(MOD_LIST_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(true);
    }}
    onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOver(false);
    }}
    onDrop={(event) => {
      setOver(false);
      if (!isList || dragDisabled) return;
      const drag = readModListDrag(event.dataTransfer.getData(MOD_LIST_DRAG_TYPE));
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      onDrop(drag, group.id);
    }}>
    <div className="group/list-header flex items-center gap-2">
    <h2 className="min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <ChevronRight aria-hidden className={`h-4 w-4 shrink-0 text-text-tertiary ${collapsed ? '' : 'rotate-90'}`} />
        <span data-list-label className="inline-flex min-w-0 items-center gap-2">
        <ModListGlyph icon={group.icon} />
        <span className="min-w-0 truncate font-semibold">{group.id === UNLISTED_GROUP_ID ? t('installed.lists.unlisted') : group.name}</span>
        <span title={t('installed.lists.memberCount', { count: group.entries.length })}><Badge className="tabular-nums">{group.entries.length}</Badge></span>
        </span>
      </button>
    </h2>
      {isList && <IconButton icon={GripVertical} size="sm" label={t('installed.lists.reorder', { name: group.name })}
        disabled={dragDisabled} draggable={!dragDisabled} onClick={() => onManage(group.id)}
        className="cursor-grab border-transparent text-text-tertiary opacity-0 group-hover/list-header:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData(MOD_LIST_DRAG_TYPE, JSON.stringify({ kind: 'list', id: group.id }));
          event.dataTransfer.effectAllowed = 'move';
          const label = event.currentTarget.parentElement?.querySelector('[data-list-label]');
          if (label) event.dataTransfer.setDragImage(label, 24, 12);
        }} onDragEnd={() => setOver(false)} />}
      {isList && <IconButton icon={Plus} size="sm" label={t('installed.lists.editMembers', { name: group.name })}
        disabled={dragDisabled} onClick={() => onManage(group.id)}
        className="border-transparent opacity-0 group-hover/list-header:opacity-100 focus-visible:opacity-100" />}
    </div>
    <div id={contentId} hidden={collapsed}>
      {!collapsed && <div className="pb-4">
        {group.entries.length > 0 ? <div className={gridClassName} style={gridStyle}>
          {group.entries.slice(0, mountLimit).map((entry) => {
            const occurrence = installedListEntryKey(group.id, entry);
            return <InstalledListEntryDrag key={occurrence} entry={entry} disabled={dragDisabled} onPick={() => onManage(isList ? group.id : undefined)}>
              {renderEntry(entry, occurrence)}
            </InstalledListEntryDrag>;
          })}
        </div> : <div className="py-3"><Button variant="ghost" size="sm" icon={Plus} disabled={dragDisabled}
          onClick={() => onManage(group.id)}>{t('installed.lists.addMods')}</Button></div>}
      </div>}
    </div>
  </section>;
}

function InstalledListGroupsView({ groups, collapsed, showEmpty, mountLimit, onToggle, onManage, onDrop, dragDisabled, gridClassName, gridStyle, renderEntry }: {
  groups: readonly InstalledListGroup[];
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  /** Cards to mount across all open lists; the page's first-paint cap. */
  mountLimit: number;
  onToggle: (id: string) => void;
  onManage: (id?: string) => void;
  onDrop: (drag: ModListDrag, targetId: string) => void;
  dragDisabled: boolean;
  pauseUpdates: boolean;
  gridClassName: string;
  gridStyle?: CSSProperties;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const grid = { gridClassName, gridStyle, renderEntry };
  const visibleGroups = groups.filter((group) => showEmpty || group.entries.length > 0);
  const emptyState = groups.some((group) => group.id !== UNLISTED_GROUP_ID) ? null : <EmptyState
    icon={List}
    title={t('installed.lists.emptyTitle')}
    description={t('installed.lists.emptyHint')}
    action={<Button variant="secondary" onClick={() => onManage()}>{t('installed.lists.manageTitle')}</Button>}
    className="py-12"
  />;
  if (visibleGroups.length === 0) return emptyState ?? <p className="py-8 text-center text-sm text-text-secondary">{t('installed.lists.noMatches')}</p>;
  const mountLimits = new Map<string, number>();
  let remaining = mountLimit;
  for (const group of visibleGroups) {
    mountLimits.set(group.id, remaining);
    if (!collapsed.has(group.id)) remaining = Math.max(0, remaining - group.entries.length);
  }
  return <>
    {emptyState}
    <div className="divide-y divide-border">
      {visibleGroups.map((group) => <ListSection key={group.id} group={group} collapsed={collapsed.has(group.id)} mountLimit={mountLimits.get(group.id) ?? 0}
        onToggle={() => onToggle(group.id)} onManage={onManage} onDrop={onDrop} dragDisabled={dragDisabled} {...grid} />)}
    </div>
  </>;
}

// The modal edits membership immediately; its obscured card grid catches up on close.
export const InstalledListGroups = memo(InstalledListGroupsView, (previous, next) => previous.pauseUpdates && next.pauseUpdates);
