import { useEffect, useRef, useState } from 'react';
import { setModPriority } from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { Tag } from './common/ui';

interface Props {
  modId: string;
  modName: string;
  priority: number;
  variant?: 'overlay' | 'inline';
  /** Override the default single-rename commit path. Provided by Installed.tsx
   *  so collisions with same-section mods rebuild the order via reorderMods
   *  (insert-and-shift) instead of throwing "already in use". */
  onCommit?: (newPriority: number) => Promise<void>;
}

/**
 * Click-to-edit Load order badge. Replaces the static Tag with an inline
 * numeric input so users can retype a priority instead of dragging through
 * a long list. Right-click is supported too because some users reach for
 * a context menu first — we suppress the native menu in that case.
 *
 * Enter / blur commit; Escape cancels. Validation mirrors the underlying
 * setModPriority IPC (1-99), and the IPC's "already in use" error surfaces
 * inline so the user can pick another number without leaving the field.
 */
export default function PriorityEditor({
  modId,
  modName,
  priority,
  variant = 'inline',
  onCommit,
}: Props) {
  const loadMods = useAppStore((s) => s.loadMods);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if ('preventDefault' in e) e.preventDefault();
    setDraft(String(priority));
    setEditing(true);
    setError(null);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === '') return cancel();
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > 99) {
      setError('Use 1-99');
      return;
    }
    if (n === priority) return cancel();
    setBusy(true);
    try {
      if (onCommit) {
        await onCommit(n);
      } else {
        await setModPriority(modId, n);
        await loadMods();
      }
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <span
        className="inline-flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-xs font-medium border tabular-nums ${
            variant === 'overlay'
              ? 'bg-bg-secondary/90 border-accent text-text-primary backdrop-blur-sm'
              : 'bg-bg-tertiary border-accent text-text-primary'
          }`}
        >
          <span className="text-text-secondary">#</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
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
            className="w-7 bg-transparent text-text-primary focus:outline-none text-xs tabular-nums"
            aria-label={`Set load order for ${modName}`}
            aria-invalid={!!error}
          />
        </span>
        {error && (
          <span
            className="text-[10px] text-red-300 max-w-[10rem] truncate"
            role="alert"
            title={error}
          >
            {error}
          </span>
        )}
      </span>
    );
  }

  // Rendered as a span+role=button rather than a <button> because this widget
  // sits inside the ModCard's outer "view details" <button>; nesting buttons
  // is invalid HTML and React 19 surfaces it as a hydration warning.
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={startEdit}
      onContextMenu={startEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          startEdit(e);
        }
      }}
      className="inline-flex cursor-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-sm"
      title={`Load #${priority}. Click (or right-click) to retype. Lower numbers load first.`}
      aria-label={`Load order ${priority}. Click to change.`}
    >
      <Tag tone="accent" variant={variant} className="tabular-nums">
        Load #{priority}
      </Tag>
    </span>
  );
}
