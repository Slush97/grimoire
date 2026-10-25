import type { ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { entryName, type ModEntry } from '../../lib/modEntries';
import { isModCardDragTarget } from './cardDragSurface';

export function InstalledListEntryDrag({ entry, id, disabled, arriving, children }: {
  entry: ModEntry;
  id: string;
  disabled: boolean;
  arriving: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id, disabled });
  return <div ref={setNodeRef}
    className={`relative min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'opacity-30' : ''} ${arriving ? 'mod-list-arrival' : ''}`}
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
