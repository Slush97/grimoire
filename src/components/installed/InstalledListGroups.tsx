import { useId, type CSSProperties, type ReactNode } from 'react';
import { ChevronRight, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/ui';
import { installedListEntryKey, type InstalledListGroup } from '../../lib/installedListGroups';
import { isEntryEnabled, type ModEntry } from '../../lib/modEntries';

function ListSection({ group, collapsed, onToggle, gridClassName, gridStyle, renderEntry }: {
  group: InstalledListGroup;
  collapsed: boolean;
  onToggle: () => void;
  gridClassName: string;
  gridStyle?: CSSProperties;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const contentId = useId();
  const enabled = group.entries.filter(isEntryEnabled).length;
  return <section>
    <h2>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex h-11 w-full cursor-pointer items-center gap-3 px-4 text-left text-sm text-text-primary transition-colors hover:bg-hl/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <ChevronRight aria-hidden className={`h-4 w-4 shrink-0 text-text-tertiary ${collapsed ? '' : 'rotate-90'}`} />
        <List aria-hidden className="h-4 w-4 shrink-0 text-text-secondary" />
        <span className="min-w-0 truncate font-semibold">{group.name}</span>
        <span className="text-xs tabular-nums text-text-tertiary">{t('installed.lists.memberCount', { count: group.entries.length })}</span>
        {group.entries.length > 0 && <span className="ml-auto shrink-0 text-xs tabular-nums text-text-secondary">{t('installed.lists.enabledCount', { count: enabled })}</span>}
      </button>
    </h2>
    <div id={contentId} hidden={collapsed}>
      {!collapsed && <div className="px-4 pb-4 pt-1">
        {group.entries.length > 0 ? <div className={gridClassName} style={gridStyle}>
          {group.entries.map((entry) => {
            const occurrence = installedListEntryKey(group.id, entry);
            return <div key={occurrence}>{renderEntry(entry, occurrence)}</div>;
          })}
        </div> : <p className="py-3 text-xs text-text-secondary">{t('installed.lists.emptyList')}</p>}
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
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const visibleGroups = groups.filter((group) => showEmpty || group.entries.length > 0);
  if (groups.length === 0) return <div className="flex flex-col items-center gap-3 py-12 text-center">
    <List className="h-8 w-8 text-text-tertiary" aria-hidden />
    <h2 className="font-reaver text-base text-text-primary">{t('installed.lists.emptyTitle')}</h2>
    <p className="max-w-sm text-sm text-text-secondary">{t('installed.lists.emptyHint')}</p>
    <Button variant="secondary" onClick={onManage}>{t('installed.lists.manageTitle')}</Button>
  </div>;
  if (visibleGroups.length === 0) return <p className="py-8 text-center text-sm text-text-secondary">{t('installed.lists.noMatches')}</p>;
  return <div className="divide-y divide-border overflow-hidden rounded-sm border border-border">
    {visibleGroups.map((group) => <ListSection key={group.id} group={group} collapsed={collapsed.has(group.id)} onToggle={() => onToggle(group.id)} {...grid} />)}
  </div>;
}
