import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { Modal } from './Modal';

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
    title: string;
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
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    variant?: 'default' | 'error';
    className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, variant = 'default', className = '' }: EmptyStateProps) {
    const iconColor = variant === 'error' ? 'text-red-500' : 'text-text-secondary';
    const titleColor = variant === 'error' ? 'text-red-400' : 'text-text-primary';

    return (
        <div className={`flex flex-col items-center justify-center h-full text-text-secondary animate-fade-in ${className}`}>
            <Icon className={`w-16 h-16 mb-4 opacity-50 ${iconColor}`} />
            <h2 className={`text-xl font-semibold mb-2 ${titleColor}`}>{title}</h2>
            {description && (
                <div className={`text-center max-w-md ${variant === 'error' ? 'text-red-400' : ''}`}>
                    {description}
                </div>
            )}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

// ============================================================================
// ConfirmModal - Reusable confirmation dialog
// ============================================================================

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'primary',
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    const confirmClass = variant === 'danger'
        ? 'border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 hover:border-red-500/60 text-red-400 focus-visible:ring-red-400'
        : 'border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary focus-visible:ring-accent';

    return (
        <Modal
            open={isOpen}
            onClose={onCancel}
            labelledBy="confirm-modal-title"
            size="sm"
            panelClassName="relative overflow-hidden p-6"
        >
            <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-[2px] ${variant === 'danger' ? 'bg-red-500/60' : 'bg-accent/60'}`} />
            <h3 id="confirm-modal-title" className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
            <div className="text-text-secondary mb-4">{message}</div>
            <div className="flex justify-end gap-3">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 bg-bg-tertiary border border-border rounded-sm hover:bg-white/10 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                    {cancelLabel}
                </button>
                <button
                    onClick={onConfirm}
                    className={`px-4 py-2 rounded-sm font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${confirmClass}`}
                >
                    {confirmLabel}
                </button>
            </div>
        </Modal>
    );
}
