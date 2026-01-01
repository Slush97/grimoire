import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';

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

export type ViewMode = 'grid' | 'list' | 'gallery';

interface ViewModeOption {
    value: ViewMode;
    label: string;
}

interface ViewModeToggleProps {
    value: ViewMode;
    options: ViewModeOption[];
    onChange: (mode: ViewMode) => void;
    className?: string;
}

export function ViewModeToggle({ value, options, onChange, className = '' }: ViewModeToggleProps) {
    return (
        <div className={`flex items-center rounded-lg border border-border bg-bg-secondary p-1 text-sm ${className}`}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={`px-3 py-1.5 rounded-md transition-colors ${value === option.value
                        ? 'bg-accent text-white'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                        }`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

// ============================================================================
// PageHeader - Standardized page header with icon badge
// ============================================================================

interface PageHeaderProps {
    title: string;
    description?: string;
    icon: LucideIcon;
    action?: ReactNode;
    stats?: ReactNode;
    className?: string;
}

export function PageHeader({ title, description, icon: Icon, action, stats, className = '' }: PageHeaderProps) {
    return (
        <div className={`flex flex-wrap items-center justify-between gap-4 ${className}`}>
            <div className="flex items-center gap-3">
                <div className="p-3 bg-accent/10 rounded-xl">
                    <Icon className="w-8 h-8 text-accent" />
                </div>
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold font-reaver tracking-wide">{title}</h1>
                    {description && <p className="text-text-secondary">{description}</p>}
                </div>
            </div>
            <div className="flex items-center gap-4">
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
    description?: string;
    action?: ReactNode;
    variant?: 'default' | 'error';
}

export function EmptyState({ icon: Icon, title, description, action, variant = 'default' }: EmptyStateProps) {
    const iconColor = variant === 'error' ? 'text-red-500' : 'text-text-secondary';
    const titleColor = variant === 'error' ? 'text-red-400' : 'text-text-primary';

    return (
        <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <Icon className={`w-16 h-16 mb-4 opacity-50 ${iconColor}`} />
            <h2 className={`text-xl font-semibold mb-2 ${titleColor}`}>{title}</h2>
            {description && (
                <p className={`text-center max-w-md ${variant === 'error' ? 'text-red-400' : ''}`}>
                    {description}
                </p>
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
    if (!isOpen) return null;

    const confirmClass = variant === 'danger'
        ? 'bg-red-500 hover:bg-red-600 text-white'
        : 'bg-accent hover:bg-accent-hover text-white';

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-bg-secondary border border-border rounded-xl p-6 max-w-md mx-4">
                <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
                <div className="text-text-secondary mb-4">{message}</div>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-bg-tertiary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 rounded-lg transition-colors ${confirmClass}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
