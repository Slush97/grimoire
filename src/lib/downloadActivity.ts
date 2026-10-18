import { useSyncExternalStore } from 'react';
import type { DownloadEventData, DownloadQueueItem } from '../types/electron';

export interface DownloadActivitySnapshot {
  current: DownloadQueueItem | null;
  queue: DownloadQueueItem[];
  requested: DownloadQueueItem[];
  /** Successful installs awaiting a library scan that started after completion. */
  finishing: readonly DownloadEventData[];
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
  | { phase: 'finishing' }
  | { phase: 'queued'; position: number };

const EMPTY_SNAPSHOT: DownloadActivitySnapshot = {
  current: null,
  queue: [],
  requested: [],
  finishing: [],
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
const PROGRESS_INTERVAL_MS = 100;

const targetKey = (modId: number, fileId: number) => `${modId}:${fileId}`;
const itemKey = (item: Pick<DownloadQueueItem, 'modId' | 'fileId'>) =>
  targetKey(item.modId, item.fileId);
const jobKey = (item: DownloadQueueItem | null) => item ? item.jobId ?? itemKey(item) : null;
const isInstalling = (item: DownloadQueueItem | null) =>
  item?.phase === 'installing' || item?.phase === 'finalizing';

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
  data: { modId: number; fileId: number; jobId?: string; downloaded: number; total: number },
): DownloadActivitySnapshot {
  if (!state.current || itemKey(state.current) !== targetKey(data.modId, data.fileId)) return state;
  if (data.jobId && data.jobId !== state.current.jobId) return state;
  return {
    ...state,
    progress: { downloaded: data.downloaded, total: data.total },
    extracting: false,
  };
}

export function applyDownloadExtracting(
  state: DownloadActivitySnapshot,
  data: { modId: number; fileId: number; jobId?: string },
): DownloadActivitySnapshot {
  if (!state.current || itemKey(state.current) !== targetKey(data.modId, data.fileId)) return state;
  if (data.jobId && data.jobId !== state.current.jobId) return state;
  return { ...state, extracting: true };
}

function beginListening() {
  if (stopListening || typeof window === 'undefined') return;

  let active = true;
  let lastProgressAt: number | null = null;
  const resetProgressTiming = () => { lastProgressAt = null; };
  const hydrationRevision = backendRevision;
  const hydrationProgress = snapshot.progress;
  void Promise.all([
    window.electronAPI.getDownloadQueue(),
    window.electronAPI.getCurrentDownload(),
  ]).then(([queue, current]) => {
    // An event that arrived while these IPC reads were in flight is newer than
    // the hydration response and must win.
    if (!active || backendRevision !== hydrationRevision) return;
    const currentKey = current ? itemKey(current) : null;
    // The two IPC reads are concurrent, so the queue read can observe an item
    // just before it is shifted while the current read observes it just after.
    const hydratedQueue = currentKey ? queue.filter((item) => jobKey(item) !== jobKey(current)) : queue;
    const backendKeys = new Set([...hydratedQueue, ...(current ? [current] : [])].map(itemKey));
    const switched = jobKey(snapshot.current) !== jobKey(current);
    if (switched) resetProgressTiming();
    publish({
      ...snapshot,
      queue: hydratedQueue,
      current,
      requested: snapshot.requested.filter((item) => !backendKeys.has(itemKey(item))),
      progress: !switched && snapshot.progress !== hydrationProgress
        ? snapshot.progress
        : current?.progress ?? (switched ? null : snapshot.progress),
      extracting: switched ? isInstalling(current) : isInstalling(current) || snapshot.extracting,
    });
  }).catch((error) => {
    if (active) console.error('[DownloadActivity] Failed to hydrate queue state:', error);
  });

  const queueUnsub = window.electronAPI.onDownloadQueueUpdated((data) => {
    backendRevision += 1;
    const backendKeys = new Set(
      [...data.queue, ...(data.currentDownload ? [data.currentDownload] : [])].map(itemKey),
    );
    const switched = jobKey(snapshot.current) !== jobKey(data.currentDownload);
    if (switched) resetProgressTiming();
    publish({
      ...snapshot,
      current: data.currentDownload,
      queue: data.queue,
      requested: snapshot.requested.filter((item) => !backendKeys.has(itemKey(item))),
      progress: data.currentDownload?.progress ?? (switched ? null : snapshot.progress),
      extracting: isInstalling(data.currentDownload) || (!switched && snapshot.extracting),
    });
  });

  const progressUnsub = window.electronAPI.onDownloadProgress((data) => {
    if (!snapshot.current || itemKey(snapshot.current) !== targetKey(data.modId, data.fileId)) return;
    if (data.jobId && data.jobId !== snapshot.current.jobId) return;
    const now = Date.now();
    const elapsed = lastProgressAt === null ? Infinity : now - lastProgressAt;
    const finished = data.total > 0 && data.downloaded >= data.total;
    const restarted = snapshot.progress && data.downloaded < snapshot.progress.downloaded;
    // Network chunks can arrive much faster than the UI can paint. Keep first
    // and final samples immediate without relying on background-throttled frames.
    if (!finished && !restarted && elapsed >= 0 && elapsed < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    const next = applyDownloadProgress(snapshot, data);
    if (next !== snapshot) publish(next);
  });

  const extractingUnsub = window.electronAPI.onDownloadExtracting((data) => {
    const next = applyDownloadExtracting(snapshot, data);
    if (next !== snapshot) {
      resetProgressTiming();
      publish(next);
    }
  });

  const settle = (data: DownloadEventData, succeeded: boolean) => {
    const { modId, fileId, jobId } = data;
    backendRevision += 1;
    const key = targetKey(modId, fileId);
    const activeSettled = snapshot.current && itemKey(snapshot.current) === key
      && (!jobId || snapshot.current.jobId === jobId);
    if (activeSettled) resetProgressTiming();
    publish({
      ...snapshot,
      finishing: succeeded
        ? [...snapshot.finishing.filter(item => !sameCompletion(item, data)), data]
        : snapshot.finishing,
      requested: snapshot.requested.filter((item) => itemKey(item) !== key),
      progress: activeSettled ? null : snapshot.progress,
      extracting: activeSettled ? false : snapshot.extracting,
    });
  };
  const completeUnsub = window.electronAPI.onDownloadComplete(data => settle(data, true));
  const errorUnsub = window.electronAPI.onDownloadError(data => settle(data, false));

  stopListening = () => {
    active = false;
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
  return useSyncExternalStore(subscribe, getDownloadQueueActivitySnapshot, () => EMPTY_SNAPSHOT);
}

/** Queue membership for event handlers that do not need a React subscription. */
export function getDownloadQueueActivitySnapshot(): DownloadQueueActivitySnapshot {
  return queueSnapshot;
}

function sameCompletion(a: DownloadEventData, b: DownloadEventData): boolean {
  return a.modId === b.modId && a.fileId === b.fileId && a.jobId === b.jobId;
}

/** Capture before scanning so an older read cannot release a newer completion. */
export function getPendingDownloadCompletions(): readonly DownloadEventData[] {
  return snapshot.finishing;
}

/** Stable between completions and scans, regardless of transfer progress. */
export function usePendingDownloadCompletions(): readonly DownloadEventData[] {
  return useSyncExternalStore(subscribe, getPendingDownloadCompletions, () => EMPTY_SNAPSHOT.finishing);
}

/** Called only after the fresh installed state has been published. */
export function acknowledgeDownloadCompletions(completions: readonly DownloadEventData[]): void {
  const finishing = snapshot.finishing.filter(item => !completions.some(completion => sameCompletion(item, completion)));
  if (finishing.length !== snapshot.finishing.length) publish({ ...snapshot, finishing });
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
  if (snapshot.finishing.some(item => targetKey(item.modId, item.fileId) === key)) return false;
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
  if (state.finishing.some(item => targetKey(item.modId, item.fileId) === key)) return { phase: 'finishing' };
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
