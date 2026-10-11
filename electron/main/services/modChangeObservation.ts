const listeners = new Set<() => void>();

export function observeModChanges(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Observers are advisory and must never affect the mutation that notified them. */
export function notifyModChanges(): void {
    for (const listener of listeners) {
        try { listener(); } catch { /* Diagnostic observers do not own mod operations. */ }
    }
}
