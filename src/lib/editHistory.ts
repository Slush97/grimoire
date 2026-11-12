// Undo and redo for one draft value (a skin's part edits, a movement effect's choice). Pure: the
// value is replaced whole on every edit, and continuous input (a slider or colour-picker drag, held
// arrow keys, typing in a field) inside one interaction is recorded as a single step.

/** What a continuous change is coming from; one interaction of a kind is one undo step. */
export type EditInteraction = 'pointer' | 'keyboard' | 'input';

export interface EditHistory<T> {
  past: T[];
  present: T;
  future: T[];
  /** The interaction under way, and whether it has recorded its step yet. */
  interaction: { kind: EditInteraction; recorded: boolean } | null;
}

/** How many steps back a history keeps. */
export const EDIT_HISTORY_LIMIT = 100;

/** Values are compared as JSON: a draft is plain data. */
export const sameEditValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A history at `value`, which is also the first undo boundary. */
export function createEditHistory<T>(value: T): EditHistory<T> {
  return { past: [], present: value, future: [], interaction: null };
}

/**
 * `value` as the present. The value before it becomes an undo step, unless the interaction under way
 * already recorded one (the rest of a drag joins it). A new edit drops the redo steps.
 */
export function recordEdit<T>(history: EditHistory<T>, value: T): EditHistory<T> {
  if (sameEditValue(history.present, value)) return history;
  return {
    past: history.interaction?.recorded ? history.past : [...history.past, history.present].slice(-EDIT_HISTORY_LIMIT),
    present: value,
    future: [],
    interaction: history.interaction ? { ...history.interaction, recorded: true } : null,
  };
}

export function undoEdit<T>(history: EditHistory<T>): EditHistory<T> {
  const previous = history.past.at(-1);
  return previous === undefined ? history
    : { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], interaction: null };
}

export function redoEdit<T>(history: EditHistory<T>): EditHistory<T> {
  if (history.future.length === 0) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1), interaction: null };
}

/** Starts an interaction of `kind`: its edits until it ends are one step. */
export function beginInteraction<T>(history: EditHistory<T>, kind: EditInteraction): EditHistory<T> {
  return history.interaction?.kind === kind ? history : { ...history, interaction: { kind, recorded: false } };
}

/** Ends an interaction of `kind`; the next edit is a step of its own. */
export function endInteraction<T>(history: EditHistory<T>, kind: EditInteraction): EditHistory<T> {
  return history.interaction?.kind === kind ? { ...history, interaction: null } : history;
}

/**
 * A history kept from earlier in the session (an editor mounted again) resumes when it leads to the
 * persisted value; otherwise (the draft changed elsewhere) the history starts afresh there.
 */
export function resumeEditHistory<T>(kept: EditHistory<T> | undefined, value: T): EditHistory<T> {
  return kept && sameEditValue(kept.present, value) ? { ...kept, interaction: null } : createEditHistory(value);
}
