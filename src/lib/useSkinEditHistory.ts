import type { RefObject } from 'react';
import type { SkinPartEdit } from '../types/skinEditor';
import { skinEditExportSchema } from './skinEditSchema';
import { useEditHistory } from './useEditHistory';

/** One mounted skin session owns its undo stack; only the current edit set is persisted (useEditHistory). */
export function useSkinEditHistory({ key, initial, disabled, onTravel, root }: {
  key: string; initial: SkinPartEdit[]; disabled: boolean; onTravel: () => void; root: RefObject<HTMLElement | null>;
}) {
  const history = useEditHistory({ key, schema: skinEditExportSchema.shape.edits, initial, disabled, onTravel, root });
  return { ...history, edits: history.value, setEdits: history.setValue };
}
