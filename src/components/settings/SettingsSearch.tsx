import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../common/forms';
import { IconButton } from '../common/ui';

interface SettingsSearchProps {
  query: string;
  count: number;
  onQueryChange: (query: string) => void;
}

export default function SettingsSearch({ query, count, onQueryChange }: SettingsSearchProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const clear = () => {
    onQueryChange('');
    input.current?.focus();
  };

  return (
    <div className="mb-5">
      <div className="relative">
        <Input
          ref={input}
          inputSize="sm"
          type="search"
          icon={Search}
          value={query}
          placeholder={t('settings.search.placeholder')}
          aria-label={t('settings.search.placeholder')}
          aria-controls="settings-content"
          className="h-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') clear();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.currentTarget.closest('nav')?.querySelector<HTMLButtonElement>('[data-settings-category]')?.focus();
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              document.querySelector<HTMLElement>('#settings-content input:not(:disabled), #settings-content button:not(:disabled), #settings-content select:not(:disabled)')?.focus();
            }
          }}
        />
        {query && <IconButton icon={X} size="sm" label={t('settings.search.clear')} onClick={clear} className="absolute right-1 top-1/2 -translate-y-1/2 border-transparent" />}
      </div>
      <p role="status" className={query.trim() ? 'mt-2 px-1 text-xs text-text-secondary' : 'sr-only'}>
        {query.trim() ? t('settings.search.results', { count }) : ''}
      </p>
    </div>
  );
}
