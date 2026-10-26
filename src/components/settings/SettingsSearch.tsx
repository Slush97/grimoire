import { useMemo, useRef, type ReactNode } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../common/forms';
import { IconButton } from '../common/ui';
import { searchSettings, settingsSearchEntries, type SettingsSearchEntry } from './settingsSearchIndex';

interface SettingsSearchProps {
  children: ReactNode;
  socialEnabled: boolean;
  modSafetyEnabled: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (entry: SettingsSearchEntry) => void;
}

export default function SettingsSearch({ children, socialEnabled, modSafetyEnabled, query, onQueryChange, onSelect }: SettingsSearchProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchSettings(settingsSearchEntries(t, { socialEnabled, modSafetyEnabled }), query), [t, query, socialEnabled, modSafetyEnabled]);
  const searching = query.trim().length > 0;
  const clear = () => {
    onQueryChange('');
    input.current?.focus();
  };

  return (
    <div className="space-y-6">
      <div className="relative max-w-xl">
        <Input
          ref={input}
          type="search"
          icon={Search}
          value={query}
          placeholder={t('settings.search.placeholder')}
          aria-label={t('settings.search.placeholder')}
          aria-controls={searching ? 'settings-search-results' : undefined}
          className="pr-12 [&::-webkit-search-cancel-button]:appearance-none"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') clear();
            if (event.key === 'ArrowDown' && searching) {
              event.preventDefault();
              document.querySelector<HTMLButtonElement>('#settings-search-results button')?.focus();
            }
            if (event.key === 'Enter' && results[0]) {
              event.preventDefault();
              onSelect(results[0]);
            }
          }}
        />
        {query && <IconButton icon={X} label={t('settings.search.clear')} onClick={clear} className="absolute right-1 top-1/2 -translate-y-1/2 border-transparent" />}
      </div>
      {!searching && children}
      {searching && (
        <div className="max-w-4xl">
          <p role="status" className="mb-3 text-sm text-text-secondary">
            {t('settings.search.results', { count: results.length })}
          </p>
          <ul
            id="settings-search-results"
            aria-label={t('settings.search.resultsLabel')}
            className="divide-y divide-border rounded-sm border border-border bg-bg-secondary/50"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                clear();
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
              const index = buttons.findIndex((button) => button === document.activeElement);
              event.preventDefault();
              if (event.key === 'ArrowUp' && index === 0) input.current?.focus();
              else buttons[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
            }}
          >
            {results.map((entry) => (
              <li key={`${entry.section}-${entry.label}`}>
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="group flex w-full cursor-pointer items-center gap-4 rounded-sm px-4 py-4 text-left hover:bg-hl/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <div className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs text-text-secondary">{entry.category}</span>
                    <span className="block text-sm font-semibold text-text-primary">{entry.label}</span>
                    {entry.description && <span className="mt-1 block text-xs leading-relaxed text-text-secondary">{entry.description}</span>}
                  </div>
                  <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-text-tertiary group-hover:text-text-primary" />
                </button>
              </li>
            ))}
            {!results.length && (
              <li className="px-4 py-8 text-sm text-text-secondary">{t('settings.search.empty')}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
