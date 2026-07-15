import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X, type LucideIcon } from 'lucide-react';
import Tx from '../translation/Tx';

interface CardProps {
    children?: ReactNode;
    className?: string;
    contentClassName?: string;
    title?: ReactNode;
    icon?: LucideIcon;
    description?: ReactNode;
    action?: ReactNode;
    // Controls the left accent bar. 'subtle' is the default HUD callout look;
    // 'active' makes the bar thicker and full-opacity so it can stand in for a
    // ring/border highlight; 'none' suppresses it entirely.
    accentEdge?: 'none' | 'subtle' | 'active';
}

export function Card({ children, className = '', contentClassName = '', title, icon: Icon, description, action, accentEdge }: CardProps) {
    const showHeader = !!(title || action);
    const edge: NonNullable<CardProps['accentEdge']> = accentEdge ?? (showHeader ? 'subtle' : 'none');
    const edgeClass = edge === 'active' ? 'w-[3px] bg-accent' : 'w-[2px] bg-accent/60';
    const hasBody = children !== undefined && children !== null && children !== false;
    return (
        <div className={`bg-bg-secondary/50 backdrop-blur-sm border border-white/5 rounded-sm overflow-hidden relative ${className}`}>
            {edge !== 'none' && <span aria-hidden className={`absolute left-0 top-0 bottom-0 ${edgeClass}`} />}
            {showHeader && (
                <div className={`px-5 py-4 flex flex-wrap items-center justify-between gap-4 ${hasBody ? 'border-b border-white/5' : ''}`}>
                    <div className="min-w-0">
                        {title && (
                            <div className={`flex items-center gap-2 ${description ? 'mb-1' : ''}`}>
                                {Icon && <Icon className="w-4 h-4 text-accent" />}
                                <h3 className="text-lg font-semibold text-text-primary tracking-wide font-reaver">{title}</h3>
                            </div>
                        )}
                        {description && (
                            <p className="text-xs text-text-secondary">{description}</p>
                        )}
                    </div>
                    {action && <div className="shrink-0">{action}</div>}
                </div>
            )}
            {hasBody && <div className={`p-5 ${contentClassName}`}>{children}</div>}
        </div>
    );
}

interface BadgeProps {
    children: ReactNode;
    variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
    className?: string;
}

export function Badge({ children, variant = 'neutral', className = '' }: BadgeProps) {
    const variants = {
        success: 'bg-state-success/10 text-state-success border-state-success/20',
        warning: 'bg-state-warning/10 text-state-warning border-state-warning/20',
        error: 'bg-state-danger/10 text-state-danger border-state-danger/20',
        info: 'bg-state-info/10 text-state-info border-state-info/20',
        neutral: 'bg-white/5 text-text-secondary border-white/10',
    };

    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-medium border ${variants[variant]} ${className}`}>
            {children}
        </span>
    );
}

// ============================================================================
// Tag - Game-HUD styled status marker for cards (Load #, Conflict, Update,
// Installed, Outdated, NSFW, Sound, etc). Uses a sharp 3px radius with a
// bright leading accent bar so tags read as decisive callouts rather than
// soft web-style pills.
// ============================================================================

type TagTone = 'accent' | 'warning' | 'danger' | 'success' | 'info' | 'neutral';

interface TagProps {
    children: ReactNode;
    tone?: TagTone;
    /**
     * `overlay` — sits on top of imagery/thumbnails. Fully opaque saturated
     *             background so it reads over any underlying art.
     * `inline`  — sits inside a card against its own surface. Uses a muted
     *             tinted bg with the tone's color as text.
     */
    variant?: 'overlay' | 'inline';
    icon?: LucideIcon;
    title?: string;
    className?: string;
}

export function Tag({
    children,
    tone = 'neutral',
    variant = 'inline',
    icon: Icon,
    title,
    className = '',
}: TagProps) {
    const tones: Record<TagTone, { text: string; border: string; fill: string; overlayBorder: string }> = {
        accent:  { text: 'text-accent',          border: 'border-accent/40',         fill: 'bg-accent/10',          overlayBorder: 'border-accent/70' },
        warning: { text: 'text-state-warning',   border: 'border-state-warning/40',  fill: 'bg-state-warning/10',   overlayBorder: 'border-state-warning/70' },
        danger:  { text: 'text-state-danger',    border: 'border-state-danger/40',   fill: 'bg-state-danger/10',    overlayBorder: 'border-state-danger/70' },
        success: { text: 'text-state-success',   border: 'border-state-success/40',  fill: 'bg-state-success/10',   overlayBorder: 'border-state-success/70' },
        info:    { text: 'text-state-info',      border: 'border-state-info/40',     fill: 'bg-state-info/10',      overlayBorder: 'border-state-info/70' },
        neutral: { text: 'text-text-secondary',  border: 'border-white/10',          fill: 'bg-white/5',            overlayBorder: 'border-white/20' },
    };
    const t = tones[tone];
    const isOverlay = variant === 'overlay';
    const surface = isOverlay
        ? `bg-bg-primary/90 border ${t.overlayBorder} ${t.text} shadow-[0_1px_2px_rgba(0,0,0,0.35)]`
        : `${t.fill} border ${t.border} ${t.text} opacity-90`;
    return (
        <span
            title={title}
            className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold leading-none ${surface} ${className}`}
        >
            {Icon && <Icon className="w-3 h-3" />}
            {children}
        </span>
    );
}

