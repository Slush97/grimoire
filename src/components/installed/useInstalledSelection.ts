import { useRef, useState } from 'react';
import { useStableCallback } from '../../lib/useStableCallback';
import { selectEntryRange, type SelectionEntry } from './selection';

export function useInstalledSelection(getVisibleEntries: () => readonly SelectionEntry[]) {
  const [selectedIds, setIds] = useState<Set<string>>(new Set());
  const anchorKey = useRef<string | null>(null);
  const setSelectedIds = useStableCallback((ids: Set<string>) => {
    anchorKey.current = null;
    setIds(ids);
  });
  const toggleSelection = useStableCallback((target: SelectionEntry, shiftKey: boolean) => {
    const entries = getVisibleEntries();
    const anchor = anchorKey.current;
    setIds((previous) => selectEntryRange(previous, entries, anchor, target, shiftKey));
    if (!shiftKey || !entries.some((entry) => entry.key === anchor)) {
      anchorKey.current = target.key;
    }
  });
  return { selectedIds, setSelectedIds, toggleSelection };
}
