import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject, type SetStateAction } from 'react';
import { useAppStore } from '../stores/appStore';
import type { SkinPartEdit } from '../types/skinEditor';
import { foundryDraftKey, readFoundryDraft } from './foundryDrafts';
import { skinEditExportSchema } from './skinEditSchema';
import { createSkinEditHistory, recordSkinEdit, redoSkinEdit, undoSkinEdit, type SkinEditInteraction } from './skinEditHistory';
import { useFoundryDraft } from './useFoundryDraft';

function isTextInput(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const input = target.closest('input, textarea, select, [contenteditable]');
  return !!input && (!(input instanceof HTMLInputElement) || !['range', 'button', 'checkbox', 'radio'].includes(input.type));
}

/** One mounted skin session owns its undo stack; only the current edit set is persisted. */
export function useSkinEditHistory({ key, initial, disabled, onTravel, root }: {
  key: string; initial: SkinPartEdit[]; disabled: boolean; onTravel: () => void; root: RefObject<HTMLElement | null>;
}) {
  const schema = skinEditExportSchema.shape.edits;
  const [draft, , persist] = useFoundryDraft(key, schema, initial);
  const scope = useAppStore((state) => state.settings?.devMode && state.settings.devDeadlockPath
    ? state.settings.devDeadlockPath : state.settings?.deadlockPath ?? '');
  const storageKey = foundryDraftKey(scope, key);
  const [state, setState] = useState(() => ({ key: storageKey, history: createSkinEditHistory(draft), changed: false }));
  if (state.key !== storageKey) {
    let restored = initial;
    try { restored = readFoundryDraft(localStorage, storageKey, schema) ?? initial; } catch { /* Match the draft reader's unavailable-storage behavior. */ }
    setState({ key: storageKey, history: createSkinEditHistory(restored), changed: false });
  }
  useLayoutEffect(() => {
    if (state.key === storageKey && state.changed) persist(state.history.present);
  }, [state.key, state.history.present, state.changed, storageKey, persist]);

  const setEdits = useCallback((next: SetStateAction<SkinPartEdit[]>) => setState((current) => {
    const edits = typeof next === 'function' ? next(current.history.present) : next;
    const history = recordSkinEdit(current.history, edits);
    return history === current.history ? current : { ...current, history, changed: true };
  }), []);
  const begin = useCallback((kind: SkinEditInteraction) => setState((current) => current.history.interaction?.kind === kind ? current
    : { ...current, history: { ...current.history, interaction: { kind, recorded: false } } }), []);
  const end = useCallback((kind: SkinEditInteraction) => setState((current) => current.history.interaction?.kind === kind
    ? { ...current, history: { ...current.history, interaction: null } } : current), []);
  const travel = useCallback((redo: boolean) => {
    if (disabled || !(redo ? state.history.future.length : state.history.past.length)) return false;
    setState((current) => ({ ...current, history: (redo ? redoSkinEdit : undoSkinEdit)(current.history), changed: true }));
    onTravel();
    return true;
  }, [disabled, state.history.future.length, state.history.past.length, onTravel]);
  const keydown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)
      || (event.key.toLowerCase() !== 'z' && event.code !== 'KeyZ') || isTextInput(event.target)) return;
    const target = event.target;
    if (!(target instanceof Node) || !(root.current?.contains(target) || target === document.body || target === document.documentElement)) return;
    if (travel(event.shiftKey)) event.preventDefault();
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
    edits: state.history.present, setEdits,
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
