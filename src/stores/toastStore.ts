import { create } from 'zustand';

// App-wide toast queue. Toasts stack bottom-center (rendered by ToastStack in
// Layout) instead of each surface hand-rolling its own floating div, so two
// notifications no longer overwrite each other.

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** ms until auto-dismiss */
  duration: number;
  /** show an explicit Dismiss button (sticky warnings) */
  dismissable?: boolean;
}

interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
  dismissable?: boolean;
}

interface ToastState {
  toasts: Toast[];
  showToast: (message: string, opts?: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

let nextToastId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (message, opts = {}) => {
    const id = nextToastId++;
    const toast: Toast = {
      id,
      message,
      tone: opts.tone ?? 'info',
      duration: opts.duration ?? 5000,
      dismissable: opts.dismissable,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-component call sites. */
export function showToast(message: string, opts?: ToastOptions): number {
  return useToastStore.getState().showToast(message, opts);
}
