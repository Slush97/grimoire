import { useSyncExternalStore } from 'react';
import type { DownloadQueueItem } from '../types/electron';

export interface DownloadActivitySnapshot {
  current: DownloadQueueItem | null;
  queue: DownloadQueueItem[];
  requested: DownloadQueueItem[];
  progress: { downloaded: number; total: number } | null;
  extracting: boolean;
}

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
let subscribers = 0;
let revision = 0;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

const targetKey = (modId: number, fileId: number) => `${modId}:${fileId}`;
const itemKey = (item: Pick<DownloadQueueItem, 'modId' | 'fileId'>) =>
  targetKey(item.modId, item.fileId);

function publish(next: DownloadActivitySnapshot) {
  snapshot = next;
  revision += 1;
  for (const listener of listeners) listener();
}

function beginListening() {
  if (stopListening || typeof window === 'undefined') return;

  const hydrationRevision = revision;
  void Promise.all([
    window.electronAPI.getDownloadQueue(),
    window.electronAPI.getCurrentDownload(),
  ]).then(([queue, current]) => {
    // An event that arrived while these IPC reads were in flight is newer than
    // the hydration response and must win.
    if (revision !== hydrationRevision) return;
    const backendKeys = new Set([...queue, ...(current ? [current] : [])].map(itemKey));
    publish({
      ...snapshot,
      queue,
      current,
      requested: snapshot.requested.filter((item) => !backendKeys.has(itemKey(item))),
    });
  }).catch((error) => {
    console.error('[DownloadActivity] Failed to hydrate queue state:', error);
  });

  const queueUnsub = window.electronAPI.onDownloadQueueUpdated((data) => {
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
    if (snapshot.current && itemKey(snapshot.current) !== targetKey(data.modId, data.fileId)) return;
    publish({
      ...snapshot,
      progress: { downloaded: data.downloaded, total: data.total },
      extracting: false,
    });
  });

  const extractingUnsub = window.electronAPI.onDownloadExtracting((data) => {
    if (snapshot.current && itemKey(snapshot.current) !== targetKey(data.modId, data.fileId)) return;
    publish({ ...snapshot, extracting: true });
  });

  const settle = (modId: number, fileId: number) => {
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
export function getVisibleDownloadQueue(state: DownloadActivitySnapshot): {
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

export function isModDownloadPending(state: DownloadActivitySnapshot, modId: number): boolean {
  return state.current?.modId === modId ||
    state.queue.some((item) => item.modId === modId) ||
    state.requested.some((item) => item.modId === modId);
}
