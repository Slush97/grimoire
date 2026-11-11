// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../types/mod';
import AccentColorPicker from './AccentColorPicker';

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

const LEGACY = '#ff66cc';

describe('AccentColorPicker', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (settings: Partial<AppSettings>) => {
    mocks.store.settings = settings as AppSettings;
    await act(async () => root.render(<AccentColorPicker />));
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

  it('keeps a custom color from before swatches existed when a preset is picked', async () => {
    await render({ accentColor: LEGACY });
    expect(byTitle(LEGACY.toUpperCase())).not.toBeNull();

    await act(async () => byTitle('settings.appearance.accentPresets.violet').click());

    expect(mocks.store.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ accentColor: '#8b5cf6', customAccentColors: [LEGACY] }),
    );
  });

  it('keeps the stored swatches and the legacy color together', async () => {
    await render({ accentColor: LEGACY, customAccentColors: ['#11aa99'] });

    await act(async () => byTitle('settings.appearance.accentPresets.ember').click());

    expect(mocks.store.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ accentColor: '#f97316', customAccentColors: ['#11aa99', LEGACY] }),
    );
  });

  it('stores a shorthand pick as six lowercase digits', async () => {
    await render({ accentColor: '#f97316', customAccentColors: [] });

    await act(async () => byTitle('settings.appearance.pickCustomColor').click());
    await type(document.body.querySelector<HTMLInputElement>('input')!, 'F60');
    await act(async () => byText('common.actions.apply').click());

    expect(mocks.store.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ accentColor: '#ff6600', customAccentColors: ['#ff6600'] }),
    );
    expect(document.documentElement.style.getPropertyValue('--color-accent-hover')).toBe('#e05a00');
  });
});
