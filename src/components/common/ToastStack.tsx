import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';
import { useToastStore, type Toast } from '../../stores/toastStore';

// Renders the toast queue bottom-center at z-60 (above modals; see the
// z-index scale in index.css). Mounted once in Layout.

const TONE_CLASSES: Record<Toast['tone'], string> = {
  info: 'border-border bg-bg-secondary text-text-primary',
  success: 'border-state-success/40 bg-state-success/10 text-state-success',
  warning: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-200',
  error: 'border-red-500/40 bg-red-500/10 text-red-300',
};

const EXIT_MS = 200;

export function ToastStack() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useToastStore((s) => s.dismissToast);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => setClosing(true), Math.max(0, toast.duration - EXIT_MS));
    const removeTimer = window.setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, dismissToast]);

  const icon = toast.tone === 'warning' || toast.tone === 'error'
    ? <AlertTriangle className="h-4 w-4 flex-shrink-0" />
    : toast.tone === 'success'
      ? <Check className="h-4 w-4 flex-shrink-0" />
      : <Info className="h-4 w-4 flex-shrink-0 text-text-secondary" />;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex max-w-[460px] items-center gap-2 rounded-lg border px-4 py-2 text-sm shadow-lg shadow-black/40 backdrop-blur-sm ${
        TONE_CLASSES[toast.tone]
      } ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{toast.message}</span>
      {toast.dismissable && (
        <button
          type="button"
          onClick={() => dismissToast(toast.id)}
          className="flex-shrink-0 cursor-pointer opacity-70 transition-opacity hover:opacity-100"
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
