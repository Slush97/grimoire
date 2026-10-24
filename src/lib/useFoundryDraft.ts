import { useCallback, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { showToast } from '../stores/toastStore';
import { foundryDraftKey, readFoundryDraft, writeFoundryDraft } from './foundryDrafts';

let reportedStorageFailure = false;

/** Persist committed input before a subsequent click can unmount the editor. */
export function useFoundryDraft<T>(key: string, schema: z.ZodType<T>, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { t } = useTranslation();
  const scope = useAppStore((state) => state.settings?.devMode && state.settings.devDeadlockPath
    ? state.settings.devDeadlockPath : state.settings?.deadlockPath ?? '');
  const storageKey = foundryDraftKey(scope, key);
  const read = () => {
    try { return readFoundryDraft(localStorage, storageKey, schema) ?? initial; }
    catch { return initial; }
  };
  const [state, setState] = useState(() => ({ key: storageKey, value: read(), changed: false }));
  if (state.key !== storageKey) setState({ key: storageKey, value: read(), changed: false });
  useLayoutEffect(() => {
    if (state.key !== storageKey || !state.changed) return;
    let saved = false;
    try { saved = writeFoundryDraft(localStorage, storageKey, state.value); } catch { /* Storage may be unavailable. */ }
    if (!saved && !reportedStorageFailure) {
      reportedStorageFailure = true;
      showToast(t('foundry.draft.failed'), { tone: 'error' });
    }
  }, [state, storageKey, t]);
  const update: Dispatch<SetStateAction<T>> = useCallback((next) => setState((current) => ({ key: storageKey, changed: true,
    value: typeof next === 'function' ? (next as (value: T) => T)(current.value) : next })), [storageKey]);
  return [state.value, update];
}
