import type { ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './ui';

/** Persistent activity messages share the floating queue's layout and dismissal. */
export function ActivityNotice({ children, onDismiss, tone = 'warning' }: {
  children: ReactNode;
  onDismiss: () => void;
  tone?: 'warning' | 'error';
}) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className="flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2 rounded-sm border border-border bg-bg-secondary p-3 shadow-lg animate-fade-in">
      <AlertTriangle className={`mt-1 h-4 w-4 shrink-0 ${tone === 'error' ? 'text-state-danger' : 'text-state-warning'}`} aria-hidden />
      <div className="min-w-0 flex-1 text-sm text-text-primary">{children}</div>
      <IconButton icon={X} label={t('common.actions.dismiss')} onClick={onDismiss} size="sm" />
    </div>
  );
}
