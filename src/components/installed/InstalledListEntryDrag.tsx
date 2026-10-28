import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useSortable, type AnimateLayoutChanges } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { entryDisabledPreferenceKey, entryName, type ModEntry } from '../../lib/modEntries';
import { listSlotId } from '../../lib/modListDrag';
import { isModCardDragTarget } from './cardDragSurface';

export interface ListArrivalPoint { left: number; top: number }
export interface ListSourceSlot { groupId: string; index: number; over: boolean }
const sortingTransition = { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
const animateListLayout: AnimateLayoutChanges = ({ isSorting, wasDragging, transition }) => !!transition && (isSorting || wasDragging);
const dashedClasses = 'flex items-center justify-center rounded-xl border-2 border-dashed [overflow-anchor:none]';
const addCardClasses = 'relative ' + dashedClasses;
const slotClasses = (over: boolean) => over ? 'border-accent/60 bg-accent/5 text-accent/80' : 'border-border text-text-tertiary';

export function InstalledListAddCard({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" data-list-empty-add aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={addCardClasses + ' h-18 w-full cursor-pointer border-border text-text-tertiary transition-colors hover:border-accent/60 hover:bg-accent/5 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'}>
    <Plus className="h-8 w-8" aria-hidden />
  </button>;
}

export function InstalledListDropSlot({ groupId, index, height, over }: { groupId: string; index: number; height: number; over: boolean }) {
  const { setNodeRef, transform, transition } = useSortable({ id: listSlotId(groupId), disabled: { draggable: true },
    animateLayoutChanges: animateListLayout, transition: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : sortingTransition });
  return <div ref={setNodeRef} data-list-drop-slot={groupId} data-drop-index={index} aria-hidden
    style={{ height, transform: CSS.Transform.toString(transform), transition }}
    className={addCardClasses + ' pointer-events-none ' + slotClasses(over)}>
    <Plus className="h-8 w-8" aria-hidden />
  </div>;
}

// The dragged card stays mounted in its own cell as the source list's slot, so
// the virtual grid keeps its row and dnd-kit keeps its node.
export function InstalledListEntryDrag({ entry, id, disabled, arriving, arrivalFrom, slot, children }: {
  entry: ModEntry;
  id: string;
  disabled: boolean;
  arriving: boolean;
  arrivalFrom: ListArrivalPoint | null;
  slot: ListSourceSlot | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, attributes, listeners, isDragging, transform, transition } = useSortable({ id, disabled,
    animateLayoutChanges: animateListLayout, transition: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : sortingTransition });
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
  const holdsSlot = isDragging && slot;
  return <div ref={setRef}
    aria-hidden={isDragging || undefined}
    data-list-drag-source={isDragging || undefined}
    data-list-drop-slot={holdsSlot ? slot.groupId : undefined}
    data-drop-index={holdsSlot ? slot.index : undefined}
    style={{ transform: CSS.Transform.toString(transform), transition, visibility: isDragging ? 'hidden' : undefined }}
    className={`relative min-w-0 rounded-xl [overflow-anchor:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${arriving ? 'mod-list-arrival z-30' : ''}`}
    data-list-drag-entry={entry.key}
    data-list-member-key={entryDisabledPreferenceKey(entry)}
    data-list-drag-id={id}
    {...(disabled ? {} : attributes)} {...(disabled ? {} : listeners)}
    onPointerDown={disabled ? undefined : (event) => {
      if (isModCardDragTarget(event.target, event.currentTarget)) listeners?.onPointerDown?.(event);
    }}
    aria-label={disabled ? undefined : t('installed.lists.moveMod', { name: entryName(entry) })}>
    {children}
    {holdsSlot && <div aria-hidden className={dashedClasses + ' visible pointer-events-none absolute inset-0 ' + slotClasses(slot.over)}>
      <Plus className="h-8 w-8" aria-hidden />
    </div>}
  </div>;
}
