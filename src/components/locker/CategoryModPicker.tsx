import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FolderPlus, Search, X } from 'lucide-react';
import type { Mod } from '../../types/mod';
import { modPreferenceKey } from '../../lib/disabledModPrefs';
import { Modal } from '../common/Modal';
import { Button } from '../common/ui';

interface CategoryModPickerProps {
  /** Every installed mod. Ones already filed here are filtered out below rather
   *  than by the caller, so the list can say so in its empty state. */
  mods: Mod[];
  /** Display name of the category being filled. */
  categoryName: string;
  /** modPreferenceKey values already in the category. */
  memberKeys: ReadonlySet<string>;
  hideNsfwPreviews: boolean;
  onClose: () => void;
  /** File the chosen mods. Synchronous: membership is localStorage, not IPC. */
  onConfirm: (modIds: string[]) => void;
}

/**
 * "Add mods to <category>": search installed mods and file the chosen ones into
 * one user-defined Locker category.
 *
 * Cloned from GlobalModPicker, minus its busy/error plumbing: that picker moves
 * VPKs through the main process, while filing a mod here only writes a
 * localStorage bucket and can neither fail nor take time. Membership is purely
 * a view grouping: nothing here enables, disables, moves, or reorders a mod.
 *
 * Selection is keyed by mod id. Ids are derived from the pakNN filename and
 * change when a mod moves, so the dialog works off the part of the selection
 * that still resolves rather than filing a key nothing points at. That set
 * drives the footer count and the Add button as well as confirm, so the button
 * goes disabled instead of turning into a dead click.
 */
export function CategoryModPicker({
  mods,
  categoryName,
  memberKeys,
  hideNsfwPreviews,
  onClose,
  onConfirm,
}: CategoryModPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  // Candidates are every installed mod not already in this category. Membership
  // is by preference key, so a GameBanana group and its singletons resolve to
  // one entry and disappear together once filed.
  const candidates = useMemo(
    () => mods.filter((mod) => !memberKeys.has(modPreferenceKey(mod))),
    [mods, memberKeys]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? candidates.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.fileName.toLowerCase().includes(q) ||
            m.lockerHero?.toLowerCase().includes(q) ||
            m.categoryName?.toLowerCase().includes(q)
        )
      : candidates;
    // Enabled first, then alphabetical: the mod someone wants to file is
    // overwhelmingly one they already have on.
    return [...pool].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [candidates, query]);

  // The part of the selection that still resolves. A reload behind the dialog
  // (a finished download, a toggle) retires pakNN-derived ids, so a selection
  // can go stale while it is on screen. Derived at render rather than pruned
  // into state by an effect, so the footer count, the Add button and confirm
  // all read one value and the button can never sit enabled over nothing.
  const resolvableSelected = useMemo(() => {
    const candidateIds = new Set(candidates.map((mod) => mod.id));
    return [...selected].filter((id) => candidateIds.has(id));
  }, [candidates, selected]);

  const toggle = (modId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  };

  const confirm = () => {
    if (resolvableSelected.length === 0) return;
    onConfirm(resolvableSelected);
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      size="lg"
      labelledBy="category-mod-picker-title"
      panelClassName="flex max-h-[80vh] flex-col"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div className="min-w-0">
          <h2 id="category-mod-picker-title" className="text-base font-semibold text-text-primary">
            {t('locker.categories.pickerTitle', { name: categoryName })}
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            {t('locker.categories.pickerDescription')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.actions.close')}
          className="flex-shrink-0 rounded-sm p-1 text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-border p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('locker.categories.searchPlaceholder')}
            className="w-full rounded-sm border border-border bg-bg-input py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-text-secondary">
            {candidates.length === 0
              ? t('locker.categories.allFiled')
              : t('locker.categories.noMatches')}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((mod) => {
              const isSelected = selected.has(mod.id);
              const showArt = mod.thumbnailUrl && !(mod.nsfw && hideNsfwPreviews);
              return (
                <li key={mod.id}>
                  <button
                    type="button"
                    onClick={() => toggle(mod.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 rounded-sm border px-2.5 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      isSelected
                        ? 'border-accent bg-accent/10'
                        : 'border-transparent hover:border-white/10 hover:bg-bg-tertiary'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border ${
                        isSelected
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-white/25'
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="h-9 w-16 flex-shrink-0 overflow-hidden rounded-sm border border-white/[0.08] bg-bg-tertiary">
                      {showArt && (
                        <img
                          src={mod.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text-primary">{mod.name}</span>
                      <span className="block truncate text-xs text-text-secondary">
                        {mod.lockerHero ?? mod.categoryName ?? mod.fileName}
                      </span>
                    </span>
                    {!mod.enabled && (
                      <span className="flex-shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
                        {t('locker.categories.disabled')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border p-4">
        <span className="text-xs text-text-secondary">
          {t('locker.categories.selectedCount', { count: resolvableSelected.length })}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={confirm} disabled={resolvableSelected.length === 0}>
            <FolderPlus className="h-4 w-4" />
            {t('locker.categories.add')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default CategoryModPicker;
