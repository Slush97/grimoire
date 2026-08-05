import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyResolvedTheme, initThemeSync } from './theme';

type ChangeListener = () => void;

describe('renderer theme sync', () => {
  let dark = false;
  let listener: ChangeListener | undefined;
  const addEventListener = vi.fn((_event: string, callback: ChangeListener) => {
    listener = callback;
  });
  const removeEventListener = vi.fn();
  const root = { dataset: {} as Record<string, string> };

  beforeEach(() => {
    dark = false;
    listener = undefined;
    addEventListener.mockClear();
    removeEventListener.mockClear();
    root.dataset = {};
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('window', {
      matchMedia: vi.fn(() => ({
        get matches() { return dark; },
        addEventListener,
        removeEventListener,
      })),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('applies the resolved theme', () => {
    applyResolvedTheme();
    expect(root.dataset.theme).toBe('light');

    dark = true;
    applyResolvedTheme();
    expect(root.dataset.theme).toBe('dark');
  });

  it('applies immediately and follows media-query changes', () => {
    const cleanup = initThemeSync();
    expect(root.dataset.theme).toBe('light');
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    dark = true;
    listener?.();
    expect(root.dataset.theme).toBe('dark');

    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
