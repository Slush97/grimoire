import { describe, expect, it } from 'vitest';
import {
  SLOW_DOWNLOAD_BYTES_PER_SECOND as SLOW,
  SLOW_DOWNLOAD_MAX_GAP_MS as GAP,
  SLOW_DOWNLOAD_SUSTAIN_MS as SUSTAIN,
  trackDownloadSpeed,
  type SlowDownloadTracker,
} from './slowDownload';

const fresh = (): SlowDownloadTracker => ({ job: null, slowSince: null, lastReadingAt: null });

// Feeds a slow reading every second from `from` to `to` inclusive.
function feedSlow(tracker: SlowDownloadTracker, job: string, from: number, to: number): boolean {
  let fired = false;
  for (let now = from; now <= to; now += 1_000) fired = trackDownloadSpeed(tracker, job, SLOW / 2, now);
  return fired;
}

describe('trackDownloadSpeed', () => {
  it('fires once the speed has stayed under the threshold for the sustain window', () => {
    const tracker = fresh();
    expect(feedSlow(tracker, 'a', 0, SUSTAIN - 1_000)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, SUSTAIN)).toBe(true);
  });

  it('restarts the window after a gap in readings (pause, stall)', () => {
    const tracker = fresh();
    feedSlow(tracker, 'a', 0, SUSTAIN - 1_000);
    const resumedAt = SUSTAIN - 1_000 + GAP + 1;
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, resumedAt)).toBe(false);
    expect(feedSlow(tracker, 'a', resumedAt, resumedAt + SUSTAIN - 1_000)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, resumedAt + SUSTAIN)).toBe(true);
  });

  it('never fires at or above the threshold', () => {
    const tracker = fresh();
    for (let now = 0; now <= SUSTAIN * 3; now += 1_000) {
      expect(trackDownloadSpeed(tracker, 'a', now % 2 ? SLOW : SLOW * 4, now)).toBe(false);
    }
  });

  it('restarts the window when the speed recovers', () => {
    const tracker = fresh();
    feedSlow(tracker, 'a', 0, SUSTAIN - 2_000);
    trackDownloadSpeed(tracker, 'a', SLOW * 2, SUSTAIN - 1_000);
    expect(feedSlow(tracker, 'a', SUSTAIN, SUSTAIN * 2 - 1_000)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, SUSTAIN * 2)).toBe(true);
  });

  it('restarts the window for a new download', () => {
    const tracker = fresh();
    feedSlow(tracker, 'a', 0, SUSTAIN - 1_000);
    expect(trackDownloadSpeed(tracker, 'b', SLOW / 2, SUSTAIN)).toBe(false);
    expect(feedSlow(tracker, 'b', SUSTAIN + 1_000, SUSTAIN * 2)).toBe(true);
  });

  it('ignores an unknown speed of zero', () => {
    const tracker = fresh();
    trackDownloadSpeed(tracker, 'a', SLOW / 2, 0);
    expect(trackDownloadSpeed(tracker, 'a', 0, 1_000)).toBe(false);
    expect(tracker.slowSince).toBe(0);
  });
});
