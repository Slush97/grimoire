import type { DownloadEventData } from '../types/electron';
import type { GameBananaRemoval } from '../types/gamebanana';
import type { UpdateFileRow } from './updateFileMatch';

// Every expiry refetches one GameBanana file list per installed mod, so focus
// refreshes need to stay rare.
const FILE_ROWS_TTL_MS = 30 * 60 * 1000;

/** What one update-check request says about a submission. */
export interface UpdateCheckList {
  files: readonly UpdateFileRow[];
  removal?: GameBananaRemoval;
}

interface CacheEntry {
  expiresAt: number;
  request?: Promise<void>;
}

/** File lists shared across page visits. Invalidation also refreshes the badges. */
export class UpdateCheckCache {
  private fileRows = new Map<number, readonly UpdateFileRow[]>();
  private removed = new Map<number, GameBananaRemoval>();
  private entries = new Map<number, CacheEntry>();
  private listeners = new Set<() => void>();

  get rows(): ReadonlyMap<number, readonly UpdateFileRow[]> {
    return this.fileRows;
  }

  /** Submissions the last check found trashed, withheld or private. */
  get removals(): ReadonlyMap<number, GameBananaRemoval> {
    return this.removed;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Drop rows known to be stale, such as after a download or update. */
  invalidate(modIds: Iterable<number>): void {
    let changed = false;
    for (const modId of modIds) {
      this.entries.delete(modId);
      this.fileRows.delete(modId);
      this.removed.delete(modId);
      changed = true;
    }
    if (changed) this.notify();
  }

  /** Refetch expired rows, keeping the last known ones until a refetch succeeds. */
  expire(): void {
    const now = Date.now();
    let changed = false;
    for (const [modId, entry] of this.entries) {
      if (entry.request || entry.expiresAt > now) continue;
      this.entries.delete(modId);
      changed = true;
    }
    if (changed) this.notify();
  }

  load(modId: number, fetchList: () => Promise<UpdateCheckList>): Promise<void> {
    const cached = this.entries.get(modId);
    if (cached?.request) return cached.request;
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve();

    const entry: CacheEntry = { expiresAt: 0 };
    this.entries.set(modId, entry);
    entry.request = Promise.resolve().then(fetchList).then(({ files, removal }) => {
      // A download or update may invalidate this request while it is in flight.
      if (this.entries.get(modId) !== entry) return;
      this.fileRows.set(modId, files);
      if (removal) this.removed.set(modId, removal);
      else this.removed.delete(modId);
      entry.expiresAt = Date.now() + FILE_ROWS_TTL_MS;
      entry.request = undefined;
    }).catch((error: unknown) => {
      // Leave failures expired so refocusing the app retries them too.
      if (this.entries.get(modId) === entry) entry.request = undefined;
      throw error;
    });
    return entry.request;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const updateCheckCache = new UpdateCheckCache();

/** Listen across routes so a download refreshes rows even while Installed is closed. */
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
