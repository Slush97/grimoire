import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Input } from './common/forms';
import { Tag } from './common/ui';

interface Props {
  modName: string;
  /** The number shown on the chip and seeded into the editor: the mod's
   *  1-based global load-order position (1 = loads first). */
  value: number;
  /** Highest selectable position (the count of enabled mods). The editor
   *  rejects anything outside 1..max. */
  max: number;
  variant?: 'overlay' | 'inline';
  /** Commit a new load-order position. Installed.tsx repositions the mod in the
   *  global enabled order and reorders the pakNN slots on disk to match. */
  onCommit?: (newPosition: number) => Promise<void>;
}

/**
 * Click-to-edit load order chip. Opens a small popover so users can retype a
 * position instead of dragging through a long list. Right-click is supported
 * too because some users reach for a context menu first (we suppress the native
 * menu in that case).
 *
 * The number is the mod's global load-order position (1 = loads first). Enter /
 * blur commit; Escape cancels. Valid range is 1..max (the enabled-mod count);
 * onCommit repositions the mod and reorders the pakNN slots on disk to match.
 */
export default function PriorityEditor({
  modName,
  value,
  max,
  variant = 'inline',
  onCommit,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chipRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if ('preventDefault' in e) e.preventDefault();
    setDraft(String(value));
    setEditing(true);
    setError(null);
    const rect = chipRef.current?.getBoundingClientRect();
    if (rect) {
      setPopoverPos({
        top: rect.bottom + 6,
        left: Math.min(Math.max(rect.left, 8), window.innerWidth - 168),
      });
    }
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setPopoverPos(null);
  };

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === '') return cancel();
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > max) {
      setError(t('installed.priorityEditor.rangeError', { max }));
      return;
    }
    if (n === value) return cancel();
    if (!onCommit) return cancel();
    setBusy(true);
    try {
      await onCommit(n);
      setEditing(false);
      setError(null);
      setPopoverPos(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    // Fall through so the chip stays stable while the popover is open.
  }

  // Rendered as a span+role=button rather than a <button> because this widget
  // sits inside the ModCard's outer "view details" <button>; nesting buttons
  // is invalid HTML and React 19 surfaces it as a hydration warning.
  return (
    <span
      role="button"
      ref={chipRef}
      tabIndex={0}
      onClick={startEdit}
      onContextMenu={startEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          startEdit(e);
        }
      }}
      className="group/order-chip relative inline-flex cursor-pointer items-center justify-center rounded-sm focus:outline-none before:absolute before:-inset-1"
      aria-label={t('installed.priorityEditor.chipAriaLabel', { value })}
    >
      <Tag
        // The visible chip deliberately uses the same geometry, neutral tone,
        // and image-safe overlay surface as the card's 18+ and state tags. The
        // parent's pseudo-element keeps the larger click target without adding
        // layout height (the old 28px wrapper pushed this tag below its peers).
        variant={variant}
        className="min-w-[28px] justify-center tabular-nums transition-colors duration-150 group-hover/order-chip:border-white/35 group-hover/order-chip:text-text-primary group-focus-visible/order-chip:outline group-focus-visible/order-chip:outline-2 group-focus-visible/order-chip:outline-white/40"
      >
        #{value}
      </Tag>
      {!editing && (
        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-bg-primary/95 px-2 py-1 text-[11px] font-medium text-text-secondary opacity-0 shadow-lg transition-opacity duration-150 group-hover/order-chip:opacity-100 group-focus-visible/order-chip:opacity-100">
          {t('installed.priorityEditor.loadOrder')}
        </span>
      )}
      {editing && popoverPos && createPortal(
        <div
          className="fixed z-[80] w-40 rounded-lg border border-border bg-bg-secondary p-2.5 text-left shadow-xl"
          style={{ top: popoverPos.top, left: popoverPos.left }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="mb-2 block text-xs font-semibold text-text-primary">{t('installed.priorityEditor.loadOrder')}</span>
          <span className="inline-flex h-9 w-full items-center rounded-md border border-border bg-bg-tertiary px-2.5 text-sm text-text-primary transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
            <span className="mr-1 text-text-secondary">#</span>
            <Input
              ref={inputRef}
              inputMode="numeric"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
              }}
              onBlur={() => {
                if (!busy) void commit();
              }}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 tabular-nums focus-visible:ring-0"
              aria-label={t('installed.priorityEditor.inputAriaLabel', { modName })}
              aria-invalid={!!error}
            />
          </span>
          <span className="mt-2 block text-[11px] leading-4 text-text-secondary">
            {t('installed.priorityEditor.lowerNumbersLoadFirst')}
          </span>
          {error && (
            <span className="mt-1 block max-w-full truncate text-[10px] text-red-300" role="alert">
              {error}
            </span>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}
