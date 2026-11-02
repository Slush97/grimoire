import type { SkinPartEdit } from '../types/skinEditor';

export type SkinEditInteraction = 'pointer' | 'keyboard' | 'input';
export interface SkinEditHistory {
  past: SkinPartEdit[][];
  present: SkinPartEdit[];
  future: SkinPartEdit[][];
  interaction: { kind: SkinEditInteraction; recorded: boolean } | null;
}

export function createSkinEditHistory(edits: SkinPartEdit[]): SkinEditHistory {
  return { past: [], present: edits, future: [], interaction: null };
}

export function recordSkinEdit(history: SkinEditHistory, edits: SkinPartEdit[]): SkinEditHistory {
  if (JSON.stringify(history.present) === JSON.stringify(edits)) return history;
  return {
    past: history.interaction?.recorded ? history.past : [...history.past, history.present].slice(-100),
    present: edits,
    future: [],
    interaction: history.interaction ? { ...history.interaction, recorded: true } : null,
  };
}

export function undoSkinEdit(history: SkinEditHistory): SkinEditHistory {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], interaction: null } : history;
}

export function redoSkinEdit(history: SkinEditHistory): SkinEditHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1), interaction: null } : history;
}
