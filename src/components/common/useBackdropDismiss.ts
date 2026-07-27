import { useEffect, useRef } from 'react';

/**
 * Click-to-dismiss for an overlay backdrop that ignores drags which merely
 * *end* on the backdrop.
 *
 * The naive version (`onClick` on the backdrop, guarded by
 * `e.target === e.currentTarget`, or by the panel calling stopPropagation)
 * misfires: a drag that starts inside the panel (selecting text in an input,
 * dragging the panel's scrollbar) and releases over the backdrop produces a
 * click whose target is their common ancestor, which is the backdrop itself.
 * The panel never sees that click, so nothing stops it, and the dialog closes
 * out from under the gesture.
 *
 * Requiring the gesture to both start and end on the backdrop fixes that, and
 * also ignores the mirror case (press the backdrop, release inside the panel).
 *
 * Attach the returned ref to the backdrop element, and do not also hang an
 * onClick dismiss on it.
 */
export function useBackdropDismiss<T extends HTMLElement = HTMLDivElement>(
    onDismiss: () => void,
    enabled = true
) {
    const ref = useRef<T>(null);
    // Ref rather than a local, so it survives the re-subscribe that inline
    // onDismiss props cause on every render.
    const downOnBackdropRef = useRef(false);

    useEffect(() => {
        if (!enabled) return;
        const onDown = (e: MouseEvent) => {
            downOnBackdropRef.current = e.button === 0 && e.target === ref.current;
        };
        const onUp = (e: MouseEvent) => {
            const dismiss =
                downOnBackdropRef.current && e.button === 0 && e.target === ref.current;
            downOnBackdropRef.current = false;
            if (dismiss) onDismiss();
        };
        // Capture phase: children that stopPropagation() must not be able to
        // desync the origin flag or swallow the release. Target identity is
        // what gates the dismiss, so nested overlays never cross-talk.
        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('mouseup', onUp, true);
        return () => {
            window.removeEventListener('mousedown', onDown, true);
            window.removeEventListener('mouseup', onUp, true);
        };
    }, [enabled, onDismiss]);

    return ref;
}
