/**
 * Drag-to-reorder for the profile cards. The order is the order profiles are
 * stored in, so the Installed page's profile menu follows it too.
 *
 * A card is only dragged by its grip, which takes the place of the card's
 * icon. The rest of the card is buttons, a rename field and a scrolling mod
 * list, and none of those should start a drag.
 */
import type { ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../common/ui';

interface SortableProfileGridProps {
  profiles: readonly { id: string; name: string }[];
  /** Receives every profile id in the new order. */
  onReorder: (orderedIds: string[]) => void;
  className?: string;
  children: ReactNode;
}

export function SortableProfileGrid({ profiles, onReorder, className, children }: SortableProfileGridProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = profiles.map((profile) => profile.id);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        screenReaderInstructions: { draggable: t('profiles.reorder.instructions') },
        announcements: {
          onDragStart: ({ active }) => t('profiles.reorder.pickedUp', { name: profiles.find((profile) => profile.id === active.id)?.name }),
          onDragOver: ({ over }) => over ? t('installed.lists.dragPosition', { position: ids.indexOf(String(over.id)) + 1, count: ids.length }) : undefined,
          onDragEnd: () => t('profiles.reorder.saved'),
          onDragCancel: () => t('installed.lists.reorderCancelled'),
        },
      }}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from !== -1 && to !== -1) onReorder(arrayMove(ids, from, to));
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

interface SortableProfileProps {
  id: string;
  name: string;
  /** No grip: a lone profile has nowhere to go. */
  disabled?: boolean;
  children: (drag: { handle: ReactNode; dragging: boolean }) => ReactNode;
}

export function SortableProfile({ id, name, disabled = false, children }: SortableProfileProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle = disabled ? null : (
    <IconButton
      ref={setActivatorNodeRef}
      icon={GripVertical}
      size="sm"
      tone="ghost"
      label={t('profiles.reorder.handle', { name })}
      className="-mx-1.5 touch-none cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    />
  );
  return (
    // Translate only: cards differ in height once one is expanded, and the
    // default transform would stretch the dragged card to its neighbor's size.
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`min-w-0 ${isDragging ? 'relative z-10' : ''}`}
    >
      {children({ handle, dragging: isDragging })}
    </div>
  );
}
