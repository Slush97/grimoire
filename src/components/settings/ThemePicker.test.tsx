// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../types/mod';
import ThemePicker from './ThemePicker';

const mocks = vi.hoisted(() => ({
  store: {
    settings: null as AppSettings | null,
    saveSettings: vi.fn(),
  },
}));

vi.mock('../../stores/appStore', () => ({
  useAppStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ThemePicker', () => {
  let host: HTMLDivElement;
  let root: Root;

  const tiles = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const tile = (name: string) => tiles().find((button) => button.textContent?.includes(`theme.${name}`))!;
  const render = async (theme: AppSettings['theme']) => {
    mocks.store.settings = { theme } as AppSettings;
    await act(async () => root.render(<ThemePicker />));
  };

  beforeEach(() => {
    vi.resetAllMocks();
    delete document.documentElement.dataset.theme;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('offers dark, OLED and light, with the saved one checked', async () => {
    await render('oled');

    expect(tiles().map((button) => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(tile('oled').getAttribute('aria-checked')).toBe('true');
  });

  it('draws each tile in its own theme', async () => {
    await render('dark');

    for (const name of ['dark', 'oled', 'light']) {
      expect(tile(name).querySelector(`.theme-${name}`)).not.toBeNull();
    }
  });

  it('repaints at once and saves the picked theme', async () => {
    await render('dark');

    await act(async () => tile('light').click());

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(mocks.store.saveSettings).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('does nothing when the active theme is picked again', async () => {
    await render('light');

    await act(async () => tile('light').click());

    expect(mocks.store.saveSettings).not.toHaveBeenCalled();
  });
});
