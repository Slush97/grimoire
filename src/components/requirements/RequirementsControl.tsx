import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/ui';

export function RequirementsControl({ count, active, onClick }: { count: number; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return <div className="relative shrink-0">
    <Button variant="secondary" icon={Link2} className={`!px-2.5 ${active ? 'border-accent/40 text-accent' : ''}`}
      aria-pressed={active} aria-label={t('requirements.title')} title={t('requirements.toolbarHint', { count })} onClick={onClick} />
    {count > 0 && <span aria-hidden className="pointer-events-none absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-state-warning px-1 text-2xs font-semibold leading-none text-bg-primary ring-2 ring-bg-primary">{count > 99 ? '99+' : count}</span>}
  </div>;
}
