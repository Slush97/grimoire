import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';

export interface HeroSelectOption {
  value: string;
  label: string;
  heroName?: string;
  muted?: boolean;
}

interface HeroSelectProps {
  value: string;
  options: HeroSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
}

const LISTBOX_GAP = 4;
const VIEWPORT_PADDING = 8;
const MAX_LISTBOX_HEIGHT = 288;
/** Below this much room underneath the trigger, flipping up beats scrolling. */
const MIN_DOWNWARD_SPACE = 160;

function HeroIcon({ heroName }: { heroName?: string }) {
  if (!heroName) return null;

  return (
    <img
      src={getHeroChipIconPath(heroName)}
      alt=""
      aria-hidden="true"
      className="h-5 w-5 flex-shrink-0 object-contain"
      loading="lazy"
    />
  );
}

export function HeroSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select hero',
  className = '',
  size = 'md',
}: HeroSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );
  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => option.value === value)),
    [options, value]
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The listbox is portaled to <body>, so it is not inside rootRef any
      // more: without checking it too, clicking an option would read as an
      // outside click and close the menu before the option could fire.
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  /**
   * Measure the trigger and write the listbox's fixed position straight to the
   * node. Imperative on purpose: holding the rect in state would re-render the
   * whole select on every scroll tick, and the position is display-only.
   */
  const positionListbox = useCallback(() => {
    const button = buttonRef.current;
    const listbox = listRef.current;
    if (!button || !listbox) return;

    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - LISTBOX_GAP - VIEWPORT_PADDING;
    const spaceAbove = rect.top - LISTBOX_GAP - VIEWPORT_PADDING;
    const flipUp = spaceBelow < MIN_DOWNWARD_SPACE && spaceAbove > spaceBelow;

    listbox.style.left = `${rect.left}px`;
    listbox.style.width = `${rect.width}px`;
    if (flipUp) {
      listbox.style.top = 'auto';
      listbox.style.bottom = `${window.innerHeight - rect.top + LISTBOX_GAP}px`;
    } else {
      listbox.style.bottom = 'auto';
      listbox.style.top = `${rect.bottom + LISTBOX_GAP}px`;
    }
    const available = Math.max(0, flipUp ? spaceAbove : spaceBelow);
    listbox.style.maxHeight = `${Math.min(available, MAX_LISTBOX_HEIGHT)}px`;
  }, []);

  /**
   * The listbox renders in a portal rather than as an absolutely-positioned
   * child, so no ancestor's `overflow` can clip it (the Installed sort/filter
   * popover scrolls, and an in-flow listbox was cut off at its edge). The cost
   * of leaving the trigger's containing block is that position has to be
   * measured and kept in sync with anything that can move the trigger.
   *
   * Layout effect, not a plain effect: this runs after the portal is in the DOM
   * but before paint, so the listbox is never visible at an unpositioned spot.
   */
  useLayoutEffect(() => {
    if (!open) return;
    positionListbox();
    // Capture phase so scrolling any ancestor (not just the window) is caught.
    window.addEventListener('scroll', positionListbox, true);
    window.addEventListener('resize', positionListbox);
    return () => {
      window.removeEventListener('scroll', positionListbox, true);
      window.removeEventListener('resize', positionListbox);
    };
  }, [open, positionListbox]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      const focusIndex = pendingFocusIndexRef.current ?? selectedIndex;
      pendingFocusIndexRef.current = null;
      if (options.length === 0) return;
      const nextIndex = (focusIndex + options.length) % options.length;
      optionRefs.current[nextIndex]?.focus();
    });
  }, [open, selectedIndex, options.length]);

  useEffect(() => {
    return () => {
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
    };
  }, []);

  const selectOption = (optionValue: string) => {
    onChange(optionValue);
    setOpen(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const nextIndex = (index + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const scheduleTypeaheadReset = () => {
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current);
    }
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = '';
      typeaheadTimerRef.current = null;
    }, 750);
  };

  const findOptionByPrefix = (query: string) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return -1;
    return options.findIndex((option) => option.label.toLowerCase().startsWith(normalized));
  };

  const isTypeaheadKey = (event: React.KeyboardEvent) =>
    event.key.length === 1 && event.key !== ' ' && !event.altKey && !event.ctrlKey && !event.metaKey;

  const handleTypeaheadKey = (event: React.KeyboardEvent) => {
    event.preventDefault();
    const key = event.key.toLowerCase();
    let query = `${typeaheadRef.current}${key}`;
    let nextIndex = findOptionByPrefix(query);

    if (nextIndex === -1 && typeaheadRef.current) {
      query = key;
      nextIndex = findOptionByPrefix(query);
    }

    typeaheadRef.current = query;
    scheduleTypeaheadReset();

    if (nextIndex !== -1) {
      if (open) {
        pendingFocusIndexRef.current = null;
        focusOption(nextIndex);
      } else {
        pendingFocusIndexRef.current = nextIndex;
        setOpen(true);
        window.requestAnimationFrame(() => focusOption(nextIndex));
      }
    } else {
      pendingFocusIndexRef.current = null;
    }
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isTypeaheadKey(event)) {
      handleTypeaheadKey(event);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      window.requestAnimationFrame(() => {
        optionRefs.current[selectedIndex]?.focus();
      });
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, optionValue: string, index: number) => {
    if (isTypeaheadKey(event)) {
      handleTypeaheadKey(event);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusOption(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusOption(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusOption(0);
        break;
      case 'End':
        event.preventDefault();
        focusOption(options.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectOption(optionValue);
        break;
    }
  };

  const heightClass = size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={handleButtonKeyDown}
        className={`w-full ${heightClass} px-2.5 bg-bg-tertiary border border-border rounded-md text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:border-accent/60 cursor-pointer flex items-center gap-2`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <HeroIcon heroName={selected?.heroName} />
          <span className={`min-w-0 flex-1 text-left truncate ${selected?.muted ? 'text-text-secondary' : ''}`}>
            {selected?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          // The listbox is portaled outside any popover containing HeroSelect.
          // Keep its mouse gesture inside this logical boundary so an ancestor's
          // window-level outside-click listener cannot unmount us before click.
          onMouseDown={(event) => event.stopPropagation()}
          // z-80 is the context-menu/popover rung of the ladder in index.css:
          // portaled to <body>, this has to clear modals and page chrome alike.
          // Positioned by positionListbox before paint; the inline top/left are
          // only a starting point so the node has a box to measure against.
          className="fixed z-[80] overflow-y-auto overscroll-contain rounded-md border border-border bg-bg-secondary shadow-xl py-1"
          style={{ top: 0, left: 0 }}
        >
          {options.map((option, index) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  selectOption(option.value);
                }}
                onKeyDown={(event) => handleOptionKeyDown(event, option.value, index)}
                className={`w-full h-8 px-2.5 flex items-center gap-2 text-left text-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/80 ${
                  active
                    ? 'bg-accent text-bg-primary'
                    : option.muted
                      ? 'text-text-secondary hover:bg-bg-tertiary'
                      : 'text-text-primary hover:bg-bg-tertiary'
                }`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <HeroIcon heroName={option.heroName} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
