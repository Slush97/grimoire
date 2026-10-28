import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../common/forms';
import { SegmentedControl } from '../common/ui';
import { ModListEntryPreview } from './ModListEntryPreview';
import { entryDisabledPreferenceKey, entryName, entryPrimaryMod, entrySearchText, type ModEntry } from '../../lib/modEntries';
import type { ModList } from '../../lib/modLists';

export function ModListMemberPicker({ list, entries, hideNsfw, busy, onMembership }: {
  list: ModList;
  entries: readonly ModEntry[];
  hideNsfw: boolean;
  busy: boolean;
  onMembership: (id: string, key: string, member: boolean) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'members'>('all');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const scrollRef = useRef<HTMLDivElement>(null);
  const members = useMemo(() => new Set(list.keys), [list.keys]);
  const indexed = useMemo(() => entries.map((entry) => ({
    entry, key: entryDisabledPreferenceKey(entry),
    search: `${entrySearchText(entry)}\n${entryPrimaryMod(entry).categoryName ?? ''}`.toLocaleLowerCase(),
  })), [entries]);
  const visible = useMemo(() => indexed.filter((item) =>
    (scope === 'all' || members.has(item.key)) && (!query || item.search.includes(query))), [indexed, scope, members, query]);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    getItemKey: (index) => visible[index].entry.key,
    overscan: 5,
  });
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('installed.lists.modsIn', { name: list.name })}>
    <div className="space-y-3 border-b border-border p-4">
      <h3 className="truncate text-sm font-semibold text-text-primary">{list.name}</h3>
      <Input inputSize="sm" icon={Search} value={search} placeholder={t('installed.lists.searchMods')}
        aria-label={t('installed.lists.searchMods')} onChange={(event) => {
          setSearch(event.target.value);
          scrollRef.current?.scrollTo({ top: 0 });
        }} />
      <SegmentedControl value={scope} onChange={(value) => { setScope(value); scrollRef.current?.scrollTo({ top: 0 }); }}
        options={[{ value: 'all', label: t('installed.lists.allMods') }, { value: 'members', label: t('installed.lists.inList') }]} />
    </div>
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-gutter:stable]" data-list-member-picker>
      {visible.length > 0 ? <div role="group" aria-label={t('installed.lists.availableMods')} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const { entry, key } = visible[row.index];
          const selected = members.has(key);
          const mod = entryPrimaryMod(entry);
          return <button key={row.key} type="button" role="checkbox" aria-checked={selected}
            data-member-index={row.index}
            aria-label={t(selected ? 'installed.lists.removeMod' : 'installed.lists.addMod', { name: entryName(entry) })}
            disabled={busy} onClick={() => onMembership(list.id, key, !selected)}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowDown' ? row.index + 1 : event.key === 'ArrowUp' ? row.index - 1
                : event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : undefined;
              if (next === undefined) return;
              event.preventDefault();
              const index = Math.max(0, Math.min(visible.length - 1, next));
              virtualizer.scrollToIndex(index, { align: 'auto' });
              requestAnimationFrame(() => {
                scrollRef.current?.querySelector<HTMLButtonElement>(`[data-member-index="${index}"]`)?.focus({ preventScroll: true });
              });
            }}
            className="absolute left-0 top-0 flex w-full items-center gap-3 rounded-sm px-2 text-left hover:bg-hl/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-50"
            style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
            <ModListEntryPreview entry={entry} hideNsfw={hideNsfw} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-text-primary">{entryName(entry)}</span>
              <span className="block truncate text-xs text-text-secondary">{entry.kind === 'group'
                ? t('installed.lists.variants', { count: entry.variants.length }) : mod.categoryName ?? mod.fileName}</span>
            </span>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border ${selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-text-tertiary'}`}>
              {selected ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
            </span>
          </button>;
        })}
      </div> : <p className="px-3 py-8 text-center text-sm text-text-secondary">{t(query ? 'installed.lists.noMatchingMods' : 'installed.lists.noMembers')}</p>}
    </div>
  </section>;
}
