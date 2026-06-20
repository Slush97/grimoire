import { type ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';
import Tx from '../translation/Tx';

// ============================================================================
// SectionHeader - Consistent section header styling
// ============================================================================

interface SectionHeaderProps {
    children: ReactNode;
    count?: number;
    className?: string;
}

export function SectionHeader({ children, count, className = '' }: SectionHeaderProps) {
    return (
        <h2 className={`text-sm font-medium text-text-secondary mb-3 uppercase tracking-wider ${className}`}>
            {children}{count !== undefined && ` (${count})`}
        </h2>
    );
}

// ============================================================================
// ViewModeToggle - Unified toggle for switching between view modes
// ============================================================================

export type ViewMode = 'grid' | 'list' | 'gallery' | 'compact';

interface ViewModeOption {
    value: ViewMode;
    label: string;
    icon?: LucideIcon;
}

interface ViewModeToggleProps {
    value: ViewMode;
    options: ViewModeOption[];
    onChange: (mode: ViewMode) => void;
    className?: string;
}

export function ViewModeToggle({ value, options, onChange, className = '' }: ViewModeToggleProps) {
    const anyIcon = options.some((o) => o.icon);
    return (
        <div className={`flex items-center rounded-sm border border-border bg-bg-secondary p-0.5 text-sm ${className}`}>
            {options.map((option) => {
                const Icon = option.icon;
                const active = value === option.value;
                const baseCls = anyIcon ? 'p-1.5' : 'px-3 py-1';
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        title={option.label}
                        aria-label={option.label}
                        className={`${baseCls} rounded-sm transition-colors cursor-pointer ${active
                            ? 'border border-accent/40 bg-accent/10 text-text-primary'
                            : 'border border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                            }`}
                    >
                        {Icon ? <Icon className="w-5 h-5" /> : option.label}
                    </button>
                );
            })}
        </div>
    );
}

// ============================================================================
// PageHeader - Standardized page header with icon badge
// ============================================================================

interface PageHeaderProps {
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    stats?: ReactNode;
    className?: string;
}

export function PageHeader({ title, description, action, stats, className = '' }: PageHeaderProps) {
    return (
        <div className={`flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-border ${className}`}>
            <div className="min-w-0">
                <h1 className="text-3xl md:text-4xl font-reaver tracking-wide text-text-primary leading-tight whitespace-nowrap">
                    {title}
                </h1>
                {description && <div className="text-text-secondary text-sm mt-1">{description}</div>}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
                {stats && <div className="text-sm text-text-secondary">{stats}</div>}
                {action}
            </div>
        </div>
    );
}

// ============================================================================
// EmptyState - Consistent empty/error state display
// ============================================================================

