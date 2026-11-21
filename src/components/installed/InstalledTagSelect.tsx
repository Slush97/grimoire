import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownSelect } from '../common/forms';
import { CheckboxMark, IconButton } from '../common/ui';
import type { FilterCheckOption } from './FilterCheckList';
import { sortInstalledTags } from '../../lib/installedCardTaxonomy';
import { useStableCallback } from '../../lib/useStableCallback';

export interface InstalledTagOption extends FilterCheckOption { custom?: boolean }
type TagEditResult = boolean | void | Promise<boolean | void>;

function placeTag(keys: string[], key: string, position: number): void {
  if (!Number.isSafeInteger(position)) return;
  const from = keys.indexOf(key);
  const to = Math.max(0, Math.min(keys.length - 1, position - 1));
  if (from < 0 || from === to) return;
  keys.splice(from, 1);
  keys.splice(to, 0, key);
}

export interface InstalledTagSelectProps {
  options: readonly InstalledTagOption[];
  included: readonly string[];
  excluded: readonly string[];
  onInclude: (key: string) => void;
  onExclude: (key: string) => void;
  onCreate: (name: string) => TagEditResult;
  onRename: (key: string, name: string) => TagEditResult;
  onDelete: (key: string) => void | Promise<void>;
  order: readonly string[];
  cycleFilters?: boolean;
  onOrderChange: (keys: string[]) => void;
  onResetOrder: () => void;
}

