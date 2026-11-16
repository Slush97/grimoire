// Slow-download notice. GameBanana's file servers regularly slow down under
// load, and users report it as a Grimoire bug. A sustained crawl gets one
// toast pointing at the likely causes (GameBanana or the user's ISP).

export const SLOW_DOWNLOAD_BYTES_PER_SECOND = 1024 * 1024;
/** Long enough that a brief dip or a small file never triggers it. */
export const SLOW_DOWNLOAD_SUSTAIN_MS = 10_000;
/** Readings arrive every ~250ms while bytes flow. A longer silence is a pause
 *  or stall, so the slow window starts over instead of spanning it. */
export const SLOW_DOWNLOAD_MAX_GAP_MS = 3_000;

export interface SlowDownloadTracker {
  job: string | null;
  slowSince: number | null;
  lastReadingAt: number | null;
}

/**
 * Feed one speed reading for `job`. Returns true once the speed has stayed
 * under the threshold for the sustain window, with no gap in readings. A
 * zero reading means "no sample yet" and leaves the window untouched.
 */
export function trackDownloadSpeed(
  tracker: SlowDownloadTracker,
  job: string,
  bytesPerSecond: number,
  now: number,
): boolean {
  if (tracker.job !== job) {
    tracker.job = job;
    tracker.slowSince = null;
    tracker.lastReadingAt = null;
  }
  if (bytesPerSecond <= 0) return false;
  if (tracker.lastReadingAt !== null && now - tracker.lastReadingAt > SLOW_DOWNLOAD_MAX_GAP_MS) {
    tracker.slowSince = null;
  }
  tracker.lastReadingAt = now;
  if (bytesPerSecond >= SLOW_DOWNLOAD_BYTES_PER_SECOND) {
    tracker.slowSince = null;
    return false;
  }
  tracker.slowSince ??= now;
  return now - tracker.slowSince >= SLOW_DOWNLOAD_SUSTAIN_MS;
}