export function ArchivedTag({ className = '' }: { className?: string }) {
    return (
        <span className={`flex-shrink-0 text-[10px] uppercase tracking-wide bg-bg-primary text-text-secondary rounded px-1.5 py-0.5 border border-border ${className}`}>
            <Tx k="common.status.archived" fallback="Archived" />
        </span>
    );
}

export function CheckboxMark({
    checked,
    indeterminate = false,
    disabled = false,
    className = '',
}: {
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    className?: string;
}) {
    const active = checked || indeterminate;
    return (
        <span
            aria-hidden
            className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${
                active ? 'border-accent bg-accent' : 'border-border bg-bg-secondary'
            } ${disabled ? 'opacity-50' : ''} ${className}`}
        >
            {checked ? (
                <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
            ) : indeterminate ? (
                <span className="w-2 h-0.5 rounded-full bg-black" />
            ) : null}
        </span>
    );
}

interface SliderProps {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    label?: ReactNode;
    showValue?: boolean;
    className?: string;
    formatValue?: (val: number) => string;
    /** Render the value badge as a typed number input (commit on blur/Enter,
     *  clamped to min/max) for exact entry alongside the slider. */
    editable?: boolean;
}

function SliderValueInput({ value, min, max, step, onChange }: {
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}) {
    const [text, setText] = useState(String(value));
    useEffect(() => { setText(String(value)); }, [value]);

    const commit = () => {
        const n = parseFloat(text);
        if (Number.isFinite(n)) {
            const clamped = Math.min(max, Math.max(min, n));
            onChange(clamped);
            setText(String(clamped));
        } else {
            setText(String(value));
        }
    };

    return (
        <input
            type="number"
            value={text}
            min={min}
            max={max}
            step={step}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    commit();
                    e.currentTarget.blur();
                }
            }}
            className="w-16 text-right text-xs font-mono text-text-primary bg-bg-tertiary px-1.5 py-0.5 rounded-sm border border-transparent focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
    );
}

export function Slider({
    value,
    min,
    max,
    step = 1,
    onChange,
    label,
    showValue = true,
    className = '',
    formatValue,
    editable = false
}: SliderProps) {
    // Clamp so out-of-range values (e.g. imported from external config) can't
    // push the thumb outside the track.
    const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

    return (
        <div className={`space-y-2 ${className}`}>
            <div className="flex justify-between items-center">
                {label && <label className="text-sm font-medium text-text-secondary">{label}</label>}
                {showValue && (editable ? (
                    <SliderValueInput value={value} min={min} max={max} step={step} onChange={onChange} />
                ) : (
                    <span className="text-xs font-mono text-text-primary bg-bg-tertiary px-1.5 py-0.5 rounded-sm">
                        {formatValue ? formatValue(value) : value}
                    </span>
                ))}
            </div>
            <div className="relative h-6 flex items-center group">
                <div className="absolute w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                        className="h-full bg-accent transition-all duration-100 ease-out"
                        style={{ width: `${percentage}%` }}
                    />
                </div>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="absolute w-full h-full opacity-0 cursor-pointer"
                />
                <div
                    className="absolute h-4 w-4 bg-white rounded-full shadow-lg border-2 border-accent pointer-events-none transition-all duration-100 ease-out group-hover:scale-110"
                    style={{ left: `calc(${percentage}% - 8px)` }}
                />
            </div>
        </div>
    );
}

interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: ReactNode;
    description?: ReactNode;
    className?: string;
    disabled?: boolean;
}

interface ToggleIndicatorProps {
    checked: boolean;
    disabled?: boolean;
    className?: string;
}

export function ToggleIndicator({ checked, disabled, className = '' }: ToggleIndicatorProps) {
    return (
        <span
            aria-hidden
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out motion-reduce:transition-none ${
                checked
                    ? 'border-accent/55 bg-accent/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-accent/25 group-hover:border-accent/75 group-hover:bg-accent/20 group-hover/toggle:border-accent/75 group-hover/toggle:bg-accent/20'
                    : 'border-white/15 bg-white/[0.16] group-hover:border-white/25 group-hover:bg-white/[0.22] group-hover/toggle:border-white/25 group-hover/toggle:bg-white/[0.22]'
            } ${disabled ? 'opacity-60' : ''} ${className}`}
        >
            <span
                className={`absolute left-0.5 h-5 w-5 rounded-full bg-zinc-300 shadow-[0_1px_2px_rgba(0,0,0,0.35)] ring-1 transition-transform duration-150 ease-out motion-reduce:transition-none ${
                    checked ? 'translate-x-5' : 'translate-x-0'
                } ${checked ? 'ring-accent/45' : 'ring-white/35'}`}
            />
        </span>
    );
}

