import { useCallback, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Funnel } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { HeroSelect } from '../common/HeroSelect';
import { MultiSelectSegments } from '../common/ui';
import { FilterCheckList, type FilterCheckOption } from './FilterCheckList';
import { InstalledTagSelect, type InstalledTagOption, type InstalledTagSelectProps } from './InstalledTagSelect';
import { HeroIconStack } from './chips';
import type { InstalledSortMode } from '../../lib/installedSort';
import type { InstalledListView } from '../../lib/installedListGroups';

export type InstalledSourceFilter = 'gamebanana' | 'local';
export type InstalledStatusFilter = 'enabled' | 'disabled';

export interface InstalledFilterMenuProps {
  sortMode: InstalledSortMode;
  onSortModeChange: (value: InstalledSortMode) => void;
  view: InstalledListView;
  onViewChange: (value: InstalledListView) => void;
  sourceSel: readonly InstalledSourceFilter[];
  onSourceChange: (values: InstalledSourceFilter[]) => void;
  sourceCounts: { gamebanana: number; local: number };
  statusSel: readonly InstalledStatusFilter[];
  onStatusChange: (values: InstalledStatusFilter[]) => void;
  statusCounts: { enabled: number; disabled: number };
  heroFilter: readonly string[];
  onHeroChange: (value: string[]) => void;
  heroOptions: readonly { name: string; count: number }[];
  tagFilter: readonly string[];
  onTagChange: (values: string[]) => void;
  tagOptions: readonly InstalledTagOption[];
  excludedTagFilter: readonly string[];
  onExcludedTagChange: (values: string[]) => void;
  onCreateTag: InstalledTagSelectProps['onCreate'];
  onRenameTag: InstalledTagSelectProps['onRename'];
  onDeleteTag: InstalledTagSelectProps['onDelete'];
  listFilter: readonly string[];
  onListChange: (values: string[]) => void;
  listOptions: readonly FilterCheckOption[];
  onManageLists: () => void;
  active: boolean;
  onReset: () => void;
}

function toggleValue<T extends string>(selected: readonly T[], value: T): T[] {
  return selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
}

