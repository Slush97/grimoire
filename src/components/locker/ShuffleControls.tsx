import { Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  restingClassName = 'bg-black/65 text-white/90',
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
      className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-[opacity,background-color,color] duration-150 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent ${
        included
          ? 'opacity-100 bg-accent text-accent-foreground hover:bg-accent/80'
          : `${armed ? 'opacity-100' : 'opacity-0'} ${restingClassName} hover:bg-accent/70 hover:text-accent-foreground`
      } ${className}`}
    >
      <Shuffle className="h-3.5 w-3.5" />
    </button>
  );
}
