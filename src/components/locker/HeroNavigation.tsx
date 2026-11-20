import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../common/ui';

interface HeroNavigationProps<Hero extends { name: string }> {
  previous: Hero | undefined;
  next: Hero | undefined;
  onNavigate: (hero: Hero) => void;
  enabled: boolean;
  children?: ReactNode;
  plain?: boolean;
}

export function HeroNavigation<Hero extends { name: string }>({ previous, next, onNavigate, enabled, children, plain = false }: HeroNavigationProps<Hero>) {
  const { t } = useTranslation();
  const navigationRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented || event.repeat || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      ) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"]')) return;
      const target = event.target instanceof Element ? event.target : null;
      const view = navigationRef.current?.closest('[data-locker-hero-view], [data-foundry-hero-view]');
      if (target && target !== document.body && target !== document.documentElement && !view?.contains(target)) return;
      if (target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), canvas, audio, video, [role="slider"], [role="spinbutton"], [role="textbox"], [role="combobox"], [role="radiogroup"], [role="tablist"], [role="tree"], [role="grid"]'
      )) return;
      const hero = event.key === 'ArrowLeft' ? previous : next;
      if (!hero) return;
      event.preventDefault();
      onNavigate(hero);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, next, onNavigate, previous]);

  return (
    <div ref={navigationRef} className={plain ? 'grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2' : 'flex items-center justify-between gap-3'}>
      <IconButton
        className={plain ? 'relative z-10' : undefined}
        tone={plain ? 'ghost' : 'default'}
        icon={ChevronLeft}
        label={t('locker.hero.previousHero', { hero: previous?.name ?? '' })}
        aria-keyshortcuts="ArrowLeft"
        disabled={!enabled || !previous}
        onClick={() => enabled && previous && onNavigate(previous)}
      >
        {plain && <span aria-hidden data-hero-arrow-hitbox className="absolute -inset-y-3 -left-3 -right-20" />}
      </IconButton>
      <div className="flex min-w-0 flex-1 justify-center">{children}</div>
      <IconButton
        className={plain ? 'relative z-10' : undefined}
        tone={plain ? 'ghost' : 'default'}
        icon={ChevronRight}
        label={t('locker.hero.nextHero', { hero: next?.name ?? '' })}
        aria-keyshortcuts="ArrowRight"
        disabled={!enabled || !next}
        onClick={() => enabled && next && onNavigate(next)}
      >
        {plain && <span aria-hidden data-hero-arrow-hitbox className="absolute -inset-y-3 -left-20 -right-3" />}
      </IconButton>
    </div>
  );
}