/** Tag-specific editing uses the shared selector's search and action row. */
export function InstalledTagSelect({ options, included, excluded, onInclude, onExclude, onCreate, onRename, onDelete, order, onOrderChange, onResetOrder, cycleFilters = false }: InstalledTagSelectProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const priorityInputRef = useRef<HTMLInputElement>(null);
  const [priorityEdit, setPriorityEdit] = useState<{ key: string; draft: string } | null>(null);
  const [error, setError] = useState('');
  const byKey = useMemo(() => new Map(options.map(option => [option.key, option])), [options]);
  const orderedOptions = useMemo(() => editing ? sortInstalledTags(options, order) : options, [editing, options, order]);
  const positions = useMemo(() => new Map(orderedOptions.map((option, index) => [option.key, index])), [orderedOptions]);
  const stepPositions = useMemo(() => {
    if (!priorityEdit?.draft) return positions;
    const keys = orderedOptions.map(option => option.key);
    placeTag(keys, priorityEdit.key, Number(priorityEdit.draft));
    return new Map(keys.map((key, index) => [key, index]));
  }, [orderedOptions, positions, priorityEdit]);
  const selected = [...included, ...excluded];
  const selectionSummary = [
    included.length > 0 ? `+${included.length}` : '',
    excluded.length > 0 ? `-${excluded.length}` : '',
  ].filter(Boolean).join('/');
  const displayLabel = selected.length === 1
    ? t('installed.filters.signedTag', { sign: excluded.length === 1 ? '-' : '+', name: byKey.get(selected[0])?.label ?? selected[0] })
    : selected.length > 1 ? t('installed.filters.tagSelectionCount', { count: selected.length, selection: selectionSummary }) : t('installed.filters.allTags');

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing, renaming]);

  const priorityKey = priorityEdit?.key;
  useLayoutEffect(() => {
    if (!priorityKey) return;
    priorityInputRef.current?.focus();
    priorityInputRef.current?.select();
  }, [priorityKey]);

  const changeQuery = useCallback((value: string) => { setQuery(value); setError(''); }, []);
  const cancelRename = useCallback(() => { setRenaming(null); changeQuery(''); }, [changeQuery]);
  const moveTag = (key: string, change: { position: number } | { step: number }) => {
    setPriorityEdit(null);
    if (busyRef.current) return;
    const keys = orderedOptions.map(option => option.key);
    if ('step' in change && priorityEdit?.draft) placeTag(keys, priorityEdit.key, Number(priorityEdit.draft));
    placeTag(keys, key, 'position' in change ? change.position : keys.indexOf(key) + change.step + 1);
    if (keys.some((value, index) => value !== orderedOptions[index]?.key)) onOrderChange(keys);
  };
  const commitPriority = (key: string, draft: string) => {
    if (draft) moveTag(key, { position: Number(draft) });
    else setPriorityEdit(null);
  };
  const closeEdits = useStableCallback(() => {
    if (priorityEdit) commitPriority(priorityEdit.key, priorityEdit.draft);
    cancelRename();
  });
  const apply = async (change: () => TagEditResult) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (await change() === false) { setError(t('installed.tags.duplicateName')); return false; }
      return true;
    } catch (error) {
      setError(t('installed.tags.failed', { error: error instanceof Error ? error.message : String(error) }));
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };

  const saveName = (name: string) => {
    void apply(() => renaming ? onRename(renaming, name) : onCreate(name)).then(saved => {
      if (saved) cancelRename();
    });
  };
  const toggleFilter = (key: string, exclude = false) => {
    if (editing || busyRef.current) return;
    if (cycleFilters) {
      if (exclude) {
        if (included.includes(key)) onInclude(key);
        else if (excluded.includes(key)) onExclude(key);
      } else if (included.includes(key) || excluded.includes(key)) onExclude(key);
      else onInclude(key);
      return;
    }
    if (exclude || excluded.includes(key)) onExclude(key);
    else onInclude(key);
  };

  return <DropdownSelect value="" values={selected} active={selected.length > 0} displayLabel={displayLabel}
    onClose={closeEdits}
    ariaLabel={t('installed.filters.tags')} onChange={key => toggleFilter(key)}
    onOptionContextMenu={editing ? undefined : key => toggleFilter(key, true)}
    options={orderedOptions.map(option => ({ value: option.key, label: option.label, disabled: editing || busy,
      ariaLabel: editing ? option.label : t(cycleFilters && included.includes(option.key) ? 'installed.tags.excludeHint'
        : selected.includes(option.key) ? 'installed.tags.clearFilter' : 'installed.tags.includeHint', { name: option.label }) }))}
    search={{ ariaLabel: renaming ? t('installed.tags.renameLabel') : editing ? t('installed.tags.create') : t('installed.filters.tags'),
      icon: editing ? Plus : undefined,
      placeholder: editing ? t('installed.tags.createPlaceholder') : t('browse.filters.filterPlaceholder'),
      value: query, onChange: changeQuery, inputRef, disabled: busy,
      clearLabel: t('browse.filters.clearSearch'), getEmptyMessage: query => t('browse.filters.noOptionsMatch', { query }),
      filterOptions: !editing, maxLength: editing ? 80 : undefined,
      onSubmit: editing ? saveName : undefined,
      actions: renaming ? <IconButton icon={X} disabled={busy} label={t('common.actions.cancel')} onClick={cancelRename} />
        : <IconButton icon={Pencil} disabled={busy} label={t('installed.tags.edit')} aria-pressed={editing}
          title={editing ? t('installed.tags.resetOrderHint') : undefined}
          className={editing ? 'border-accent/40! bg-accent/10! text-accent!' : ''}
          onClick={() => { setEditing(value => !value); setPriorityEdit(null); changeQuery(''); }}
          onContextMenu={editing ? event => { event.preventDefault(); if (!busyRef.current) onResetOrder(); } : undefined} />,
      message: error ? <p role="alert" className="mt-2 text-xs text-state-danger">{error}</p> : undefined,
    }}
    renderOption={option => {
      const excludedTag = excluded.includes(option.value);
      const customTag = byKey.get(option.value)?.custom;
      const checked = included.includes(option.value) || excludedTag;
      const index = positions.get(option.value) ?? 0;
      const stepIndex = stepPositions.get(option.value) ?? index;
      const position = index + 1;
      const priorityHint = t('installed.tags.priorityHint');
      return <span className="group/tag-order flex min-w-0 flex-1 items-center gap-2">
        {editing ? <span className="-ml-2 flex shrink-0 items-center gap-0.5" onKeyDown={event => event.stopPropagation()}>
          <span className="flex w-3 shrink-0 flex-col opacity-0 pointer-events-none group-hover/tag-order:opacity-100 group-hover/tag-order:pointer-events-auto group-focus-within/tag-order:opacity-100 group-focus-within/tag-order:pointer-events-auto">
            <button type="button" disabled={busy || stepIndex === 0} aria-label={t('installed.tags.moveUp', { name: option.label })}
              className="flex h-3 w-3 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-text-secondary outline-none hover:text-text-primary focus-visible:text-text-primary disabled:cursor-default disabled:opacity-30"
              onMouseDown={event => event.preventDefault()}
              onClick={() => moveTag(option.value, { step: -1 })}><ChevronUp className="h-3 w-3" aria-hidden /></button>
            <button type="button" disabled={busy || stepIndex === orderedOptions.length - 1} aria-label={t('installed.tags.moveDown', { name: option.label })}
              className="flex h-3 w-3 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-text-secondary outline-none hover:text-text-primary focus-visible:text-text-primary disabled:cursor-default disabled:opacity-30"
              onMouseDown={event => event.preventDefault()}
              onClick={() => moveTag(option.value, { step: 1 })}><ChevronDown className="h-3 w-3" aria-hidden /></button>
          </span>
          {priorityEdit?.key === option.value ? <input ref={priorityInputRef} type="text" inputMode="numeric" pattern="[0-9]*"
            value={priorityEdit.draft} aria-label={t('installed.tags.priorityInput', { name: option.label })} title={priorityHint}
            className="min-w-0 border-0 bg-transparent p-0 text-left text-xs text-text-primary tabular-nums outline-none"
            style={{ width: `${Math.max(1, Math.min(priorityEdit.draft.length, String(orderedOptions.length).length))}ch` }}
            onChange={event => setPriorityEdit({ key: option.value, draft: event.target.value.replace(/\D/g, '') })}
            onBlur={event => commitPriority(option.value, event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === 'Escape') { event.preventDefault(); setPriorityEdit(null); }
            }} /> : <button type="button" disabled={busy} title={priorityHint}
              aria-label={t('installed.tags.priorityInput', { name: option.label })}
              className="cursor-text border-0 bg-transparent p-0 text-left text-xs text-text-secondary tabular-nums outline-none hover:text-text-primary focus-visible:text-text-primary"
              onClick={() => setPriorityEdit({ key: option.value, draft: String(position) })}>{position}.</button>}
        </span> : <CheckboxMark variant="menu" checked={checked} tone={excludedTag ? 'danger' : 'success'} icon={excludedTag ? Minus : Plus} className="transition-none!" />}
        <span className={`min-w-0 flex-1 truncate ${editing && !customTag ? 'text-text-tertiary' : ''}`}>{option.label}</span>
        {!editing && <span className="shrink-0 text-2xs text-text-secondary">{byKey.get(option.value)?.count ?? 0}</span>}
      </span>;
    }}
    optionActions={editing ? option => byKey.get(option.value)?.custom && <div className="flex shrink-0 items-center gap-1 pr-1">
      <IconButton icon={Pencil} size="sm" disabled={busy} label={t('installed.tags.rename', { name: option.label })}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { if (priorityEdit) commitPriority(priorityEdit.key, priorityEdit.draft); setRenaming(option.value); changeQuery(option.label); }} />
      <IconButton icon={Trash2} size="sm" disabled={busy} tone="danger" label={t('common.actions.delete')}
        className="border-state-danger/40! text-state-danger!"
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          if (priorityEdit) commitPriority(priorityEdit.key, priorityEdit.draft);
          void apply(() => onDelete(option.value)).then(deleted => { if (deleted && renaming === option.value) cancelRename(); });
        }} />
    </div> : undefined} />;
}
