import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';

interface CardProps {
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    title?: string;
    icon?: LucideIcon;
    description?: string;
    action?: ReactNode;
}

export function Card({ children, className = '', contentClassName = '', title, icon: Icon, description, action }: CardProps) {
    return (
        <div className={`bg-bg-secondary/50 backdrop-blur-sm border border-white/5 rounded-xl overflow-hidden ${className}`}>
            {(title || action) && (
                <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        {title && (
                            <div className="flex items-center gap-2 mb-1">
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
            <div className={`p-5 ${contentClassName}`}>{children}</div>
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
        success: 'bg-green-500/10 text-green-400 border-green-500/20',
        warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        error: 'bg-red-500/10 text-red-400 border-red-500/20',
        info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        neutral: 'bg-white/5 text-text-secondary border-white/10',
    };

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${variants[variant]} ${className}`}>
            {children}
        </span>
    );
}

interface SliderProps {
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    label?: string;
    showValue?: boolean;
    className?: string;
    formatValue?: (val: number) => string;
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
    formatValue
}: SliderProps) {
    const percentage = ((value - min) / (max - min)) * 100;

    return (
        <div className={`space-y-2 ${className}`}>
            <div className="flex justify-between items-center">
                {label && <label className="text-sm font-medium text-text-secondary">{label}</label>}
                {showValue && (
                    <span className="text-xs font-mono text-text-primary bg-bg-tertiary px-1.5 py-0.5 rounded">
                        {formatValue ? formatValue(value) : value}
                    </span>
                )}
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
    label?: string;
    description?: string;
    className?: string;
    disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, className = '', disabled }: ToggleProps) {
    return (
        <label className={`flex items-start gap-3 cursor-pointer group ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
            <div className="relative shrink-0 mt-0.5">
                <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    onChange={(e) => !disabled && onChange(e.target.checked)}
                    disabled={disabled}
                />
                <div className="w-11 h-6 bg-bg-tertiary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent border border-white/5"></div>
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
    const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
        primary: 'bg-accent hover:bg-accent-hover text-white focus:ring-accent',
        secondary: 'bg-bg-tertiary hover:bg-white/10 text-text-primary border border-white/5 focus:ring-white/20',
        danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 focus:ring-red-500',
        success: 'bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 focus:ring-green-500',
        warning: 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-500/20 focus:ring-yellow-500',
        ghost: 'hover:bg-white/5 text-text-secondary hover:text-text-primary',
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
