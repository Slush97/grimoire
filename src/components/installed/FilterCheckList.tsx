/**
 * A labelled block of multi-select checkboxes in the Installed sort/filter
 * popover. Shared by TAGS and LISTS, which are the same control over different
 * data: a header with an optional Clear, then a scrolling column of rows that
 * union within the block and AND with the other filter axes.
 *
 * Rows are buttons with role="checkbox" rather than real inputs because the
 * whole row is the hit target and the mark is decorative. The role and
 * aria-checked are what make that readable to a screen reader.
 */
import { type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface FilterCheckOption {
  key: string;
  label: string;
  count: number;
}

interface FilterCheckListProps {
  /** Block heading, already uppercased by the caller's translation. */
  label: string;
  options: readonly FilterCheckOption[];
  selected: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** Optional trailing control in the header (the LISTS block's Manage link). */
  action?: ReactNode;
}

export function FilterCheckList({
  label,
  options,
  selected,
  onToggle,
  onClear,
  action,
}: FilterCheckListProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] text-accent hover:underline cursor-pointer"
            >
              {t('common.actions.clear')}
            </button>
          )}
          {action}
        </div>
      </div>
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
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary cursor-pointer"
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                  checked ? 'border-accent bg-accent text-accent-foreground' : 'border-border'
                }`}
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1 truncate">{option.label}</span>
              <span className="text-[11px] opacity-60">{option.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
