import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Search } from 'lucide-react';
import { Card } from '../common/ui';
import { Input } from '../common/forms';
import { EmptyState } from '../common/PageComponents';
import Tx from '../translation/Tx';
import { COMMAND_PRESETS, PRESET_COMMAND_COUNT } from './commandPresets';

interface CommandLibraryProps {
  isAdded: (command: string) => boolean;
  onAdd: (command: string) => void;
}

/**
 * The browsable preset catalog.
 *
 * This used to hide behind a collapsed "Premade Commands" accordion while the
 * command list next to it said "select from presets on the left", so the one
 * thing a new user was told to do was invisible. It is now the left column's
 * whole job: always open, always searchable, one scroll.
 *
 * Each row also shows what the command actually does. The description used to
 * live only in a `title` tooltip, which is invisible on touch, unreadable for
 * screen readers browsing by control, and needs a hover-and-wait per row.
 */
export default function CommandLibrary({ isAdded, onAdd }: CommandLibraryProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return COMMAND_PRESETS;
    return COMMAND_PRESETS.map((category) => ({
      ...category,
      commands: category.commands.filter(
        (cmd) =>
          t(cmd.nameKey).toLowerCase().includes(query) ||
          cmd.command.toLowerCase().includes(query) ||
          t(cmd.descriptionKey).toLowerCase().includes(query)
      ),
    })).filter((category) => category.commands.length > 0);
  }, [searchTerm, t]);

  const shown = filtered.reduce((n, c) => n + c.commands.length, 0);

  return (
    <Card
      className="flex h-full min-h-0 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col gap-3 p-4"
      title={<Tx k="autoexec.presets.title" fallback="Premade Commands" />}
      description={
        <Tx k="autoexec.presets.description" fallback="Pick a tuned command and add it to your list" />
      }
      action={
        <span className="font-mono text-xs text-text-secondary">
          {t('autoexec.presets.countLabel', { shown, total: PRESET_COMMAND_COUNT })}
        </span>
      }
    >
      <Input
        icon={Search}
        inputSize="sm"
        type="search"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={t('autoexec.search.placeholder')}
        aria-label={t('autoexec.search.placeholder')}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={<Tx k="autoexec.presets.noResults" fallback="No commands match your search" />}
          description={<Tx k="autoexec.presets.noResultsHint" fallback="Try a shorter or different term." />}
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
          {filtered.map((category) => {
            const CategoryIcon = category.icon;
            return (
              <section key={category.categoryKey}>
                {/* Sticky so you always know which group you are scrolling
                    through in a long filtered list. */}
                <h3 className="sticky top-0 z-10 mb-1.5 flex items-center gap-2 bg-bg-secondary/95 py-1 text-xs font-semibold uppercase tracking-wider text-text-secondary backdrop-blur-sm">
                  <CategoryIcon className="h-3.5 w-3.5 text-accent-ink" aria-hidden />
                  <Tx k={category.categoryKey} fallback={category.categoryFallback} />
                </h3>

                <ul className="space-y-1">
                  {category.commands.map((cmd) => {
                    const added = isAdded(cmd.command);
                    return (
                      <li key={cmd.command}>
                        <button
                          type="button"
                          onClick={() => onAdd(cmd.command)}
                          disabled={added}
                          aria-label={
                            added
                              ? t('autoexec.presets.addedLabel', { name: t(cmd.nameKey) })
                              : t('autoexec.presets.addLabel', { name: t(cmd.nameKey) })
                          }
                          className={`group flex w-full items-start gap-3 rounded-sm border p-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            added
                              ? 'cursor-default border-accent/20 bg-accent/5'
                              : 'cursor-pointer border-hl/5 bg-bg-tertiary/40 hover:border-accent/30 hover:bg-bg-tertiary'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span
                                className={`truncate text-sm font-medium ${added ? 'text-accent-ink' : 'text-text-primary'}`}
                              >
                                <Tx k={cmd.nameKey} fallback={cmd.nameFallback} />
                              </span>
                            </span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
                              <Tx k={cmd.descriptionKey} fallback={cmd.descriptionFallback} />
                            </span>
                            <code className="mt-1.5 inline-block max-w-full truncate rounded-sm bg-bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-text-primary/70">
                              {cmd.command}
                            </code>
                          </span>

                          <span
                            aria-hidden
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                              added
                                ? 'border-accent/30 text-accent-ink'
                                : 'border-hl/10 text-text-secondary group-hover:border-accent/50 group-hover:text-accent-ink'
                            }`}
                          >
                            {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
