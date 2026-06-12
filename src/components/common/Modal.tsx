import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Standard modal shell: portal to body, dimmed backdrop, Escape and
// backdrop-click dismissal, focus hand-off into the panel and restore on
// close. Sits at z-50 (see the z-index scale in index.css).
//
// Call sites that conditionally render (`{show && <MyModal/>}`) get no exit
// animation, same as before. To fade out, keep the Modal mounted and drive
// the `open` prop instead; unmount happens MODAL_EXIT_MS after open=false.

const MODAL_EXIT_MS = 200;

// 'none' skips the width preset; the caller supplies its own max-w via
// panelClassName (two max-w-* utilities don't override predictably).
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'none';

const SIZE_CLASSES: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    none: '',
};

interface ModalProps {
    onClose: () => void;
    open?: boolean;
    /** id of the element labelling the dialog (usually the title heading) */
    labelledBy?: string;
    size?: ModalSize;
    /** false blocks Escape and backdrop-click closing (busy states, first-run flows) */
    dismissable?: boolean;
    /** extra classes for the panel (layout like flex/max-h, or a width override) */
    panelClassName?: string;
    /** extra classes for the backdrop (e.g. backdrop-blur-sm); don't stack bg-* utilities */
    backdropClassName?: string;
    children: ReactNode;
}

export function Modal({
    onClose,
    open = true,
    labelledBy,
    size = 'md',
    dismissable = true,
    panelClassName = '',
    backdropClassName = '',
    children,
}: ModalProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const [mounted, setMounted] = useState(open);
    // Render-time adjustment so opening re-mounts on the same commit.
    if (open && !mounted) setMounted(true);

    useEffect(() => {
        if (open) return;
        const timer = window.setTimeout(() => setMounted(false), MODAL_EXIT_MS);
        return () => window.clearTimeout(timer);
    }, [open]);

    useEffect(() => {
        if (!open || !dismissable) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, dismissable, onClose]);

    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement;
        if (previous instanceof HTMLElement) restoreFocusRef.current = previous;
        // Move focus into the dialog unless something inside already took it
        // (e.g. an autoFocus input rendered by the caller).
        const panel = panelRef.current;
        if (panel && !panel.contains(document.activeElement)) panel.focus();
        return () => {
            restoreFocusRef.current?.focus();
            restoreFocusRef.current = null;
        };
    }, [open]);

    if (!mounted) return null;
    const closing = !open;

    return createPortal(
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 ${
                closing ? 'animate-fade-out pointer-events-none' : 'animate-fade-in'
            } ${backdropClassName}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            onClick={(e) => {
                if (dismissable && e.target === e.currentTarget) onClose();
            }}
        >
            <div
                ref={panelRef}
                tabIndex={-1}
                className={`w-full ${SIZE_CLASSES[size]} bg-bg-secondary border border-border rounded-lg shadow-2xl outline-none ${panelClassName}`}
            >
                {children}
            </div>
        </div>,
        document.body
    );
}
