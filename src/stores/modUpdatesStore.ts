import { create } from 'zustand';
import type { ModUpdateState } from '../types/modUpdates';
import { startModUpdates } from '../lib/api';
import { updateCheckCache } from '../lib/updateCheckCache';
import { useAppStore } from './appStore';

const EMPTY_STATE: ModUpdateState = {
  busy: false,
  preparing: false,
  manualRequests: [],
  errors: [],
  revision: 0,
  affectedModIds: [],
  updatingModIds: [],
};

interface ModUpdatesStore {
  state: ModUpdateState;
  submittingModIds: ReadonlySet<string>;
  selectedRequestId: string | null;
  dismissedNotices: ReadonlySet<string>;
  start: (modIds: string[]) => Promise<void>;
  openRequest: (id: string) => void;
  closeRequest: () => void;
  dismissNotice: (id: string) => void;
}

export const useModUpdatesStore = create<ModUpdatesStore>((set, get) => ({
  state: EMPTY_STATE,
  submittingModIds: new Set(),
  selectedRequestId: null,
  dismissedNotices: new Set(),
  start: async (modIds) => {
    const current = get();
    const reserved = new Set([...current.state.updatingModIds, ...current.submittingModIds]);
    const pendingIds = [...new Set(modIds)].filter(id => !reserved.has(id));
    if (pendingIds.length === 0) return;
    set({ submittingModIds: new Set([...current.submittingModIds, ...pendingIds]) });
    try {
      await startModUpdates({ modIds: pendingIds });
    } finally {
      set(current => {
        const submittingModIds = new Set(current.submittingModIds);
        for (const id of pendingIds) submittingModIds.delete(id);
        return { submittingModIds };
      });
    }
  },
  openRequest: (id) => set({ selectedRequestId: id }),
  closeRequest: () => set({ selectedRequestId: null }),
  dismissNotice: (id) => set((state) => ({ dismissedNotices: new Set([...state.dismissedNotices, id]) })),
}));

/** Layout owns the subscription so updates and replacement choices survive navigation. */
export function listenForModUpdates(): () => void {
  let active = true;
  let receivedEvent = false;
  const apply = (state: ModUpdateState) => {
    if (!active) return;
    const previous = useModUpdatesStore.getState();
    useModUpdatesStore.setState({
      state,
      selectedRequestId: state.manualRequests.some((request) => request.id === previous.selectedRequestId)
        ? previous.selectedRequestId
        : null,
    });
    if (!state.busy && (previous.state.busy || state.revision !== previous.state.revision)) {
      updateCheckCache.invalidate(state.affectedModIds);
    }
    const settled = previous.state.busy && !state.busy;
    if (state.revision !== previous.state.revision || settled) {
      // Keep completed replacements visible even while manual choices remain.
      void useAppStore.getState().loadMods({ silent: true, afterCurrent: true });
    }
  };
  const unsubscribe = window.electronAPI.onModUpdateStateUpdated((state) => {
    receivedEvent = true;
    apply(state);
  });
  void window.electronAPI.getModUpdateState().then((state) => {
    if (!receivedEvent) apply(state);
  }).catch((error) => console.error('[ModUpdates] Failed to load update state:', error));
  return () => {
    active = false;
    unsubscribe();
  };
}
