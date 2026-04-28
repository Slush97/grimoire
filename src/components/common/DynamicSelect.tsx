import { useState, useCallback, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

interface DynamicSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
    value: string | number;
    onChange: (value: string) => void;
    options: Array<{ value: string | number; label: string }>;
    className?: string;
    disabled?: boolean;
}

/**
 * A select dropdown that dynamically sizes its width based on the currently
 * selected option text, rather than the widest option.
 */
export function DynamicSelect({
    value,
    onChange,
    options,
    className = '',
    disabled,
    ...props
}: DynamicSelectProps) {
    const [width, setWidth] = useState<number | undefined>(undefined);

    const currentLabel = options.find(opt => String(opt.value) === String(value))?.label || '';

    // Callback ref re-runs when currentLabel changes, measuring against the live DOM node
    // instead of doing it from a useEffect (which would trip react-hooks/set-state-in-effect).
    const measureRef = useCallback((node: HTMLSelectElement | null) => {
        if (!node) return;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const computed = window.getComputedStyle(node);
        ctx.font = `${computed.fontSize} ${computed.fontFamily}`;
        const textWidth = ctx.measureText(currentLabel).width;
        // Text + left padding (12px) + gap before arrow (8px) + arrow (16px) + right padding (8px) + border (2px)
        setWidth(Math.ceil(textWidth) + 46);
    }, [currentLabel]);

    return (
        <div className="relative inline-flex">
            <select
                ref={measureRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                style={width ? { width: `${width}px` } : undefined}
                className={`appearance-none pl-3 pr-8 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent transition-[width] duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
                {...props}
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
            {/* Custom dropdown arrow */}
            <ChevronDown
                className={`absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none ${disabled ? 'text-text-secondary/50' : 'text-text-secondary'}`}
            />
        </div>
    );
}
