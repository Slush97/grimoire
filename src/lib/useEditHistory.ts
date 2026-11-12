import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject, type SetStateAction } from 'react';
import type { z } from 'zod';
import { useAppStore } from '../stores/appStore';
import { beginInteraction, endInteraction, recordEdit, redoEdit, resumeEditHistory, undoEdit, type EditHistory, type EditInteraction } from './editHistory';
import { foundryDraftKey, foundryDraftScope, readFoundryDraft } from './foundryDrafts';
import { useFoundryDraft } from './useFoundryDraft';

function isTextInput(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const input = target.closest('input, textarea, select, [contenteditable]');
  return !!input && (!(input instanceof HTMLInputElement) || !['range', 'button', 'checkbox', 'radio'].includes(input.type));
}

/** Histories kept for the session by draft (`session`), so a remounted editor picks up where it was. */
const sessionHistories = new Map<string, EditHistory<unknown>>();

/**
 * A Foundry draft value with undo and redo. Only the present value is persisted (as useFoundryDraft
 * does); the steps live in memory, for the mounted editor, or for the session with `session`.
 * Continuous input is one step: a pointer drag on a slider or colour picker (onPointerDownCapture),
 * arrow keys held on a slider (onKeyDownCapture), typing in a field until it loses focus
 * (onFocusCapture / onBlurCapture). Ctrl+Z / Cmd+Z undo and Ctrl+Shift+Z / Cmd+Shift+Z redo (and
 * Ctrl+Y with `redoWithY`) inside `root`, never while a text field has the focus.
 */
export function useEditHistory<T>({ key, schema, initial, disabled, onTravel, root, session = false, redoWithY = false }: {
  key: string; schema: z.ZodType<T, z.ZodTypeDef, unknown>; initial: T; disabled: boolean; onTravel?: () => void; root: RefObject<HTMLElement | null>;
  /** Keep the steps for the session, across remounts of the editor. */
  session?: boolean;
  /** Ctrl+Y / Cmd+Y redo too. */
  redoWithY?: boolean;
}) {
  const [draft, , persist] = useFoundryDraft(key, schema, initial);
  const scope = useAppStore((state) => foundryDraftScope(state.settings));
  const storageKey = foundryDraftKey(scope, key);
  // The session's steps when they lead to the persisted value; a fresh history at it otherwise
  const start = (value: T): EditHistory<T> => resumeEditHistory(session ? sessionHistories.get(storageKey) as EditHistory<T> | undefined : undefined, value);
  const [state, setState] = useState(() => ({ key: storageKey, history: start(draft), changed: false }));
  if (state.key !== storageKey) {
    let restored = initial;
    try { restored = readFoundryDraft(localStorage, storageKey, schema) ?? initial; } catch { /* Match the draft reader's unavailable-storage behavior. */ }
    setState({ key: storageKey, history: start(restored), changed: false });
  }
  useLayoutEffect(() => {
    if (state.key === storageKey && state.changed) persist(state.history.present);
  }, [state.key, state.history.present, state.changed, storageKey, persist]);
  useEffect(() => {
    if (session && state.key === storageKey) sessionHistories.set(storageKey, state.history);
  }, [session, state.key, state.history, storageKey]);

  const setValue = useCallback((next: SetStateAction<T>) => setState((current) => {
    const value = typeof next === 'function' ? (next as (value: T) => T)(current.history.present) : next;
    const history = recordEdit(current.history, value);
    return history === current.history ? current : { ...current, history, changed: true };
  }), []);
  const begin = useCallback((kind: EditInteraction) => setState((current) => {
    const history = beginInteraction(current.history, kind);
    return history === current.history ? current : { ...current, history };
  }), []);
  const end = useCallback((kind: EditInteraction) => setState((current) => {
    const history = endInteraction(current.history, kind);
    return history === current.history ? current : { ...current, history };
  }), []);
  const travel = useCallback((redo: boolean) => {
    if (disabled || !(redo ? state.history.future.length : state.history.past.length)) return false;
    setState((current) => ({ ...current, history: (redo ? redoEdit : undoEdit)(current.history), changed: true }));
    onTravel?.();
    return true;
  }, [disabled, state.history.future.length, state.history.past.length, onTravel]);
  const keydown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || isTextInput(event.target)) return;
    const z = event.key.toLowerCase() === 'z' || event.code === 'KeyZ';
    const y = redoWithY && !event.shiftKey && (event.key.toLowerCase() === 'y' || event.code === 'KeyY');
    if (!z && !y) return;
    const target = event.target;
    if (!(target instanceof Node) || !(root.current?.contains(target) || target === document.body || target === document.documentElement)) return;
    if (travel(y || event.shiftKey)) event.preventDefault();
  });
  useEffect(() => {
    const pointerEnd = () => end('pointer');
    const keyboardEnd = () => end('keyboard');
    const blur = () => { end('pointer'); end('keyboard'); end('input'); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyboardEnd);
    window.addEventListener('pointerup', pointerEnd);
    window.addEventListener('pointercancel', pointerEnd);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyboardEnd);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      window.removeEventListener('blur', blur);
    };
  }, [end]);

  return {
    value: state.history.present, setValue,
    canUndo: !disabled && state.history.past.length > 0,
    canRedo: !disabled && state.history.future.length > 0,
    undo: () => { travel(false); }, redo: () => { travel(true); },
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest('input[type="range"], [role="slider"], .react-colorful')) begin('pointer');
    },
    onFocusCapture: (event: React.FocusEvent<HTMLElement>) => { if (isTextInput(event.target)) begin('input'); },
    onBlurCapture: () => end('input'),
    onKeyDownCapture: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!event.ctrlKey && !event.metaKey && event.target instanceof Element && event.target.closest('input[type="range"], [role="slider"]')
        && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) begin('keyboard');
    },
  };
}
