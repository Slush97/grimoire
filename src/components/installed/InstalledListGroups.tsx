import { useId, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ChevronRight, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '../common/ui';
import { EmptyState } from '../common/PageComponents';
import { ModListGlyph } from './ModListIcon';
import { installedListEntryKey, UNLISTED_GROUP_ID, type InstalledListGroup } from '../../lib/installedListGroups';
import type { ModEntry } from '../../lib/modEntries';
import { InstalledVirtualGrid } from './InstalledVirtualGrid';

function ListSection({ group, collapsed, onToggle, gridClassName, gridStyle, scrollRef, viewMode, revealEntryKey, renderEntry }: {
  group: InstalledListGroup;
  collapsed: boolean;
  onToggle: () => void;
  gridClassName: string;
  gridStyle?: CSSProperties;
  scrollRef: RefObject<HTMLDivElement | null>;
  viewMode: 'grid' | 'compact' | 'list';
  revealEntryKey?: string | null;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const contentId = useId();
  return <section>
    <h2>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <ChevronRight aria-hidden className={`h-4 w-4 shrink-0 text-text-tertiary ${collapsed ? '' : 'rotate-90'}`} />
        <ModListGlyph icon={group.icon} />
        <span className="min-w-0 truncate font-semibold">{group.id === UNLISTED_GROUP_ID ? t('installed.lists.unlisted') : group.name}</span>
        <span title={t('installed.lists.memberCount', { count: group.entries.length })}><Badge className="tabular-nums">{group.entries.length}</Badge></span>
      </button>
    </h2>
    <div id={contentId} hidden={collapsed}>
      {!collapsed && <div className="pb-4">
        {group.entries.length > 0 ? <InstalledVirtualGrid
          entries={group.entries}
          scrollRef={scrollRef}
          gridClassName={gridClassName}
          gridStyle={gridStyle}
          viewMode={viewMode}
          revealEntryKey={revealEntryKey}
          getEntryKey={(entry) => installedListEntryKey(group.id, entry)}
          renderEntry={(entry) => renderEntry(entry, installedListEntryKey(group.id, entry))}
        /> : <p className="py-3 text-xs text-text-secondary">{t('installed.lists.emptyList')}</p>}
      </div>}
    </div>
  </section>;
}

export function InstalledListGroups({ groups, collapsed, showEmpty, onToggle, onManage, ...grid }: {
  groups: readonly InstalledListGroup[];
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  onToggle: (id: string) => void;
  onManage: () => void;
  gridClassName: string;
  gridStyle?: CSSProperties;
  scrollRef: RefObject<HTMLDivElement | null>;
  viewMode: 'grid' | 'compact' | 'list';
  revealEntryKey?: string | null;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const visibleGroups = groups.filter((group) => showEmpty || group.entries.length > 0);
  const emptyState = groups.some((group) => group.id !== UNLISTED_GROUP_ID) ? null : <EmptyState
    icon={List}
    title={t('installed.lists.emptyTitle')}
    description={t('installed.lists.emptyHint')}
    action={<Button variant="secondary" onClick={onManage}>{t('installed.lists.manageTitle')}</Button>}
    className="py-12"
  />;
  if (visibleGroups.length === 0) return emptyState ?? <p className="py-8 text-center text-sm text-text-secondary">{t('installed.lists.noMatches')}</p>;
  return <>
    {emptyState}
    <div className="divide-y divide-border">
      {visibleGroups.map((group) => <ListSection key={group.id} group={group} collapsed={collapsed.has(group.id)} onToggle={() => onToggle(group.id)} {...grid} />)}
    </div>
  </>;
}
