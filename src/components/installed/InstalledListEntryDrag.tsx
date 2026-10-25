import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { entryName, type ModEntry } from '../../lib/modEntries';
import { isModCardDragTarget } from './cardDragSurface';

export interface ListArrivalPoint { left: number; top: number }

export function InstalledListEntryDrag({ entry, id, disabled, arriving, arrivalFrom, children }: {
  entry: ModEntry;
  id: string;
  disabled: boolean;
  arriving: boolean;
  arrivalFrom: ListArrivalPoint | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id, disabled });
  const ref = useRef<HTMLDivElement>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => { ref.current = node; setNodeRef(node); }, [setNodeRef]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!arriving || !node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = node.getBoundingClientRect();
    const x = arrivalFrom ? arrivalFrom.left - target.left : 0;
    const y = arrivalFrom ? arrivalFrom.top - target.top : 2;
    const animation = node.animate([
      { opacity: 1, transform: `translate3d(${x}px, ${y}px, 0) scale(1.015)` },
      { opacity: 1, transform: 'none' },
    ], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    return () => animation.cancel();
  }, [arriving, arrivalFrom]);
  return <div ref={setRef}
    className={`relative min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'opacity-30' : ''} ${arriving ? 'mod-list-arrival z-30' : ''}`}
    data-list-drag-entry={entry.key}
    data-list-drag-id={id}
    {...(disabled ? {} : attributes)} {...(disabled ? {} : listeners)}
    onPointerDown={disabled ? undefined : (event) => {
      if (isModCardDragTarget(event.target, event.currentTarget)) listeners?.onPointerDown?.(event);
    }}
    aria-label={disabled ? undefined : t('installed.lists.moveMod', { name: entryName(entry) })}>
    {children}
  </div>;
}
