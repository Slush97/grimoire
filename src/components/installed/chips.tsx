import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CameraOff, FileWarning } from 'lucide-react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';
import type { Mod } from '../../types/mod';
import soulUrn from '../../assets/soul-urn.png';

// Shared geometry and neutral colors for Installed cards and import tag controls.
export const MOD_TAG_CHIP_CLASS = 'inline-flex h-[22px] min-w-0 items-center overflow-hidden rounded-md px-1.5 text-2xs font-semibold leading-none';
export const MOD_TAG_SURFACE_CLASS = 'border border-hl/[0.06] bg-bg-tertiary/65 text-text-secondary/80';

export function ChipText({ children }: { children: ReactNode }) {
  return <span className="relative top-[1.5px] min-w-0 truncate leading-[14px]">{children}</span>;
}

export function MetaTextChip({ label, className, title }: { label: string; className: string; title?: string }) {
  return <span className={className} title={title ?? label}><ChipText>{label}</ChipText></span>;
}

function OverlappingIcons({ items, maxWidth, title, iconSize = 22, ...attributes }: {
  items: { id: string; content: ReactNode; title?: string }[];
  maxWidth: number;
  title: string;
  iconSize?: 16 | 20 | 22;
} & HTMLAttributes<HTMLSpanElement>) {
  if (items.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className="relative isolate inline-block shrink-0"
      style={{ width: Math.min(maxWidth, items.length * iconSize), height: iconSize, minWidth: iconSize }}
      {...attributes}
    >
      {items.map((item, index) => (
        <span key={item.id} title={item.title} className="absolute top-0 flex items-center" style={{ width: iconSize, height: iconSize, left: items.length === 1 ? 0 : `calc((100% - ${iconSize}px) * ${index / (items.length - 1)})` }}>
          {item.content}
        </span>
      )).reverse()}
    </span>
  );
}

/** Earlier heroes paint in front; the overflow urn stays behind every hero. */
export function HeroIconStack({ heroes, maxVisible = 6, iconSize = 22, maxWidth = 66 }: {
  heroes: readonly string[]; maxVisible?: number; iconSize?: 16 | 20 | 22; maxWidth?: number;
}) {
  const icons = heroes.length > maxVisible ? [...heroes.slice(0, maxVisible - 1), null] : heroes;
  const iconClassName = iconSize === 16 ? 'h-4 w-4' : iconSize === 20 ? 'h-5 w-5' : 'h-[22px] w-[22px]';
  return <OverlappingIcons data-hero-stack maxWidth={maxWidth} iconSize={iconSize} title={heroes.join(', ')} items={icons.map(hero => ({
    id: hero ?? 'overflow',
    content: hero !== null ? <HeroTagLabel heroName={hero} iconClassName={iconClassName} iconOnly /> : (
      <img src={soulUrn} alt="" aria-hidden="true" draggable={false} className={`block ${iconClassName} object-contain grayscale brightness-50 opacity-70`} />
    ),
  }))} />;
}

export function RepairIssueIcons({ outdated, enabled, models, requirement }: {
  outdated?: Mod['outdatedVdata']; enabled: boolean; models?: Mod['staleModels'];
  requirement?: { icon: ReactNode; title: string };
}) {
  const { t } = useTranslation();
  const items: { id: string; title: string; content: ReactNode }[] = [];
  if (outdated?.length) items.push({
    id: 'data',
    title: outdated.map(v => t('installed.card.outdatedDataTitle', { count: v.missing, file: v.entry, sample: v.sample.join(', ') })).join('\n\n'),
    content: <span className="flex h-[22px] w-[22px] items-center justify-center"><FileWarning aria-hidden className={`h-4 w-4 ${enabled ? 'text-state-danger' : 'text-state-warning'}`} /></span>,
  });
  if (models?.length) items.push({
    id: 'camera',
    title: t('installed.card.staleModelTitle', { files: models.map(m => m.entry.slice(m.entry.lastIndexOf('/') + 1).replace(/_c$/, '')).join(', ') }),
    content: <span className="flex h-[22px] w-[22px] items-center justify-center"><CameraOff aria-hidden className="h-4 w-4 text-state-warning" /></span>,
  });
  if (requirement?.icon) items.push({ id: 'requirements', title: requirement.title, content: requirement.icon });
  return <OverlappingIcons data-issue-stack role={requirement?.icon ? 'group' : 'img'} maxWidth={110}
    title={items.map(item => item.title).join('\n\n')} items={items} />;
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

