import type { DownloadEventData } from '../types/electron';
import type { UpdateFileRow } from './updateFileMatch';

const FILE_ROWS_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  request?: Promise<void>;
}

/** Shared file lists. Invalidations notify the page even when its mod scan is unchanged. */
export class UpdateCheckCache {
  private fileRows = new Map<number, readonly UpdateFileRow[]>();
  private entries = new Map<number, CacheEntry>();
  private listeners = new Set<() => void>();
  private revision = 0;

  get rows(): ReadonlyMap<number, readonly UpdateFileRow[]> { return this.fileRows; }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getRevision = (): number => this.revision;

  invalidate(modIds: Iterable<number>): void {
    let changed = false;
    for (const modId of modIds) {
      this.entries.delete(modId);
      this.fileRows.delete(modId);
      changed = true;
    }
    if (!changed) return;
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  expire(): void {
    const now = Date.now();
    this.invalidate(
      [...this.entries].filter(([, entry]) => !entry.request && entry.expiresAt <= now).map(([id]) => id),
    );
  }

  load(modId: number, fetchRows: () => Promise<readonly UpdateFileRow[]>): Promise<void> {
    const cached = this.entries.get(modId);
    if (cached?.request) return cached.request;
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve();

    this.fileRows.delete(modId);
    const entry: CacheEntry = { expiresAt: 0 };
    this.entries.set(modId, entry);
    entry.request = Promise.resolve().then(fetchRows).then((rows) => {
      // A download or update may invalidate this request while it is in flight.
      if (this.entries.get(modId) !== entry) return;
      this.fileRows.set(modId, rows);
      entry.expiresAt = Date.now() + FILE_ROWS_TTL_MS;
      entry.request = undefined;
    }).catch((error: unknown) => {
      if (this.entries.get(modId) === entry) this.entries.delete(modId);
      throw error;
    });
    return entry.request;
  }
}

export const updateCheckCache = new UpdateCheckCache();

/** App-wide so downloads on Browse, Locker and one-click installs also invalidate rows. */
export function listenForModUpdateChanges(
  api: { onDownloadComplete: (callback: (data: DownloadEventData) => void) => () => void },
  focusTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  cache = updateCheckCache,
): () => void {
  const unsubscribe = api.onDownloadComplete(({ modId }) => {
    if (modId > 0) cache.invalidate([modId]);
  });
  const onFocus = () => cache.expire();
  focusTarget.addEventListener('focus', onFocus);
  return () => {
    unsubscribe();
    focusTarget.removeEventListener('focus', onFocus);
  };
}