interface EmptyStateProps {
    icon: LucideIcon;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    variant?: 'default' | 'error';
    className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, variant = 'default', className = '' }: EmptyStateProps) {
    const iconColor = variant === 'error' ? 'text-state-danger' : 'text-text-secondary';
    const titleColor = variant === 'error' ? 'text-state-danger' : 'text-text-primary';

    return (
        <div className={`flex flex-col items-center justify-center h-full text-text-secondary animate-fade-in ${className}`}>
            <Icon className={`w-16 h-16 mb-4 opacity-50 ${iconColor}`} />
            <h2 className={`text-xl font-semibold mb-2 ${titleColor}`}>{title}</h2>
            {description && (
                <div className={`text-center max-w-md ${variant === 'error' ? 'text-state-danger' : ''}`}>
                    {description}
                </div>
            )}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

// ============================================================================
// PageLayout - the standard page root.
//
// The app shell (Layout.tsx) already wraps the router Outlet in a scrolling,
// fade-in container, so pages must NOT add their own `h-full overflow-y-auto`
// or `animate-fade-in` (several used to, double-wrapping). This collapses the
// competing root-div patterns into one:
//   - `flow` (default): vertical stack; the shell scrolls the whole page.
//   - `fill`: page fills the height and owns its own internal scroll regions
//             (e.g. split panes). Pages that save/restore their own scroll
//             position via a ref keep their bespoke container instead.
// `maxWidth` centers and constrains the content column.
// ============================================================================

type PageWidth = 'none' | 'lg' | 'xl' | '2xl' | '3xl' | '5xl' | '7xl';

const PAGE_WIDTHS: Record<PageWidth, string> = {
    none: '',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '5xl': 'max-w-5xl',
    '7xl': 'max-w-7xl',
};

interface PageLayoutProps {
    children: ReactNode;
    maxWidth?: PageWidth;
    variant?: 'flow' | 'fill';
    className?: string;
}

export function PageLayout({ children, maxWidth = 'none', variant = 'flow', className = '' }: PageLayoutProps) {
    const width = maxWidth === 'none' ? '' : `${PAGE_WIDTHS[maxWidth]} mx-auto w-full`;
    const base = variant === 'fill' ? 'p-6 h-full flex flex-col min-h-0 overflow-hidden' : 'p-6 space-y-6';
    return <div className={`${base} ${width} ${className}`}>{children}</div>;
}

// ============================================================================
// LoadingState - consistent pending UI. `spinner` for a centered loader,
// `cards` for a skeleton grid that stands in for card content. Carries
// aria-busy/aria-live so every loading surface announces uniformly. Pages with
// a bespoke content-shaped skeleton (e.g. Conflicts) keep theirs.
// ============================================================================

interface LoadingStateProps {
    variant?: 'spinner' | 'cards';
    /** Number of skeleton cards (cards variant). */
    count?: number;
    /** Visible + screen-reader label (spinner variant). */
    label?: ReactNode;
    className?: string;
}

export function LoadingState({ variant = 'spinner', count = 8, label, className = '' }: LoadingStateProps) {
    if (variant === 'cards') {
        return (
            <div
                className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}
                aria-busy="true"
                aria-live="polite"
            >
                {Array.from({ length: count }).map((_, i) => (
                    <Skeleton key={i} rounded="md" className="h-32 w-full" />
                ))}
            </div>
        );
    }
    return (
        <div
            className={`flex h-full min-h-40 flex-col items-center justify-center gap-3 text-text-secondary ${className}`}
            aria-busy="true"
            aria-live="polite"
        >
            <Loader2 className="w-6 h-6 animate-spin text-accent" aria-hidden />
            {label && <p className="text-sm">{label}</p>}
        </div>
    );
}

// ============================================================================
// ConfirmModal - Reusable confirmation dialog
// ============================================================================

interface ConfirmModalProps {
    isOpen: boolean;
    title: ReactNode;
    message: ReactNode;
    confirmLabel?: ReactNode;
    cancelLabel?: ReactNode;
    variant?: 'danger' | 'primary';
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    variant = 'primary',
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    const confirmClass = variant === 'danger'
        ? 'border border-state-danger/40 bg-state-danger/10 hover:bg-state-danger/20 hover:border-state-danger/60 text-state-danger focus-visible:ring-state-danger'
        : 'border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary focus-visible:ring-accent';

    return (
        <Modal
            open={isOpen}
            onClose={onCancel}
            labelledBy="confirm-modal-title"
            size="sm"
            panelClassName="relative overflow-hidden p-6"
        >
            <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-[2px] ${variant === 'danger' ? 'bg-state-danger/60' : 'bg-accent/60'}`} />
            <h3 id="confirm-modal-title" className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
            <div className="text-text-secondary mb-4">{message}</div>
            <div className="flex justify-end gap-3">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 bg-bg-tertiary border border-border rounded-sm hover:bg-white/10 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                    {cancelLabel ?? <Tx k="common.actions.cancel" fallback="Cancel" />}
                </button>
                <button
                    onClick={onConfirm}
                    className={`px-4 py-2 rounded-sm font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${confirmClass}`}
                >
                    {confirmLabel ?? <Tx k="common.actions.confirm" fallback="Confirm" />}
                </button>
            </div>
        </Modal>
    );
}
