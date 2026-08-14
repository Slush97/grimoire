import { useSyncExternalStore } from 'react';
import type { DownloadQueueItem } from '../types/electron';

export interface DownloadActivitySnapshot {
  current: DownloadQueueItem | null;
  queue: DownloadQueueItem[];
  requested: DownloadQueueItem[];
  progress: { downloaded: number; total: number } | null;
  extracting: boolean;
}

/** Queue membership only, excluding high-frequency byte progress. */
export type DownloadQueueActivitySnapshot = Pick<
  DownloadActivitySnapshot,
  'current' | 'queue' | 'requested'
>;

export type FileDownloadActivity =
  | { phase: 'idle' }
  | { phase: 'starting'; progress: null }
  | { phase: 'downloading'; progress: { downloaded: number; total: number } | null }
  | { phase: 'extracting'; progress: { downloaded: number; total: number } | null }
  | { phase: 'queued'; position: number };

const EMPTY_SNAPSHOT: DownloadActivitySnapshot = {
  current: null,
  queue: [],
  requested: [],
  progress: null,
  extracting: false,
};

let snapshot = EMPTY_SNAPSHOT;
let queueSnapshot: DownloadQueueActivitySnapshot = {
  current: snapshot.current,
  queue: snapshot.queue,
  requested: snapshot.requested,
};
let subscribers = 0;
// Only backend lifecycle events invalidate an in-flight hydration read.
// Progress/extracting ticks update presentation state but say nothing about
// whether the queue/current IPC response is stale.
let backendRevision = 0;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

const targetKey = (modId: number, fileId: number) => `${modId}:${fileId}`;
const itemKey = (item: Pick<DownloadQueueItem, 'modId' | 'fileId'>) =>
  targetKey(item.modId, item.fileId);

function publish(next: DownloadActivitySnapshot) {
  if (
    next.current !== snapshot.current ||
    next.queue !== snapshot.queue ||
    next.requested !== snapshot.requested
  ) {
    queueSnapshot = {
      current: next.current,
      queue: next.queue,
      requested: next.requested,
    };
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

export function applyDownloadProgress(
  state: DownloadActivitySnapshot,
  data: { modId: number; fileId: number; downloaded: number; total: number },
): DownloadActivitySnapshot {
  if (!state.current || itemKey(state.current) !== targetKey(data.modId, data.fileId)) return state;
  return {
    ...state,
    progress: { downloaded: data.downloaded, total: data.total },
    extracting: false,
  };
}

export function applyDownloadExtracting(
  state: DownloadActivitySnapshot,
  data: { modId: number; fileId: number },
): DownloadActivitySnapshot {
  if (!state.current || itemKey(state.current) !== targetKey(data.modId, data.fileId)) return state;
  return { ...state, extracting: true };
}

function beginListening() {
  if (stopListening || typeof window === 'undefined') return;

  const hydrationRevision = backendRevision;
  void Promise.all([
    window.electronAPI.getDownloadQueue(),
    window.electronAPI.getCurrentDownload(),
  ]).then(([queue, current]) => {
    // An event that arrived while these IPC reads were in flight is newer than
    // the hydration response and must win.
    if (backendRevision !== hydrationRevision) return;
    const currentKey = current ? itemKey(current) : null;
    // The two IPC reads are concurrent, so the queue read can observe an item
    // just before it is shifted while the current read observes it just after.
    const hydratedQueue = currentKey ? queue.filter((item) => itemKey(item) !== currentKey) : queue;
    const backendKeys = new Set([...hydratedQueue, ...(current ? [current] : [])].map(itemKey));
    const switched = itemKey(snapshot.current ?? { modId: 0, fileId: 0 }) !==
      itemKey(current ?? { modId: 0, fileId: 0 });
    publish({
      ...snapshot,
      queue: hydratedQueue,
      current,
      requested: snapshot.requested.filter((item) => !backendKeys.has(itemKey(item))),
      progress: switched ? null : snapshot.progress,
      extracting: switched ? false : snapshot.extracting,
    });
  }).catch((error) => {
    console.error('[DownloadActivity] Failed to hydrate queue state:', error);
  });

  const queueUnsub = window.electronAPI.onDownloadQueueUpdated((data) => {
    backendRevision += 1;
    const backendKeys = new Set(
      [...data.queue, ...(data.currentDownload ? [data.currentDownload] : [])].map(itemKey),
    );
    const switched = itemKey(snapshot.current ?? { modId: 0, fileId: 0 }) !==
      itemKey(data.currentDownload ?? { modId: 0, fileId: 0 });
    publish({
      current: data.currentDownload,
      queue: data.queue,
      requested: snapshot.requested.filter((item) => !backendKeys.has(itemKey(item))),
      progress: switched ? null : snapshot.progress,
      extracting: switched ? false : snapshot.extracting,
    });
  });

  const progressUnsub = window.electronAPI.onDownloadProgress((data) => {
    const next = applyDownloadProgress(snapshot, data);
    if (next !== snapshot) publish(next);
  });

  const extractingUnsub = window.electronAPI.onDownloadExtracting((data) => {
    const next = applyDownloadExtracting(snapshot, data);
    if (next !== snapshot) publish(next);
  });

  const settle = (modId: number, fileId: number) => {
    backendRevision += 1;
    const key = targetKey(modId, fileId);
    publish({
      ...snapshot,
      requested: snapshot.requested.filter((item) => itemKey(item) !== key),
      progress: snapshot.current && itemKey(snapshot.current) === key ? null : snapshot.progress,
      extracting: snapshot.current && itemKey(snapshot.current) === key ? false : snapshot.extracting,
    });
  };
  const completeUnsub = window.electronAPI.onDownloadComplete(({ modId, fileId }) => settle(modId, fileId));
  const errorUnsub = window.electronAPI.onDownloadError(({ modId, fileId }) => settle(modId, fileId));

  stopListening = () => {
    queueUnsub();
    progressUnsub();
    extractingUnsub();
    completeUnsub();
    errorUnsub();
    stopListening = null;
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  subscribers += 1;
  beginListening();
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) stopListening?.();
  };
}

export function useDownloadActivity(): DownloadActivitySnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY_SNAPSHOT);
}

