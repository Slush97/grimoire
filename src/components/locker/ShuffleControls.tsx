import { Shuffle, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
}

export function ShuffleIncludeButton({
  name,
  included,
  onToggle,
  armed,
  className = '',
  restingClassName = CARD_CONTROL_SURFACE,
}: ShuffleIncludeButtonProps) {
  const { t } = useTranslation();
  const label = included
    ? t('locker.randomize.removeFromShuffle', { name })
    : t('locker.randomize.addToShuffle', { name });
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
export function ModFavoriteButton({ favorite, onToggle, className = '' }: {
  favorite: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = favorite ? t('installed.card.unfavorite') : t('installed.card.favorite');
  return <button type="button" aria-label={label} title={label} aria-pressed={favorite}
    onClick={event => { event.stopPropagation(); onToggle(); }}
    className={`flex h-7 w-7 items-center justify-center rounded-full transition-[opacity,background-color,color] duration-150 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent ${favorite
      ? SELECTED_CARD_CONTROL
      : `opacity-0 ${CARD_CONTROL_SURFACE} backdrop-blur-sm hover:bg-accent/70 hover:text-accent-foreground`} ${className}`}>
    <Star className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} aria-hidden />
  </button>;
}