export function InstalledFilterMenu({
  sortMode, onSortModeChange, view, onViewChange,
  sourceSel, onSourceChange, sourceCounts,
  statusSel, onStatusChange, statusCounts, heroFilter, onHeroChange, heroOptions,
  tagFilter, onTagChange, tagOptions, listFilter, onListChange, listOptions,
  excludedTagFilter, onExcludedTagChange, onCreateTag, onRenameTag, onDeleteTag,
  onManageLists, active, onReset,
}: InstalledFilterMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const sortName = useId();
  const close = useCallback(() => setOpen(false), []);
  const sortOptions: readonly { value: InstalledSortMode; label: string }[] = [
    { value: 'priority', label: t('installed.sort.loadOrder') },
    { value: 'name', label: t('installed.sort.nameAZ') },
    { value: 'hero', label: t('installed.sort.heroAZ') },
    { value: 'recent', label: t('installed.sort.recentlyAdded') },
  ];

  return <div ref={anchorRef} className="relative shrink-0">
    <button type="button" onClick={() => setOpen(value => !value)} aria-haspopup="dialog" aria-expanded={open}
      aria-label={t('browse.filters.title')} title={t('browse.filters.title')}
      className={`flex h-[38px] items-center gap-2 rounded-lg border px-3 text-sm text-text-primary transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? 'border-accent/40 bg-accent/10 hover:border-accent/60 hover:bg-accent/20' : 'border-border bg-bg-secondary hover:bg-bg-tertiary'}`}>
      <Funnel className="h-4 w-4" aria-hidden />
      {t('browse.filters.title')}
      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
    </button>
    <AnchoredPopover open={open} onClose={close} anchorRef={anchorRef} width={288}
      ariaLabel={t('browse.filters.title')} className="p-3 text-sm">
      <div className="space-y-3 [&>div:not(:last-child)]:border-b [&>div:not(:last-child)]:border-border [&>div:not(:last-child)]:pb-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-secondary">{t('installed.filters.sort')}</span>
            {active && <button type="button" onClick={onReset}
              className="text-xs text-text-secondary hover:text-accent cursor-pointer">{t('browse.filters.clearAll')}</button>}
          </div>
          <div role="radiogroup" aria-label={t('installed.filters.sort')} className="space-y-1 rounded-lg border border-border bg-bg-secondary p-1">
            {sortOptions.map(option => <label key={option.value}
              className={`flex h-8 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${sortMode === option.value ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'}`}>
              <input type="radio" className="sr-only" name={sortName} value={option.value}
                checked={sortMode === option.value} onChange={() => onSortModeChange(option.value)} />
              <span>{option.label}</span>
              {sortMode === option.value && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            </label>)}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-text-secondary">{t('installed.filters.source')}</div>
          <MultiSelectSegments<InstalledSourceFilter> label={t('installed.filters.source')} selected={sourceSel}
            tone="neutral"
            onToggle={value => onSourceChange(toggleValue(sourceSel, value))} className="w-full" itemClassName="h-7 flex-1 px-2 text-xs"
            options={([
              ['gamebanana', t('installed.filters.gamebanana')], ['local', t('installed.filters.local')],
            ] as const).map(([value, label]) => ({ value, label: <>{label}<span className="opacity-60">{sourceCounts[value]}</span></> }))} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-text-secondary">{t('installed.filters.status')}</div>
          <MultiSelectSegments<InstalledStatusFilter> label={t('installed.filters.status')} selected={statusSel}
            tone="neutral"
            onToggle={value => onStatusChange(toggleValue(statusSel, value))} className="w-full" itemClassName="h-7 flex-1 px-2 text-xs"
            options={([
              ['enabled', t('installed.filters.enabled')], ['disabled', t('locker.global.disabledBadge')],
            ] as const).map(([value, label]) => ({ value, label: <>{label}<span className="opacity-60">{statusCounts[value]}</span></> }))} />
        </div>
        {heroOptions.length > 0 && <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-secondary">{t('installed.filters.hero')}</span>
            {heroFilter.length > 0 && <button type="button" onClick={() => onHeroChange([])}
              className="text-xs text-text-secondary hover:text-accent cursor-pointer">{t('common.actions.clear')}</button>}
          </div>
          <HeroSelect ariaLabel={t('browse.filters.filterByHero')} value="" values={heroFilter} active={heroFilter.length > 0}
            leading={heroFilter.length > 1 ? <HeroIconStack heroes={heroFilter} maxVisible={8} /> : undefined}
            displayLabel={heroFilter.length === 0 ? t('browse.filters.allHeroes') : heroFilter.length === 1 ? heroFilter[0] : t('installed.filters.heroCount', { count: heroFilter.length })}
            onChange={hero => onHeroChange(toggleValue(heroFilter, hero))}
            search={{ ariaLabel: t('browse.filters.searchHeroesAria'), placeholder: t('browse.filters.filterPlaceholder'),
              getEmptyMessage: query => t('browse.filters.noOptionsMatch', { query }), clearLabel: t('browse.filters.clearSearch') }}
            options={heroOptions.map(hero => ({ value: hero.name, label: `${hero.name} (${hero.count})`, heroName: hero.name }))} />
        </div>}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-secondary">{t('installed.filters.tags')}</span>
            {(tagFilter.length > 0 || excludedTagFilter.length > 0) && <button type="button" onClick={() => { onTagChange([]); onExcludedTagChange([]); }}
              className="text-xs text-text-secondary hover:text-accent cursor-pointer">{t('common.actions.clear')}</button>}
          </div>
          <InstalledTagSelect options={tagOptions} included={tagFilter} excluded={excludedTagFilter}
            onInclude={key => { onTagChange(toggleValue(tagFilter, key)); onExcludedTagChange(excludedTagFilter.filter(value => value !== key)); }}
            onExclude={key => { onExcludedTagChange(toggleValue(excludedTagFilter, key)); onTagChange(tagFilter.filter(value => value !== key)); }}
            onCreate={onCreateTag} onRename={onRenameTag} onDelete={onDeleteTag} />
        </div>
        <FilterCheckList bare label={t('installed.filters.lists')} options={listOptions}
          selected={listFilter} onToggle={key => onListChange(toggleValue(listFilter, key))} onClear={() => onListChange([])}
          action={<button type="button" onClick={() => { close(); onManageLists(); }}
            className="text-xs text-text-secondary hover:text-accent cursor-pointer">{t('installed.lists.manage')}</button>}>
          <MultiSelectSegments<InstalledListView> label={t('installed.lists.view')} selected={[view]}
            tone="neutral" multiselectable={false} onToggle={onViewChange} className="mb-2 w-full" itemClassName="h-7 flex-1 px-2 text-xs"
            options={[
              { value: 'all', label: t('installed.lists.defaultView') },
              { value: 'lists', label: t('installed.lists.viewLists') },
            ]} />
        </FilterCheckList>
      </div>
    </AnchoredPopover>
  </div>;
}