/**
 * Subscribe to active/queued targets without redrawing the caller for every
 * byte-progress tick. File-level progress UI should use useDownloadActivity.
 */
export function useDownloadQueueActivity(): DownloadQueueActivitySnapshot {
  return useSyncExternalStore(subscribe, () => queueSnapshot, () => EMPTY_SNAPSHOT);
}

/**
 * Optimistically marks a click before the backend queue event crosses IPC.
 * Returns false for a duplicate target, providing a synchronous double-click
 * and cross-page re-entry guard.
 */
export function requestDownload(item: DownloadQueueItem): boolean {
  const key = itemKey(item);
  if (snapshot.current && itemKey(snapshot.current) === key) return false;
  if (snapshot.queue.some((queued) => itemKey(queued) === key)) return false;
  if (snapshot.requested.some((requested) => itemKey(requested) === key)) return false;
  publish({ ...snapshot, requested: [...snapshot.requested, item] });
  return true;
}

/** Clears an optimistic request when work fails before it reaches the backend. */
export function releaseDownloadRequest(modId: number, fileId: number) {
  const key = targetKey(modId, fileId);
  if (!snapshot.requested.some((item) => itemKey(item) === key)) return;
  publish({
    ...snapshot,
    requested: snapshot.requested.filter((item) => itemKey(item) !== key),
  });
}

/** Removes a request that has not crossed IPC yet. */
export function cancelDownloadRequest(modId: number, fileId: number): boolean {
  const key = targetKey(modId, fileId);
  if (!snapshot.requested.some((item) => itemKey(item) === key)) return false;
  publish({
    ...snapshot,
    requested: snapshot.requested.filter((item) => itemKey(item) !== key),
  });
  return true;
}

/** True only during the optimistic pre-IPC phase. */
export function isDownloadRequestPending(modId: number, fileId: number): boolean {
  const key = targetKey(modId, fileId);
  return snapshot.requested.some((item) => itemKey(item) === key);
}

export function selectFileDownloadActivity(
  state: DownloadActivitySnapshot,
  modId: number,
  fileId: number,
): FileDownloadActivity {
  const key = targetKey(modId, fileId);
  if (state.current && itemKey(state.current) === key) {
    if (state.extracting) return { phase: 'extracting', progress: state.progress };
    return { phase: 'downloading', progress: state.progress };
  }
  const queueIndex = state.queue.findIndex((item) => itemKey(item) === key);
  if (queueIndex >= 0) return { phase: 'queued', position: queueIndex + 1 };
  const requestIndex = state.requested.findIndex((item) => itemKey(item) === key);
  if (requestIndex >= 0) {
    if (!state.current && state.queue.length === 0 && requestIndex === 0) {
      return { phase: 'starting', progress: null };
    }
    return { phase: 'queued', position: state.queue.length + requestIndex + 1 };
  }
  return { phase: 'idle' };
}

/** Backend queue plus clicks that have not crossed IPC yet, de-duplicated. */
export function getVisibleDownloadQueue(state: DownloadQueueActivitySnapshot): {
  current: DownloadQueueItem | null;
  queue: DownloadQueueItem[];
} {
  const optimisticCurrent =
    !state.current && state.queue.length === 0 ? state.requested[0] ?? null : null;
  const current = state.current ?? optimisticCurrent;
  const currentKey = current ? itemKey(current) : null;
  const seen = new Set(state.queue.map(itemKey));
  const queue = [...state.queue];
  for (const requested of state.requested) {
    const key = itemKey(requested);
    if (key === currentKey || seen.has(key)) continue;
    seen.add(key);
    queue.push(requested);
  }
  return { current, queue };
}

export function isModDownloadPending(state: DownloadQueueActivitySnapshot, modId: number): boolean {
  return state.current?.modId === modId ||
    state.queue.some((item) => item.modId === modId) ||
    state.requested.some((item) => item.modId === modId);
}
