import { Check, Shuffle, Star } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../common/ui';

export function LockerGeneralCard({ active, className = '', ...props }: ComponentProps<'div'> & { active: boolean }) {
  return <div {...props} className={`group/card relative flex flex-col rounded-xl border bg-bg-secondary/80 p-2.5 text-text-primary transition-[border-color,background-color] duration-200 ${active
    ? 'border-accent' : 'border-border hover:border-hl/25'} ${className}`} />;
}

export const LOCKER_CARD_GRID_CLASS = 'grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3 min-[140rem]:grid-cols-4';

export const LOCKER_CARD_MEDIA_CLASS = 'relative mb-2 w-full overflow-hidden rounded-lg border border-hl/10 bg-bg-sunken/60';
export const LOCKER_CARD_TITLE_CLASS = 'min-w-0 truncate text-sm font-semibold leading-5 text-text-primary';

/** General cards share one round control, including the model-only actions. */
export function LockerCardAction({ className = '', onClick, ...props }: Omit<ComponentProps<typeof IconButton>, 'size' | 'shape' | 'tone'>) {
  return <IconButton {...props} size="sm" shape="round"
    className={`bg-bg-secondary/95 opacity-0 backdrop-blur-sm transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 aria-pressed:text-accent [&_svg]:size-4 ${className}`}
    onClick={event => { event.stopPropagation(); onClick?.(event); }} />;
}

/** Persistent status stays separate from the controls revealed on hover. */
export function LockerCardHeader({ active = false, favorite = false, shuffled = false, children }: {
  active?: boolean;
  favorite?: boolean;
  shuffled?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const status = [active ? t('common.status.active') : '', shuffled ? t('locker.randomize.inPool') : '',
    favorite ? t('installed.card.favorite') : ''].filter(Boolean).join(' • ');
  return <div className="pointer-events-none absolute left-2 right-2 top-2 z-20 flex flex-wrap items-start justify-between gap-2 [&_button]:pointer-events-auto"
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    {status && <span role="img" aria-label={status} title={status} data-locker-card-status
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-bg-sunken/95 px-2 text-text-primary ring-1 ring-inset ring-hl/10 backdrop-blur-sm">
      {active && <Check className="h-4 w-4 text-accent" aria-hidden />}
      {shuffled && <Shuffle className="h-4 w-4" aria-hidden />}
      {favorite && <Star className="h-4 w-4 fill-current" aria-hidden />}
    </span>}
    <div className="ml-auto flex max-w-full flex-wrap justify-end gap-1">{children}</div>
  </div>;
}

const CARD_CONTROL_SURFACE = 'bg-black/65 text-white/90';
const SELECTED_CARD_CONTROL = `opacity-100 bg-transparent text-accent
          group-hover/card:bg-accent group-hover/card:text-accent-foreground
          group-hover/row:bg-accent group-hover/row:text-accent-foreground
          group-hover/sound:bg-accent group-hover/sound:text-accent-foreground
          focus-visible:bg-accent focus-visible:text-accent-foreground`;

/**
 * The corner controls that curate the launch-shuffle pool. Shared by every
 * surface that shows a shuffleable card (hero skins, and the Locker's General
 * classification tabs) so the affordance reads the same everywhere: a
 * rounded-full corner pill, accent when the mod is in the pool, revealed on
 * hover or whenever the master switch is armed.
 *
 * The host card owns the placement (and its own `group/...` name for the hover
 * reveal), so the control takes those utilities through `className`.
 */
interface ShuffleIncludeButtonProps {
  /** Mod / skin name, used to build the accessible label. */
  name: string;
  /** Whether this mod is currently in the shuffle pool. */
  included: boolean;
  onToggle: () => void;
  /** Master "shuffle on launch" switch is on: stay visible, not hover-only. */
  armed?: boolean;
  /** Absolute placement plus the host's group-hover reveal utility. */
  className?: string;
  /** Resting background, matched to the host card's other overlay buttons. */
  restingClassName?: string;
  statusInBadge?: boolean;
}

export function ShuffleIncludeButton({
  name,
  included,
  onToggle,
  armed,
  className = '',
  restingClassName = CARD_CONTROL_SURFACE,
  statusInBadge = false,
}: ShuffleIncludeButtonProps) {
  const { t } = useTranslation();
  const label = included
    ? t('locker.randomize.removeFromShuffle', { name })
    : t('locker.randomize.addToShuffle', { name });
  if (statusInBadge) return <LockerCardAction icon={Shuffle} label={label} aria-pressed={included}
    onClick={onToggle} className={className} />;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={included}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-full transition-[opacity,background-color,color] duration-150 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent ${
        included
          ? SELECTED_CARD_CONTROL
          : `${armed ? 'opacity-100' : 'opacity-0'} ${restingClassName} backdrop-blur-sm hover:bg-accent/70 hover:text-accent-foreground`
      } ${className}`}
    >
      <Shuffle className="h-3.5 w-3.5" />
    </button>
  );
}

/** Favorite stars share the Locker corner controls and stay visible when selected. */
export function ModFavoriteButton({ favorite, onToggle, className = '', statusInBadge = false }: {
  favorite: boolean;
  onToggle: () => void;
  className?: string;
  statusInBadge?: boolean;
}) {
  const { t } = useTranslation();
  const label = favorite ? t('installed.card.unfavorite') : t('installed.card.favorite');
  if (statusInBadge) return <LockerCardAction icon={Star} label={label} aria-pressed={favorite}
    onClick={onToggle} className={`${favorite ? '[&_svg]:fill-current' : ''} ${className}`} />;
  return <button type="button" aria-label={label} title={label} aria-pressed={favorite}
    onClick={event => { event.stopPropagation(); onToggle(); }}
    className={`flex h-7 w-7 items-center justify-center rounded-full transition-[opacity,background-color,color] duration-150 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent ${favorite
      ? SELECTED_CARD_CONTROL
      : `opacity-0 ${CARD_CONTROL_SURFACE} backdrop-blur-sm hover:bg-accent/70 hover:text-accent-foreground`} ${className}`}>
    <Star className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} aria-hidden />
  </button>;
}
