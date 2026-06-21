import {
    cloneElement,
    isValidElement,
    useId,
    type InputHTMLAttributes,
    type ReactElement,
    type ReactNode,
    type Ref,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

// ============================================================================
// Form primitives - the single styled surface for text inputs, textareas and
// (native) selects, plus a FormField wrapper that wires a label + helper/error
// text to its control for accessibility.
//
// Before this file, every page/modal hand-rolled `<input className="...">` and
// the styles drifted (rounded-sm vs rounded-lg, different placeholder colors,
// stray transitions). Reach for these instead of raw form elements. Domain
// pickers (HeroSelect, DynamicSelect) intentionally stay separate.
//
// Canonical control surface (see docs/ui-conventions.md):
//   bg-bg-tertiary border border-white/5 rounded-sm
//   focus-visible:ring-2 focus-visible:ring-accent
//   disabled:opacity-60 disabled:cursor-not-allowed
// ============================================================================

type ControlSize = 'sm' | 'md';

const CONTROL_BASE =
    'w-full bg-bg-tertiary border border-white/5 rounded-sm text-text-primary text-sm ' +
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
// Domain-specific dropdowns (HeroSelect) stay separate.
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
