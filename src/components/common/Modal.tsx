import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackdropDismiss } from './useBackdropDismiss';

// Stack of currently-open modals, in opening order. Stacked dialogs (a
// confirmation over a picker) each install window-level key handlers; without
// this, both fire on every keypress: the lower Tab trap yanks focus out of
// the upper dialog (pinning forward-Tab on one control), and a single Escape
// closes both. Only the topmost modal may handle keys.
const openModalStack: symbol[] = [];

function useModalStackEntry(open: boolean): () => boolean {
    const idRef = useRef<symbol | null>(null);
    if (idRef.current === null) idRef.current = Symbol('modal');
    const id = idRef.current;
    useEffect(() => {
        if (!open) return;
        openModalStack.push(id);
        return () => {
            const index = openModalStack.indexOf(id);
            if (index !== -1) openModalStack.splice(index, 1);
        };
    }, [open, id]);
    return useCallback(() => openModalStack[openModalStack.length - 1] === id, [id]);
}

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
    /** extra classes for the backdrop; don't stack bg-* utilities */
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
    const backdropRef = useBackdropDismiss<HTMLDivElement>(onClose, open && dismissable);
    const [mounted, setMounted] = useState(open);
    // Render-time adjustment so opening re-mounts on the same commit.
    if (open && !mounted) setMounted(true);
    const isTopmost = useModalStackEntry(open);

    useEffect(() => {
        if (open) return;
        const timer = window.setTimeout(() => setMounted(false), MODAL_EXIT_MS);
        return () => window.clearTimeout(timer);
    }, [open]);

    useEffect(() => {
        if (!open || !dismissable) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // A dialog stacked above this one owns the keyboard; letting the
            // lower handler run too would close both on a single Escape.
            if (!isTopmost()) return;
            e.preventDefault();
            onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, dismissable, onClose, isTopmost]);

    // Trap Tab focus inside the panel while open. The WAI-ARIA dialog pattern
    // (and Radix Dialog) keeps focus within a modal dialog; without this, Tab
    // walks out to the page behind the backdrop. Cycle at the boundaries.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            // Only the topmost dialog traps Tab. A lower trap firing first
            // sees focus "escaped" (it is in the dialog above) and steals it
            // back, which pins forward-Tab onto one control up there.
            if (!isTopmost()) return;
            const panel = panelRef.current;
            if (!panel) return;
            const focusable = panel.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            // No focusable children: keep focus on the panel itself.
            if (focusable.length === 0) {
                e.preventDefault();
                panel.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            // Focus escaped the panel (or sits on the panel shell): pull it back.
            if (!panel.contains(active) || active === panel) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
                return;
            }
            if (e.shiftKey && active === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, isTopmost]);

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
            ref={backdropRef}
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm ${
                closing ? 'animate-overlay-out pointer-events-none' : 'animate-overlay-in'
            } ${backdropClassName}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
        >
            <div
                ref={panelRef}
                tabIndex={-1}
                className={`modal-panel flex w-full flex-col overflow-hidden rounded-sm border border-border bg-bg-secondary shadow-2xl outline-none ${
                    closing ? 'animate-panel-out' : 'animate-panel-in'
                } ${SIZE_CLASSES[size]} ${panelClassName}`}
            >
                {children}
            </div>
        </div>,
        document.body
    );
}

// The panel is a viewport-capped flex column, so a dialog is ModalHeader,
// then ModalBody (the only part that scrolls), then an optional ModalFooter.
export function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div className={`flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3 ${className}`}>
            {children}
        </div>
    );
}
