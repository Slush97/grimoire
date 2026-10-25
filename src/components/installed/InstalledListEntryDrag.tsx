import { useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../common/ui';
import { entryDisabledPreferenceKey, entryName, type ModEntry } from '../../lib/modEntries';
import { MOD_LIST_DRAG_TYPE } from '../../lib/modListDrag';

export function InstalledListEntryDrag({ entry, disabled, onPick, children }: {
  entry: ModEntry;
  disabled: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div ref={ref} className={`group/list-entry relative min-w-0 ${dragging ? 'opacity-50' : ''}`} data-list-drag-entry={entry.key}>
    {children}
    {!disabled && <IconButton icon={GripVertical} size="sm" label={t('installed.lists.fileMod', { name: entryName(entry) })}
      draggable onClick={onPick}
      className="absolute left-1/2 top-2 z-20 -translate-x-1/2 cursor-grab bg-bg-secondary opacity-0 group-hover/list-entry:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData(MOD_LIST_DRAG_TYPE, JSON.stringify({ kind: 'entry', key: entryDisabledPreferenceKey(entry) }));
        event.dataTransfer.effectAllowed = 'copy';
        if (ref.current) event.dataTransfer.setDragImage(ref.current, 40, 28);
        setDragging(true);
      }} onDragEnd={() => setDragging(false)} />}
  </div>;
}
