// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../types/mod';
import ExperimentalSection from './ExperimentalSection';
import { useDevModsStore } from '../../../stores/devModsStore';

const mocks = vi.hoisted(() => ({
  store: {
    settings: null as AppSettings | null,
    saveSettings: vi.fn(),
    loadMods: vi.fn(),
  },
  copyModsToDev: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
    { getState: () => mocks.store },
  ),
}));
vi.mock('../../../lib/api', () => ({
  copyModsToDev: mocks.copyModsToDev,
  createDevDeadlockPath: vi.fn(),
}));
vi.mock('../../../stores/toastStore', () => ({ showToast: mocks.showToast }));
vi.mock('../../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('developer mode library copy', () => {
  let host: HTMLDivElement;
  let root: Root;

  const copyButton = () => host.querySelector<HTMLButtonElement>('button')!;
  const devToggle = () => [...host.querySelectorAll<HTMLInputElement>('[role="switch"]')].at(-1)!;
  const confirmButton = () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].at(-1)!;
  const startCopy = async () => {
    await act(async () => copyButton().click());
    await act(async () => confirmButton().click());
  };

  beforeEach(() => {
    vi.resetAllMocks();
    useDevModsStore.setState({ percent: null });
    mocks.store.settings = {
      devMode: true,
      devDeadlockPath: 'C:/dev-deadlock',
      deadlockPath: 'C:/Deadlock',
    } as AppSettings;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('copies once, blocks mode changes while busy, and refreshes the library on success', async () => {
    let finishCopy!: () => void;
    mocks.copyModsToDev.mockReturnValue(new Promise<void>((resolve) => { finishCopy = resolve; }));
    await act(async () => root.render(<ExperimentalSection />));

    await startCopy();
    await act(async () => copyButton().click());
    expect(mocks.copyModsToDev).toHaveBeenCalledTimes(1);
    expect(copyButton().disabled).toBe(true);
    expect(devToggle().disabled).toBe(true);
    expect(copyButton().textContent).toBe('0%settings.preferences.copyModsToDev');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
    await act(async () => mocks.copyModsToDev.mock.calls[0][0](42));
    expect(copyButton().textContent).toBe('42%settings.preferences.copyModsToDev');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(host.querySelector<HTMLElement>('[role="progressbar"] > div')?.style.width).toBe('42%');
    expect(mocks.store.loadMods).not.toHaveBeenCalled();

    await act(async () => finishCopy());
    expect(mocks.store.loadMods).toHaveBeenCalledExactlyOnceWith({ silent: true, force: true });
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith('settings.preferences.copyModsToDevSuccess', { tone: 'success' });
    expect(copyButton().disabled).toBe(false);
    expect(devToggle().disabled).toBe(false);
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(mocks.store.saveSettings).not.toHaveBeenCalled();
  });

  it('shows a failure and allows retry without refreshing mods', async () => {
    mocks.copyModsToDev.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => root.render(<ExperimentalSection />));
    await startCopy();

    expect(mocks.store.loadMods).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith('settings.preferences.copyModsToDevFailed', { tone: 'error' });
    expect(copyButton().disabled).toBe(false);
    expect(devToggle().disabled).toBe(false);

    await startCopy();
    expect(mocks.copyModsToDev).toHaveBeenCalledTimes(2);
  });

  it('keeps progress and blocks duplicate copies after leaving and reopening Settings', async () => {
    let finishCopy!: () => void;
    mocks.copyModsToDev.mockReturnValue(new Promise<void>((resolve) => { finishCopy = resolve; }));
    await act(async () => root.render(<ExperimentalSection />));
    await startCopy();
    await act(async () => root.render(null));
    await act(async () => mocks.copyModsToDev.mock.calls[0][0](75));
    await act(async () => root.render(<ExperimentalSection />));

    expect(copyButton().textContent).toBe('75%settings.preferences.copyModsToDev');
    expect(copyButton().disabled).toBe(true);
    expect(devToggle().disabled).toBe(true);
    await act(async () => useDevModsStore.getState().copy());
    expect(mocks.copyModsToDev).toHaveBeenCalledTimes(1);

    await act(async () => finishCopy());
    expect(copyButton().disabled).toBe(false);
    expect(devToggle().disabled).toBe(false);
    expect(mocks.store.loadMods).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation and does not copy when cancelled', async () => {
    await act(async () => root.render(<ExperimentalSection />));
    await act(async () => copyButton().click());
    expect(mocks.copyModsToDev).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('settings.preferences.copyModsToDevConfirmMessage');
    await act(async () => dialog.querySelector<HTMLButtonElement>('button')!.click());
    expect(mocks.copyModsToDev).not.toHaveBeenCalled();
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('requires a configured normal Deadlock path', async () => {
    mocks.store.settings!.deadlockPath = null;
    await act(async () => root.render(<ExperimentalSection />));
    expect(copyButton().disabled).toBe(true);
    await act(async () => copyButton().click());
    expect(mocks.copyModsToDev).not.toHaveBeenCalled();
  });

  it.each([
    { devMode: false, devDeadlockPath: 'C:/dev-deadlock' },
    { devMode: true, devDeadlockPath: null },
  ])('only offers copying below a visible developer folder: %j', async (settings) => {
    Object.assign(mocks.store.settings!, settings);
    await act(async () => root.render(<ExperimentalSection />));
    expect(copyButton()).toBeNull();
  });
});
