import { Fragment, useId, type CSSProperties, type ReactNode } from 'react';
import { ChevronRight, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '../common/ui';
import { ModListGlyph } from './ModListIcon';
import { installedListEntryKey, type InstalledListGroup } from '../../lib/installedListGroups';
import type { ModEntry } from '../../lib/modEntries';

function ListSection({ group, collapsed, mountLimit, onToggle, gridClassName, gridStyle, renderEntry }: {
  group: InstalledListGroup;
  collapsed: boolean;
  mountLimit: number;
  onToggle: () => void;
  gridClassName: string;
  gridStyle?: CSSProperties;
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
        <span className="min-w-0 truncate font-semibold">{group.name}</span>
        <span title={t('installed.lists.memberCount', { count: group.entries.length })}><Badge className="tabular-nums">{group.entries.length}</Badge></span>
      </button>
    </h2>
    <div id={contentId} hidden={collapsed}>
      {!collapsed && <div className="pb-4">
        {group.entries.length > 0 ? <div className={gridClassName} style={gridStyle}>
          {group.entries.slice(0, mountLimit).map((entry) => {
            const occurrence = installedListEntryKey(group.id, entry);
            return <Fragment key={occurrence}>{renderEntry(entry, occurrence)}</Fragment>;
          })}
        </div> : <p className="py-3 text-xs text-text-secondary">{t('installed.lists.emptyList')}</p>}
      </div>}
    </div>
  </section>;
}

export function InstalledListGroups({ groups, collapsed, showEmpty, mountLimit, onToggle, onManage, ...grid }: {
  groups: readonly InstalledListGroup[];
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  /** Cards to mount across all open lists; the page's first-paint cap. */
  mountLimit: number;
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
  const mountLimits = new Map<string, number>();
  let remaining = mountLimit;
  for (const group of visibleGroups) {
    mountLimits.set(group.id, remaining);
    if (!collapsed.has(group.id)) remaining = Math.max(0, remaining - group.entries.length);
  }
  return <div className="divide-y divide-border">
    {visibleGroups.map((group) => <ListSection key={group.id} group={group} collapsed={collapsed.has(group.id)} mountLimit={mountLimits.get(group.id) ?? 0} onToggle={() => onToggle(group.id)} {...grid} />)}
  </div>;
}
