import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpToLine } from 'lucide-react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';

/** Stand-in for PriorityEditor on Global (priority-root) cards. They load
 *  before every numbered mod and reorderMods filters them out of reposition
 *  batches, so a position number would be both a lie and dead UI. Echoes the
 *  PriorityEditor chip geometry, accent-tinted so Global reads as its own
 *  tier rather than position zero. */
export function GlobalLoadBadge({ variant }: { variant: 'overlay' | 'inline' }) {
  const { t } = useTranslation();
  return (
    <span
      title={t('installed.priority.hint')}
      aria-label={t('installed.priority.chip')}
      className={`inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-md border border-accent/60 px-2 text-accent ${
        variant === 'overlay' ? 'bg-black/70' : 'bg-bg-tertiary'
      }`}
    >
      <ArrowUpToLine className="h-3 w-3" strokeWidth={2.5} />
    </span>
  );
}

export function ChipText({ children }: { children: ReactNode }) {
  return <span className="relative top-[1.5px] min-w-0 truncate leading-[14px]">{children}</span>;
}

export function HeroTagLabel({ heroName, iconClassName = 'h-4 w-4', iconOnly = false }: { heroName: string; iconClassName?: string; iconOnly?: boolean }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle leading-none">
      <img
        src={getHeroChipIconPath(heroName)}
        alt=""
        aria-hidden="true"
        className={`${iconClassName} block flex-shrink-0 rounded-full object-cover`}
        loading="lazy"
      />
      {iconOnly ? <span className="sr-only">{heroName}</span> : <ChipText>{heroName}</ChipText>}
    </span>
  );
}

