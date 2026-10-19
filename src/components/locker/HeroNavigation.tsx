import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../common/ui';
import type { HeroCategory } from '../../lib/lockerUtils';

interface HeroNavigationProps {
  previous: HeroCategory | undefined;
  next: HeroCategory | undefined;
  onNavigate: (hero: HeroCategory) => void;
  enabled: boolean;
  children?: ReactNode;
}

export function HeroNavigation({ previous, next, onNavigate, enabled, children }: HeroNavigationProps) {
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
      const view = navigationRef.current?.closest('[data-locker-hero-view]');
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
    <div ref={navigationRef} className="flex items-center justify-between gap-3">
      <IconButton
        icon={ChevronLeft}
        label={t('locker.hero.previousHero', { hero: previous?.name ?? '' })}
        aria-keyshortcuts="ArrowLeft"
        disabled={!enabled || !previous}
        onClick={() => previous && onNavigate(previous)}
      />
      <div className="flex min-w-0 flex-1 justify-center">{children}</div>
      <IconButton
        icon={ChevronRight}
        label={t('locker.hero.nextHero', { hero: next?.name ?? '' })}
        aria-keyshortcuts="ArrowRight"
        disabled={!enabled || !next}
        onClick={() => next && onNavigate(next)}
      />
    </div>
  );
}
