import { useCallback, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { showToast } from '../stores/toastStore';
import { foundryDraftKey, foundryDraftScope, readFoundryDraft, writeFoundryDraft } from './foundryDrafts';

let reportedStorageFailure = false;

/** Persist committed input before a subsequent click can unmount the editor. */
export function useFoundryDraft<T>(key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, initial: T): [T, Dispatch<SetStateAction<T>>, (value: T) => void] {
  const { t } = useTranslation();
  const scope = useAppStore((state) => foundryDraftScope(state.settings));
  const storageKey = foundryDraftKey(scope, key);
  const read = () => {
    try { return readFoundryDraft(localStorage, storageKey, schema) ?? initial; }
    catch { return initial; }
  };
  const [state, setState] = useState(() => ({ key: storageKey, value: read(), changed: false }));
  if (state.key !== storageKey) setState({ key: storageKey, value: read(), changed: false });
  // Imperative camera movement does not need to rerender the model to save it.
  const persist = useCallback((value: T) => {
    let saved = false;
    try { saved = writeFoundryDraft(localStorage, storageKey, value); } catch { /* Storage may be unavailable. */ }
    if (!saved && !reportedStorageFailure) {
      reportedStorageFailure = true;
      showToast(t('foundry.draft.failed'), { tone: 'error' });
    }
  }, [storageKey, t]);
  useLayoutEffect(() => {
    if (state.key === storageKey && state.changed) persist(state.value);
  }, [state, storageKey, persist]);
  const update: Dispatch<SetStateAction<T>> = useCallback((next) => setState((current) => ({ key: storageKey, changed: true,
    value: typeof next === 'function' ? (next as (value: T) => T)(current.value) : next })), [storageKey]);
  return [state.value, update, persist];
}
