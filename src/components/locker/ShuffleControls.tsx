import { Pin, Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * The corner controls that curate the launch-shuffle pool. Shared by every
 * surface that shows a shuffleable card (hero skins, and the Locker's General
 * classification tabs) so the affordance reads the same everywhere: a
 * rounded-full corner pill, accent when the mod is in the pool, revealed on
 * hover or whenever the master switch is armed.
 *
 * The host card owns the placement (and its own `group/...` name for the hover
 * reveal), so both controls take those utilities through `className`.
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

interface ShuffleBulkButtonProps {
  /** Every eligible card here is already pooled, so the button removes them. */
  allIncluded: boolean;
  /** How many distinct mods the action covers, for the tooltip. */
  count: number;
  onClick: () => void;
}

/**
 * Header-row bulk control for a card set that is not itself a shuffle group
 * (today: one user category). It pools or un-pools every member the planner can
 * actually re-roll, leaving Global pins and non-shuffleable mods alone, so it
 * never writes a key the planner would ignore.
 *
 * Styled as the other header-row actions ("Add mods", "Make Global") rather
 * than as a card overlay: it acts on the tab, not on one card.
 */
export function ShuffleBulkButton({ allIncluded, count, onClick }: ShuffleBulkButtonProps) {
  const { t } = useTranslation();
  const label = allIncluded
    ? t('locker.randomize.bulk.remove')
    : t('locker.randomize.bulk.add');
  const title = allIncluded
    ? t('locker.randomize.bulk.removeHint', { count })
    : t('locker.randomize.bulk.addHint', { count });
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1.5 self-center rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        allIncluded
          ? 'border-accent bg-accent/20 hover:bg-accent/30'
          : 'border-accent/40 bg-accent/10 hover:border-accent/60 hover:bg-accent/20'
      }`}
    >
      <Shuffle className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

interface ShuffleAlwaysOnBadgeProps {
  name: string;
  /** Master switch armed: the pin only means something once shuffling is on. */
  armed?: boolean;
  className?: string;
}

/**
 * The always-on marker for a Global (priority root) mod. It replaces the opt-in
 * button rather than sitting next to it: a Global mod is pinned by construction,
 * so the planner never picks it and never turns it off. Offering "add to
 * shuffle" here used to be a silent lie (the opt-in persisted, the planner
 * dropped it, and a hero whose only pooled skin was Global just stopped
 * shuffling), so the control is deliberately not interactive.
 */
export function ShuffleAlwaysOnBadge({ name, armed, className = '' }: ShuffleAlwaysOnBadgeProps) {
  const { t } = useTranslation();
  const label = t('locker.randomize.alwaysOn', { name });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 cursor-default items-center justify-center rounded-full border border-accent/45 bg-black/65 text-accent backdrop-blur-sm transition-opacity duration-150 ${
        armed ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    >
      <Pin className="h-3.5 w-3.5" />
    </span>
  );
}
