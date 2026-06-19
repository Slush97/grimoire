import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Clock, ListTree, X } from 'lucide-react';
import type { GameBananaFile } from '../types/gamebanana';
import { formatDate } from '../types/gamebanana';

const POPOVER_WIDTH = 340;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

// Adaptive size so tiny files don't render as "0.00 MB". KB below 1 MB.
function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export interface BrowseFileQuickPickerProps {
  /** The mod whose files are being chosen. */
  modName: string;
  /** Installable (non-archived) files, in the order the picker should show. */
  files: GameBananaFile[];
  /** The Install button the popover anchors to. */
  anchor: HTMLElement;
  onPick: (file: GameBananaFile) => void;
  onViewAll: () => void;
  onClose: () => void;
}

/**
 * Compact popover anchored to a Browse card's Install button. Lets the user pick
 * which file to install when a mod ships more than one, without opening the full
 * details modal (issue #209). Files arrive pre-filtered to non-archived; the
 * "View all files" link drops to the modal for archived/legacy uploads.
 *
 * Behaves as a keyboard-navigable menu: first item is focused on open, arrow
 * keys move a roving focus across the file rows and the footer, Enter/Space
 * activates, and Escape closes (returning focus to the anchor). The full menu
 * lives at z-[80], the workspace popover layer (see index.css).
 */
export default function BrowseFileQuickPicker({
  modName,
  files,
  anchor,
  onPick,
  onViewAll,
  onClose,
}: BrowseFileQuickPickerProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  // One ref per focusable menu item: every file row followed by the footer.
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Most-downloaded first, so the popular pick lands at the top of the list.
  // Copy first so we never mutate the caller's array.
  const sorted = useMemo(
    () => [...files].sort((a, b) => b.downloadCount - a.downloadCount),
    [files]
  );
  // Footer ("View all files") is the last item in the roving sequence.
  const itemCount = sorted.length + 1;

  // Position below the button by default, flipping above when there isn't room.
  // Measured after render so the flip uses the popover's real height.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
      let left = r.right - width;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - VIEWPORT_MARGIN - width));

      const height = popoverRef.current?.offsetHeight ?? 0;
      const below = r.bottom + ANCHOR_GAP;
      const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
      const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, r.top - ANCHOR_GAP - height);
      setCoords({ top, left, width });
    };
    place();
    // Re-measure once the content has laid out (height known) for the flip.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [anchor, files.length]);

  // Focus the first item on open, and return focus to the anchor on close so
  // keyboard users land back on the Install button they came from.
  useEffect(() => {
    itemRefs.current[0]?.focus();
    return () => anchor.focus();
  }, [anchor]);

  // Dismiss on any scroll/resize so the popover never drifts from its anchor.
  // Outside clicks are caught by the backdrop; Escape/arrow keys live on the
  // menu element itself (roving focus).
  useEffect(() => {
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Roving focus: move the active item, then move DOM focus to match.
  const focusItem = useCallback((index: number) => {
    const clamped = (index + itemCount) % itemCount;
    setActiveIndex(clamped);
    itemRefs.current[clamped]?.focus();
  }, [itemCount]);

  const onMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          focusItem(activeIndex + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusItem(activeIndex - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusItem(0);
          break;
        case 'End':
          e.preventDefault();
          focusItem(itemCount - 1);
          break;
        // Enter/Space activate the focused item natively (real <button>s), so
        // they need no special handling here.
        default:
          break;
      }
    },
    [activeIndex, focusItem, itemCount, onClose]
  );

  return createPortal(
    <>
      {/* Transparent catcher so a click anywhere outside dismisses the picker
          without also activating whatever card sits underneath. */}
      <div className="fixed inset-0 z-[80]" onClick={onClose} aria-hidden="true" />
      <div
      ref={popoverRef}
      role="menu"
      aria-label={t('browse.filePicker.title', { name: modName })}
      onKeyDown={onMenuKeyDown}
      className="fixed z-[80] overflow-hidden rounded-lg border border-border bg-bg-primary shadow-2xl animate-fade-in"
      style={{
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        width: coords?.width ?? POPOVER_WIDTH,
        visibility: coords ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {t('browse.filePicker.heading')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.actions.close')}
          className="-mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary focus:bg-bg-secondary focus:text-text-primary focus:outline-none"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[min(60vh,360px)] overflow-y-auto py-1">
        {sorted.map((file, index) => (
          <button
            key={file.id}
            ref={(el) => { itemRefs.current[index] = el; }}
            type="button"
            role="menuitem"
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={() => onPick(file)}
            className="group flex w-full px-3 py-2 text-left transition-colors hover:bg-accent/10 focus:bg-accent/10 focus:outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block min-w-0 truncate text-sm font-medium text-text-primary" title={file.description?.trim() || file.fileName}>
                {file.description?.trim() || file.fileName}
              </span>
              {file.description?.trim() && (
                <span className="mt-0.5 block truncate text-xs text-text-secondary/90" title={file.fileName}>
                  {file.fileName}
                </span>
              )}
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
                <span className="whitespace-nowrap">{formatFileSize(file.fileSize)}</span>
                <span className="opacity-50" aria-hidden>·</span>
                <span className="whitespace-nowrap">
                  {t('browse.filePicker.downloads', { count: file.downloadCount })}
                </span>
                {file.dateAdded && file.dateAdded > 0 && (
                  <>
                    <span className="opacity-50" aria-hidden>·</span>
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <Clock className="h-3 w-3" />
                      {formatDate(file.dateAdded)}
                    </span>
                  </>
                )}
              </span>
            </span>
          </button>
        ))}
      </div>
      <button
        ref={(el) => { itemRefs.current[sorted.length] = el; }}
        type="button"
        role="menuitem"
        tabIndex={activeIndex === sorted.length ? 0 : -1}
        onClick={onViewAll}
        className="flex w-full items-center gap-2 border-t border-border/70 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary focus:bg-bg-secondary focus:text-text-primary focus:outline-none"
      >
        <ListTree className="h-4 w-4" />
        {t('browse.filePicker.viewAll')}
      </button>
      </div>
    </>,
    document.body
  );
}
