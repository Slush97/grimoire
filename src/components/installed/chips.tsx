import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpToLine } from 'lucide-react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';
import soulUrn from '../../assets/soul-urn.png';

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

export function MetaTextChip({ label, className, title }: { label: string; className: string; title?: string }) {
  return <span className={className} title={title ?? label}><ChipText>{label}</ChipText></span>;
}

/** Earlier heroes paint in front; the overflow urn stays behind every hero. */
export function HeroIconStack({ heroes }: { heroes: readonly string[] }) {
  if (heroes.length === 0) return null;
  const icons = heroes.length > 5 ? [...heroes.slice(0, 4), null] : heroes;
  return (
    <span
      role="img"
      aria-label={heroes.join(', ')}
      title={heroes.join(', ')}
      className="relative isolate inline-block h-[22px] min-w-[22px]"
      style={{ width: Math.min(66, heroes.length * 22) }}
      data-hero-stack
    >
      {icons.map((hero, index) => (
        <span key={hero ?? 'overflow'} className="absolute top-0 w-[22px]" style={{ left: icons.length === 1 ? 0 : `calc((100% - 22px) * ${index / (icons.length - 1)})` }}>
          {hero !== null ? <HeroTagLabel heroName={hero} iconClassName="h-[22px] w-[22px]" iconOnly /> : (
            <img src={soulUrn} alt="" aria-hidden="true" draggable={false} className="block h-[22px] w-[22px] object-contain grayscale brightness-50 opacity-70" />
          )}
        </span>
      )).reverse()}
    </span>
  );
}

/** Fit a prefix of the ordered labels, reserving the exact overflow-chip width. */
export function FittingTagList({ labels, chipClassName }: { labels: readonly string[]; chipClassName: string }) {
  const rowRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState({ visibleCount: labels.length, minimumWidth: 0 });
  useLayoutEffect(() => {
    const row = rowRef.current;
    const probe = probeRef.current;
    if (!row || !probe) return;
    const measure = () => {
      const available = row.getBoundingClientRect().width;
      const widths = Array.from(probe.children, child => child.getBoundingClientRect().width);
      if (available <= 0 && widths.every(width => width === 0)) return;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      let used = 0;
      let fitting = 0;
      for (let index = 0; index < labels.length; index++) {
        used += widths[index] + (index > 0 ? gap : 0);
        const remaining = labels.length - index - 1;
        const reserve = remaining > 0 ? gap + widths[labels.length + remaining - 1] : 0;
        if (used + reserve <= available + 0.1) fitting = index + 1;
      }
      const minimumWidth = widths[labels.length * 2 - 1];
      setLayout(previous => previous.visibleCount === fitting && previous.minimumWidth === minimumWidth
        ? previous : { visibleCount: fitting, minimumWidth });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [labels, chipClassName]);
  if (labels.length === 0) return null;
  const shown = labels.slice(0, layout.visibleCount);
  const hidden = labels.slice(layout.visibleCount);
  return (
    <span ref={rowRef} className="relative flex h-[22px] min-w-0 flex-1 items-center gap-1.5" style={{ minWidth: layout.minimumWidth }} data-fitting-tags>
      <span aria-hidden="true" className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <span ref={probeRef} className="flex w-max items-center gap-1.5" data-tag-measure>
          {labels.map(label => <MetaTextChip key={label} label={label} className={`${chipClassName} shrink-0`} />)}
          {labels.map((_, index) => <MetaTextChip key={`overflow-${index}`} label={`+${index + 1}`} className={`${chipClassName} shrink-0`} />)}
        </span>
      </span>
      {shown.map(label => <MetaTextChip key={label} label={label} className={`${chipClassName} shrink-0`} />)}
      {hidden.length > 0 && <MetaTextChip label={`+${hidden.length}`} title={hidden.join('\n')} className={`${chipClassName} shrink-0`} />}
    </span>
  );
}

export function HeroTagLabel({ heroName, iconClassName = 'h-4 w-4', iconOnly = false }: { heroName: string; iconClassName?: string; iconOnly?: boolean }) {
  const src = getHeroChipIconPath(heroName);
  const [failedSrc, setFailedSrc] = useState<string>();
  const showIcon = failedSrc !== src;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle leading-none">
      {showIcon && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className={`${iconClassName} block flex-shrink-0 rounded-full object-cover`}
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      )}
      {iconOnly && showIcon ? <span className="sr-only">{heroName}</span> : <ChipText>{heroName}</ChipText>}
    </span>
  );
}

