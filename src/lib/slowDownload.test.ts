import { describe, expect, it } from 'vitest';
import {
  SLOW_DOWNLOAD_BYTES_PER_SECOND as SLOW,
  SLOW_DOWNLOAD_SUSTAIN_MS as SUSTAIN,
  trackDownloadSpeed,
  type SlowDownloadTracker,
} from './slowDownload';

const fresh = (): SlowDownloadTracker => ({ job: null, slowSince: null });

describe('trackDownloadSpeed', () => {
  it('fires once the speed has stayed under the threshold for the sustain window', () => {
    const tracker = fresh();
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, 0)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, SUSTAIN - 1)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, SUSTAIN)).toBe(true);
  });

  it('never fires at or above the threshold', () => {
    const tracker = fresh();
    expect(trackDownloadSpeed(tracker, 'a', SLOW, 0)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'a', SLOW * 4, SUSTAIN * 3)).toBe(false);
  });

  it('restarts the window when the speed recovers', () => {
    const tracker = fresh();
    trackDownloadSpeed(tracker, 'a', SLOW / 2, 0);
    trackDownloadSpeed(tracker, 'a', SLOW * 2, SUSTAIN - 1);
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, SUSTAIN)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'a', SLOW / 2, SUSTAIN * 2)).toBe(true);
  });

  it('restarts the window for a new download', () => {
    const tracker = fresh();
    trackDownloadSpeed(tracker, 'a', SLOW / 2, 0);
    expect(trackDownloadSpeed(tracker, 'b', SLOW / 2, SUSTAIN)).toBe(false);
    expect(trackDownloadSpeed(tracker, 'b', SLOW / 2, SUSTAIN * 2)).toBe(true);
  });

  it('ignores an unknown speed of zero', () => {
    const tracker = fresh();
    trackDownloadSpeed(tracker, 'a', SLOW / 2, 0);
    expect(trackDownloadSpeed(tracker, 'a', 0, SUSTAIN)).toBe(false);
    expect(tracker.slowSince).toBe(0);
  });
});
