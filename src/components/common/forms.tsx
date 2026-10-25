import {
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type InputHTMLAttributes,
    type ReactElement,
    type ReactNode,
    type Ref,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, type LucideIcon } from 'lucide-react';

// ============================================================================
// Form primitives - the single styled surface for text inputs, textareas and
// native/custom selects, plus a FormField wrapper that wires a label + helper/error
// text to its control for accessibility.
//
// Before this file, every page/modal hand-rolled `<input className="...">` and
// the styles drifted (rounded-sm vs rounded-lg, different placeholder colors,
// stray transitions). Reach for these instead of raw form elements. HeroSelect
// adds hero icons to DropdownSelect; DynamicSelect sizes a native select.
//
// Canonical control surface (see docs/ui-conventions.md):
//   bg-bg-tertiary border border-hl/5 rounded-sm
//   focus-visible:ring-2 focus-visible:ring-accent
//   disabled:opacity-60 disabled:cursor-not-allowed
// ============================================================================

type ControlSize = 'sm' | 'md';

const CONTROL_BASE =
    'w-full bg-bg-tertiary border border-hl/5 rounded-sm text-text-primary text-sm ' +
    'placeholder:text-text-secondary/50 transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
    'disabled:opacity-60 disabled:cursor-not-allowed';

const CONTROL_SIZE: Record<ControlSize, string> = {
    sm: 'px-3 py-1.5',
    md: 'px-4 py-2.5',
};

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

// `size` is a native (numeric) input attribute, so the UI size prop is named
// `inputSize` to avoid clobbering it.
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    inputSize?: ControlSize;
    /** Optional leading icon rendered inside the field. */
    icon?: LucideIcon;
    ref?: Ref<HTMLInputElement>;
}

export function Input({ inputSize = 'md', icon: Icon, className = '', ref, ...props }: InputProps) {
    const sizeCls = CONTROL_SIZE[inputSize];
    const control = (
        <input ref={ref} className={`${CONTROL_BASE} ${sizeCls} ${Icon ? 'pl-10' : ''} ${className}`} {...props} />
    );
    if (!Icon) return control;
    return (
        <div className="relative">
            <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden />
            {control}
        </div>
    );
}

// ----------------------------------------------------------------------------
// Textarea
// ----------------------------------------------------------------------------

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    inputSize?: ControlSize;
    ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ inputSize = 'md', className = '', ref, ...props }: TextareaProps) {
    return (
        <textarea ref={ref} className={`${CONTROL_BASE} ${CONTROL_SIZE[inputSize]} resize-y ${className}`} {...props} />
    );
}

// ----------------------------------------------------------------------------
// Select - generic native select styled to match. Pass <option>s as children.
// DropdownSelect below provides a custom option menu with optional search.
// ----------------------------------------------------------------------------

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    inputSize?: ControlSize;
    ref?: Ref<HTMLSelectElement>;
}

export function Select({ inputSize = 'md', className = '', children, ref, ...props }: SelectProps) {
    return (
        <div className="relative">
            <select
                ref={ref}
                className={`${CONTROL_BASE} ${CONTROL_SIZE[inputSize]} cursor-pointer appearance-none pr-10 ${className}`}
                {...props}
            >
                {children}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden />
        </div>
    );
}

// ----------------------------------------------------------------------------
// DropdownSelect - shared custom option menu, with optional icons and search.
// ----------------------------------------------------------------------------

export interface DropdownSelectOption {
    value: string;
    label: string;
    icon?: ReactNode;
    muted?: boolean;
}

export interface DropdownSelectSearchConfig {
    ariaLabel: string;
    placeholder: string;
    getEmptyMessage: (query: string) => string;
    clearLabel: string;
}

export interface DropdownSelectProps {
    value: string;
    options: readonly DropdownSelectOption[];
    onChange: (value: string) => void;
    ariaLabel: string;
    placeholder?: string;
    className?: string;
    size?: 'sm' | 'md';
    search?: DropdownSelectSearchConfig;
    disabled?: boolean;
}

