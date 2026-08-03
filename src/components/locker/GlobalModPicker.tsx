import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpToLine, Check, Search, X } from 'lucide-react';
import type { Mod } from '../../types/mod';
import { Modal } from '../common/Modal';
import { Button } from '../common/ui';

interface GlobalModPickerProps {
  /** Every installed mod. Ones already Global are filtered out here rather than
   *  by the caller, so the list can say so in its empty state. */
  mods: Mod[];
  hideNsfwPreviews: boolean;
  onClose: () => void;
  /** Mark the chosen mods Global. Resolves once every move has been applied. */
  onConfirm: (modIds: string[]) => Promise<void>;
}

/**
 * "Add mods to Global": search installed mods and move the chosen ones into the
 * citadel/grimoire priority root.
 *
 * Lives in its own file rather than inside Locker.tsx: the page is already one
 * of the two god pages, and the chip-away policy is that new surfaces start as
 * their own component.
 *
 * Selection is keyed by mod id. Ids are derived from the pakNN filename and
 * change when a mod moves, but nothing here re-scans between opening and
 * confirming, so the ids stay valid for the life of the dialog. The caller
 * refreshes the list afterwards.
 */
export function GlobalModPicker({ mods, hideNsfwPreviews, onClose, onConfirm }: GlobalModPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Candidates are every installed mod that isn't already Global. Locker-managed
  // artifacts (the cards/sounds/colors VPKs) never appear in the mod list, so
  // there is nothing to exclude for them here.
  const candidates = useMemo(() => mods.filter((m) => !m.priorityMod), [mods]);

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
    // Enabled first, then alphabetical: the mod someone wants to pin is
    // overwhelmingly one they already have on.
    return [...pool].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [candidates, query]);

  const toggle = (modId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  };

  const confirm = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm([...selected]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      size="lg"
      dismissable={!busy}
      labelledBy="global-mod-picker-title"
      panelClassName="flex max-h-[80vh] flex-col"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div className="min-w-0">
          <h2 id="global-mod-picker-title" className="text-base font-semibold text-text-primary">
            {t('locker.globalPicker.title')}
          </h2>
          <p className="mt-1 text-xs text-text-secondary">{t('locker.globalPicker.description')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t('common.actions.close')}
          className="flex-shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-border p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <input
            ref={searchRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('locker.globalPicker.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-bg-input py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-text-secondary">
            {candidates.length === 0
              ? t('locker.globalPicker.allGlobal')
              : t('locker.globalPicker.noMatches')}
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
                    disabled={busy}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
                      isSelected
                        ? 'border-accent bg-accent/10'
                        : 'border-transparent hover:border-white/10 hover:bg-bg-tertiary'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        isSelected ? 'border-accent bg-accent text-accent-foreground' : 'border-white/25'
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="h-9 w-16 flex-shrink-0 overflow-hidden rounded border border-white/[0.08] bg-bg-tertiary">
                      {showArt && (
                        <img src={mod.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} />
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
                        {t('locker.globalPicker.disabled')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <p className="border-t border-border px-4 py-2 text-xs text-state-danger">{error}</p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border p-4">
        <span className="text-xs text-text-secondary">
          {t('locker.globalPicker.selectedCount', { count: selected.size })}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={() => void confirm()} disabled={selected.size === 0 || busy}>
            <ArrowUpToLine className="h-4 w-4" />
            {busy ? t('locker.globalPicker.adding') : t('locker.globalPicker.add')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default GlobalModPicker;