export function Toggle({ checked, onChange, label, description, className = '', disabled }: ToggleProps) {
    return (
        <label className={`flex items-start gap-3 group ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}>
            <div className="relative shrink-0 mt-0.5">
                <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    onChange={(e) => !disabled && onChange(e.target.checked)}
                    disabled={disabled}
                    role="switch"
                    aria-checked={checked}
                />
                <ToggleIndicator
                    checked={checked}
                    disabled={disabled}
                    className="peer-focus-visible:ring-2 peer-focus-visible:ring-accent/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg-primary peer-disabled:cursor-not-allowed"
                />
            </div>
            <div>
                {label && <span className="block text-sm font-medium text-text-primary group-hover:text-white transition-colors">{label}</span>}
                {description && <p className="text-xs text-text-secondary mt-0.5">{description}</p>}
            </div>
        </label>
    );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'warning';
    size?: 'sm' | 'md' | 'lg';
    icon?: LucideIcon;
    isLoading?: boolean;
}

export function Button({
    children,
    variant = 'primary',
    size = 'md',
    icon: Icon,
    isLoading,
    className = '',
    disabled,
    ...props
}: ButtonProps) {
    const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-sm font-medium whitespace-nowrap transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

    const variants = {
        primary: 'border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary focus:ring-accent',
        secondary: 'bg-bg-tertiary hover:bg-white/10 text-text-primary border border-white/5 focus:ring-white/60',
        danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 focus:ring-red-500',
        success: 'bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 focus:ring-green-500',
        warning: 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-500/20 focus:ring-yellow-500',
        ghost: 'hover:bg-white/5 text-text-secondary hover:text-text-primary focus:ring-white/40',
    };

    const sizes = {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2 text-sm',
        lg: 'px-6 py-3 text-base',
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={disabled || isLoading}
            {...props}
        >
            {isLoading ? (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : Icon ? (
                <Icon className="w-4 h-4" />
            ) : null}
            {children}
        </button>
    );
}

// ============================================================================
// IconButton - square icon-only button (modal close X, inline actions). One
// shape / size / focus treatment so every icon button across dialogs matches,
// instead of each surface hand-rolling its own. `label` is required (icon-only
// buttons need an accessible name) and doubles as the hover tooltip.
// ============================================================================

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    icon: LucideIcon;
    /** Accessible name + hover tooltip (icon-only, so this is mandatory). */
    label: string;
    size?: 'sm' | 'md';
    tone?: 'default' | 'danger';
}

export function IconButton({ icon: Icon, label, size = 'md', tone = 'default', className = '', ...props }: IconButtonProps) {
    const sizes = {
        sm: 'h-7 w-7',
        md: 'h-8 w-8',
    };
    const tones = {
        default: 'border-border text-text-secondary hover:border-white/25 hover:bg-white/5 hover:text-text-primary',
        danger: 'border-border text-text-secondary hover:border-state-danger/60 hover:bg-state-danger/10 hover:text-state-danger',
    };
    const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            className={`flex flex-shrink-0 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${sizes[size]} ${tones[tone]} ${className}`}
            {...props}
        >
            <Icon className={iconSize} aria-hidden />
        </button>
    );
}

// ============================================================================
// ModalHeader - the pinned title row shared by dialogs: display-font title,
// optional subtitle, an optional actions slot (e.g. a Reset button), and a
// uniform close button. Replaces the divergent per-modal headers.
// ============================================================================

interface ModalHeaderProps {
    title: ReactNode;
    /** id wired to the Modal's labelledBy for aria-labelledby. */
    titleId?: string;
    subtitle?: ReactNode;
    /** Tooltip for a truncated subtitle (e.g. the full mod name). */
    subtitleTitle?: string;
    onClose: () => void;
    closeLabel?: string;
    closeDisabled?: boolean;
    /** Extra controls rendered left of the close button (e.g. a Reset action). */
    actions?: ReactNode;
    className?: string;
}

export function ModalHeader({
    title,
    titleId,
    subtitle,
    subtitleTitle,
    onClose,
    closeLabel,
    closeDisabled,
    actions,
    className = '',
}: ModalHeaderProps) {
    return (
        <div className={`flex flex-shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4 ${className}`}>
            <div className="min-w-0">
                <h2 id={titleId} className="truncate text-lg font-semibold tracking-wide text-text-primary font-reaver">
                    {title}
                </h2>
                {subtitle && (
                    <p className="truncate text-xs text-text-secondary" title={subtitleTitle}>
                        {subtitle}
                    </p>
                )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
                {actions}
                <IconButton
                    icon={X}
                    label={closeLabel ?? 'Close'}
                    onClick={onClose}
                    disabled={closeDisabled}
                />
            </div>
        </div>
    );
}

// ============================================================================
// SegmentedControl - a single tab/segment language for "pick one option"
// rows (image-picker surfaces, appearance source kinds). role=tablist with
// roving arrow-key focus and aria-selected, so the two former divergent tab
// styles (underline vs pill) collapse to one.
// ============================================================================

interface SegmentOption<T extends string> {
    value: T;
    label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
    options: readonly SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
    label?: string;
    className?: string;
    /** Equal-width segments that stretch to fill the container, instead of the
     *  default content-width chips. Use for full-width pickers (e.g. a settings
     *  popover row) where the segments should split the available width. */
    fill?: boolean;
    /** Disable the whole control (no clicks, no roving focus). Dimming is left to
     *  the caller so the control's label can dim alongside it. */
    disabled?: boolean;
}

export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    label,
    className = '',
    fill = false,
    disabled = false,
}: SegmentedControlProps<T>) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);

    const move = (from: number, dir: -1 | 1) => {
        if (disabled) return;
        const next = (from + dir + options.length) % options.length;
        onChange(options[next].value);
        refs.current[next]?.focus();
    };

    return (
        <div role="tablist" aria-label={label} className={`flex gap-1.5 ${fill ? 'w-full' : 'flex-wrap'} ${className}`}>
            {options.map((opt, i) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        ref={(el) => { refs.current[i] = el; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        disabled={disabled}
                        onClick={() => !disabled && onChange(opt.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                                e.preventDefault();
                                move(i, 1);
                            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                                e.preventDefault();
                                move(i, -1);
                            }
                        }}
                        className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default ${fill ? 'flex-1' : ''} ${
                            active
                                ? 'border-accent/70 bg-accent/15 text-text-primary'
                                : 'border-border bg-bg-tertiary text-text-secondary hover:border-accent/40 hover:text-text-primary'
                        }`}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
