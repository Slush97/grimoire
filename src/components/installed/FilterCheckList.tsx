/**
 * A labelled block of multi-select checkboxes in the Installed filter popover:
 * a header with an optional Clear, then a scrolling column of rows that
 * union within the block and AND with the other filter axes.
 *
 * Rows are buttons with role="checkbox" rather than real inputs because the
 * whole row is the hit target and the mark is decorative. The role and
 * aria-checked are what make that readable to a screen reader.
 */
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckboxMark } from '../common/ui';

export interface FilterCheckOption {
  key: string;
  label: string;
  count: number;
}

interface FilterCheckListProps {
  /** Translated block heading. */
  label: string;
  options: readonly FilterCheckOption[];
  selected: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** Optional trailing control in the header (the LISTS block's Manage link). */
  action?: ReactNode;
  /** Outer section dividers and spacing are supplied by the surrounding menu. */
  bare?: boolean;
  children?: ReactNode;
}

export function FilterCheckList({
  label,
  options,
  selected,
  onToggle,
  onClear,
  action,
  bare = false,
  children,
}: FilterCheckListProps) {
  const { t } = useTranslation();

  return (
    <div className={bare ? undefined : 'mt-3 border-t border-border pt-3'}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={bare ? 'text-xs font-medium text-text-secondary' : 'text-2xs font-semibold uppercase tracking-wider text-text-secondary'}>
          {label}
        </span>
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className={bare ? 'text-xs text-text-secondary hover:text-accent cursor-pointer' : 'text-2xs text-accent hover:underline cursor-pointer'}
            >
              {t('common.actions.clear')}
            </button>
          )}
          {action}
        </div>
      </div>
      {children}
      <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
        {options.map((option) => {
          const checked = selected.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => onToggle(option.key)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-text-secondary transition-colors hover:bg-hl/5 hover:text-text-primary cursor-pointer"
            >
              <CheckboxMark variant="menu" checked={checked} />
              <span className="flex-1 truncate">{option.label}</span>
              <span className="text-2xs opacity-60">{option.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
