import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../stores/toastStore', () => ({ showToast: vi.fn() }));

import { copyModsToDev } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('developer library copy progress subscription', () => {
  it.each([false, true])('removes its listener when copying settles (failed: %s)', async (failed) => {
    const onProgress = vi.fn();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const copy = vi.fn(async () => {
      expect(subscribe).toHaveBeenCalledExactlyOnceWith(onProgress);
      expect(unsubscribe).not.toHaveBeenCalled();
      if (failed) throw new Error('disk full');
    });
    vi.stubGlobal('window', {
      electronAPI: { copyModsToDev: copy, onCopyModsToDevProgress: subscribe },
    });

    const pending = copyModsToDev(onProgress);
    if (failed) await expect(pending).rejects.toThrow('disk full');
    else await pending;

    expect(copy).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
