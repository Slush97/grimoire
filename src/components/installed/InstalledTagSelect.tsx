import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownSelect } from '../common/forms';
import { CheckboxMark, IconButton } from '../common/ui';
import type { FilterCheckOption } from './FilterCheckList';

export interface InstalledTagOption extends FilterCheckOption { custom?: boolean }
type TagEditResult = boolean | void | Promise<boolean | void>;
export interface InstalledTagSelectProps {
  options: readonly InstalledTagOption[];
  included: readonly string[];
  excluded: readonly string[];
  onInclude: (key: string) => void;
  onExclude: (key: string) => void;
  onCreate: (name: string) => TagEditResult;
  onRename: (key: string, name: string) => TagEditResult;
  onDelete: (key: string) => void | Promise<void>;
}

/** Tag-specific editing uses the shared selector's search and action row. */
export function InstalledTagSelect({ options, included, excluded, onInclude, onExclude, onCreate, onRename, onDelete }: InstalledTagSelectProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const byKey = useMemo(() => new Map(options.map(option => [option.key, option])), [options]);
  const orderedOptions = editing ? [...options.filter(option => option.custom), ...options.filter(option => !option.custom)] : options;
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

  const changeQuery = useCallback((value: string) => { setQuery(value); setError(''); }, []);
  const cancelRename = useCallback(() => { setRenaming(null); changeQuery(''); }, [changeQuery]);
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
    if (included.includes(key)) onInclude(key);
    else if (excluded.includes(key)) onExclude(key);
    else (exclude ? onExclude : onInclude)(key);
  };

  return <DropdownSelect value="" values={selected} active={selected.length > 0} displayLabel={displayLabel}
    onClose={cancelRename}
    ariaLabel={t('installed.filters.tags')} onChange={key => toggleFilter(key)}
    onOptionContextMenu={editing ? undefined : key => toggleFilter(key, true)}
    options={orderedOptions.map(option => ({ value: option.key, label: option.label, disabled: editing || busy,
      ariaLabel: editing ? option.label : t(selected.includes(option.key) ? 'installed.tags.clearFilter' : 'installed.tags.includeHint', { name: option.label }) }))}
    search={{ ariaLabel: renaming ? t('installed.tags.renameLabel') : editing ? t('installed.tags.create') : t('installed.filters.tags'),
      placeholder: editing ? t('installed.tags.createPlaceholder') : t('browse.filters.filterPlaceholder'),
      value: query, onChange: changeQuery, inputRef, disabled: busy,
      clearLabel: t('browse.filters.clearSearch'), getEmptyMessage: query => t('browse.filters.noOptionsMatch', { query }),
      filterOptions: !editing, maxLength: editing ? 80 : undefined,
      onSubmit: editing ? saveName : undefined,
      actions: renaming ? <IconButton icon={X} disabled={busy} label={t('common.actions.cancel')} onClick={cancelRename} />
        : <IconButton icon={Pencil} disabled={busy} label={t('installed.tags.edit')} aria-pressed={editing}
          className={editing ? 'border-accent/40! bg-accent/10! text-accent!' : ''}
          onClick={() => { setEditing(value => !value); changeQuery(''); }} />,
      message: error ? <p role="alert" className="mt-2 text-xs text-state-danger">{error}</p> : undefined,
    }}
    renderOption={option => {
      const excludedTag = excluded.includes(option.value);
      const checked = included.includes(option.value) || excludedTag;
      return <span className="flex min-w-0 flex-1 items-center gap-2">
        {!editing && <CheckboxMark variant="menu" checked={checked} tone={excludedTag ? 'danger' : 'success'} icon={excludedTag ? Minus : Plus} />}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {!editing && <span className="shrink-0 text-2xs text-text-secondary">{byKey.get(option.value)?.count ?? 0}</span>}
      </span>;
    }}
    optionActions={editing ? option => byKey.get(option.value)?.custom && <div className="flex shrink-0 items-center gap-1 pr-1">
      <IconButton icon={Pencil} size="sm" disabled={busy} label={t('installed.tags.rename', { name: option.label })}
        onClick={() => { setRenaming(option.value); changeQuery(option.label); }} />
      <IconButton icon={Trash2} size="sm" disabled={busy} tone="danger" label={t('common.actions.delete')}
        className="border-state-danger/40! text-state-danger!"
        onClick={() => { void apply(() => onDelete(option.value)).then(deleted => { if (deleted && renaming === option.value) cancelRename(); }); }} />
    </div> : undefined} />;
}