const LISTBOX_GAP = 4;
const VIEWPORT_PADDING = 8;
const MAX_LISTBOX_HEIGHT = 288;
/** Below this much room underneath the trigger, flipping up beats scrolling. */
const MIN_DOWNWARD_SPACE = 160;

export function DropdownSelect({
    value,
    options,
    onChange,
    ariaLabel,
    placeholder = ariaLabel,
    className = '',
    size = 'md',
    search,
    disabled = false,
}: DropdownSelectProps) {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const rootRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const typeaheadRef = useRef('');
    const typeaheadTimerRef = useRef<number | null>(null);
    const pendingFocusIndexRef = useRef<number | null>(null);
    const selected = useMemo(
        () => options.find((option) => option.value === value),
        [options, value]
    );
    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
    const visibleOptions = useMemo(() => {
        if (!search || !normalizedSearchQuery) return options;

        return options.filter((option) =>
            option.label.toLocaleLowerCase().includes(normalizedSearchQuery)
        );
    }, [normalizedSearchQuery, options, search]);
    const selectedIndex = useMemo(
        () => Math.max(0, visibleOptions.findIndex((option) => option.value === value)),
        [value, visibleOptions]
    );
    const searchEnabled = search !== undefined;
    const closeSelect = useCallback(() => {
        setOpen(false);
        setSearchQuery('');
    }, []);
    if (disabled && open) {
        setOpen(false);
        setSearchQuery('');
    }

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            // The listbox is portaled to <body>, so it is not inside rootRef any
            // more: without checking it too, clicking an option would read as an
            // outside click and close the menu before the option could fire.
            if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
                closeSelect();
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [closeSelect, open]);

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
            if (searchEnabled) {
                searchInputRef.current?.focus();
                return;
            }
            const focusIndex = pendingFocusIndexRef.current ?? selectedIndex;
            pendingFocusIndexRef.current = null;
            if (visibleOptions.length === 0) return;
            const nextIndex = (focusIndex + visibleOptions.length) % visibleOptions.length;
            optionRefs.current[nextIndex]?.focus();
        });
    }, [open, searchEnabled, selectedIndex, visibleOptions.length]);

    useEffect(() => {
        return () => {
            if (typeaheadTimerRef.current !== null) {
                window.clearTimeout(typeaheadTimerRef.current);
            }
        };
    }, []);

    const selectOption = (optionValue: string) => {
        onChange(optionValue);
        closeSelect();
        window.requestAnimationFrame(() => buttonRef.current?.focus());
    };

    const focusOption = (index: number) => {
        if (visibleOptions.length === 0) return;
        const nextIndex = (index + visibleOptions.length) % visibleOptions.length;
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
            if (searchEnabled) {
                event.preventDefault();
                setSearchQuery(event.key);
                setOpen(true);
                return;
            }
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
            if (searchEnabled) {
                event.preventDefault();
                setSearchQuery((current) => `${current}${event.key}`);
                window.requestAnimationFrame(() => searchInputRef.current?.focus());
                return;
            }
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
                focusOption(visibleOptions.length - 1);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                selectOption(optionValue);
                break;
        }
    };

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                focusOption(0);
                break;
            case 'ArrowUp':
                event.preventDefault();
                focusOption(visibleOptions.length - 1);
                break;
        }
    };

    /**
     * Escape is handled once, at the portal root, rather than per control.
     *
     * Two reasons. Focus can sit on things with no key handler of their own (the
     * clear-search button, the empty-state button), and those used to leak the
     * key. More importantly the native keydown must stop here: an ancestor
     * popover dismisses on a window-level Escape listener (see AnchoredPopover),
     * so a key that only closed this listbox was collapsing the whole filter
     * panel with it.
     */
    const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        closeSelect();
        buttonRef.current?.focus();
    };

    const clearSearch = () => {
        setSearchQuery('');
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
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
                disabled={disabled}
                onClick={() => {
                    if (open) closeSelect();
                    else setOpen(true);
                }}
                onKeyDown={handleButtonKeyDown}
                className={`w-full ${heightClass} px-2.5 bg-bg-tertiary border border-border rounded-md text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:border-accent/60 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border flex items-center gap-2`}
            >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                    {selected?.icon}
                    <span className={`min-w-0 flex-1 text-left truncate ${selected?.muted ? 'text-text-secondary' : ''}`}>
                        {selected?.label ?? placeholder}
                    </span>
                </span>
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
            </button>

            {open && createPortal(
                <div
                    ref={listRef}
                    // The listbox is portaled outside any popover containing this select.
                    // Keep its mouse gesture inside this logical boundary so an ancestor's
                    // window-level outside-click listener cannot unmount us before click.
                    onMouseDown={(event) => event.stopPropagation()}
                    onKeyDown={handleListboxKeyDown}
                    // z-80 is the context-menu/popover rung of the ladder in index.css:
                    // portaled to <body>, this has to clear modals and page chrome alike.
                    // Positioned by positionListbox before paint; the inline top/left are
                    // only a starting point so the node has a box to measure against.
                    className="fixed z-[80] flex flex-col overflow-hidden rounded-md border border-border bg-bg-secondary shadow-xl"
                    style={{ top: 0, left: 0 }}
                >
                    {search && (
                        <div className="border-b border-border p-2">
                            <div className="relative">
                                <Search
                                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
                                    aria-hidden="true"
                                />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    role="searchbox"
                                    aria-label={search.ariaLabel}
                                    placeholder={search.placeholder}
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    onKeyDown={handleSearchKeyDown}
                                    className="h-8 w-full rounded-md border border-border bg-bg-tertiary pl-8 pr-8 text-xs text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/40"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        aria-label={search.clearLabel}
                                        title={search.clearLabel}
                                        onClick={clearSearch}
                                        className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-text-tertiary hover:bg-hl/10 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    <div
                        role="listbox"
                        aria-label={ariaLabel}
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
                    >
                        {visibleOptions.map((option, index) => {
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
                                        {option.icon}
                                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                    </span>
                                </button>
                            );
                        })}

                        {search && normalizedSearchQuery && visibleOptions.length === 0 && (
                            <div className="px-4 py-5 text-center" aria-live="polite">
                                <p className="text-xs leading-5 text-text-secondary">
                                    {search.getEmptyMessage(searchQuery.trim())}
                                </p>
                                <button
                                    type="button"
                                    onClick={clearSearch}
                                    className="mt-2 cursor-pointer text-xs font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    {search.clearLabel}
                                </button>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

// ----------------------------------------------------------------------------
// FormField - label + control + optional hint/error, wired for a11y.
//
// Generates an id with useId() and injects it (plus aria-describedby /
// aria-invalid) into the single control child via cloneElement, so callers
// don't have to thread ids by hand:
//
//   <FormField label="Profile name" error={err}>
//     <Input value={name} onChange={...} />
//   </FormField>
// ----------------------------------------------------------------------------

interface FormFieldProps {
    label?: ReactNode;
    /** Sub-label helper text shown below the control. */
    hint?: ReactNode;
    /** Error message; when set it replaces the hint and flags the control invalid. */
    error?: ReactNode;
    required?: boolean;
    className?: string;
    children: ReactNode;
}

export function FormField({ label, hint, error, required, className = '', children }: FormFieldProps) {
    const id = useId();
    const describedById = `${id}-desc`;
    const hasDesc = !!(error || hint);

    const control = isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
              id,
              'aria-invalid': error ? true : undefined,
              'aria-describedby': hasDesc ? describedById : undefined,
          })
        : children;

    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            {label && (
                <label htmlFor={id} className="text-sm font-medium text-text-secondary">
                    {label}
                    {required && <span className="ml-0.5 text-state-danger" aria-hidden>*</span>}
                </label>
            )}
            {control}
            {hasDesc && (
                <p id={describedById} className={`text-xs ${error ? 'text-state-danger' : 'text-text-secondary'}`}>
                    {error ?? hint}
                </p>
            )}
        </div>
    );
}
