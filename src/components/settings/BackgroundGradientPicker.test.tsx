// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../types/mod';
import BackgroundGradientPicker from './BackgroundGradientPicker';

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

const LEGACY = { from: '#ff66cc', to: '#11aa99' };

describe('BackgroundGradientPicker', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (settings: Partial<AppSettings>) => {
    mocks.store.settings = settings as AppSettings;
    await act(async () => root.render(<BackgroundGradientPicker />));
  };
  const byTitle = (title: string) => host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
  const byText = (text: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === text)!;
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps a custom glow from before swatches existed when a preset is picked', async () => {
    await render({ backgroundGradient: LEGACY });
    expect(byTitle('settings.appearance.background.yourGlow')).not.toBeNull();

    await act(async () => byTitle('settings.appearance.background.presets.dusk').click());

    expect(mocks.store.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundGradient: { from: '#8b5cf6', to: '#ec4899' }, customBackgroundGradients: [LEGACY] }),
    );
  });

  it('keeps it when the glow is switched off', async () => {
    await render({ backgroundGradient: LEGACY, customBackgroundGradients: [] });

    await act(async () => byTitle('settings.appearance.background.none').click());

    expect(mocks.store.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundGradient: null, customBackgroundGradients: [LEGACY] }),
    );
  });

  it('stores shorthand corners as six lowercase digits', async () => {
    await render({ backgroundGradient: null, customBackgroundGradients: [] });

    await act(async () => byTitle('settings.appearance.background.custom').click());
    await type(document.body.querySelector<HTMLInputElement>('input')!, 'F60');
    await act(async () => byText('common.actions.apply').click());

    const saved = mocks.store.saveSettings.mock.calls[0][0] as AppSettings;
    expect(saved.backgroundGradient).toEqual({ from: '#ff6600', to: '#06b6d4' });
    expect(saved.customBackgroundGradients).toEqual([saved.backgroundGradient]);
  });
});
