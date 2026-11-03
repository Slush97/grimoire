import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameBananaModsResponse } from '../types/gamebanana';
import { browseMods } from './api';

vi.mock('../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe('pending Browse requests', () => {
  it('shares identical pending pages across callers and releases successful responses', async () => {
    let resolve!: (response: GameBananaModsResponse) => void;
    const response = { records: [], totalCount: 0, perPage: 50, isComplete: true };
    const read = vi.fn(() => new Promise<GameBananaModsResponse>(done => { resolve = done; }));
    vi.stubGlobal('window', { electronAPI: { browseMods: read } });
    const first = browseMods(2, 50, undefined, 'Mod');
    const second = browseMods(2, 50, undefined, 'Mod');
    expect(read).toHaveBeenCalledTimes(1);
    resolve(response);
    expect(await first).toBe(response);
    expect(await second).toBe(response);
    const refreshed = browseMods(2, 50, undefined, 'Mod');
    expect(read).toHaveBeenCalledTimes(2);
    resolve(response);
    await refreshed;
  });

  it('keeps different queries separate and lets failed pages retry', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('rate limited')).mockResolvedValue({ records: [], totalCount: 0, perPage: 50, isComplete: true });
    vi.stubGlobal('window', { electronAPI: { browseMods: read } });
    const failed = browseMods(1, 50, 'haze', 'Mod');
    const sharedFailure = browseMods(1, 50, 'haze', 'Mod');
    const other = browseMods(1, 50, 'ivy', 'Mod');
    await expect(failed).rejects.toThrow('rate limited');
    await expect(sharedFailure).rejects.toThrow('rate limited');
    await other;
    expect(read).toHaveBeenCalledTimes(2);
    await browseMods(1, 50, 'haze', 'Mod');
    expect(read).toHaveBeenCalledTimes(3);
  });
});
