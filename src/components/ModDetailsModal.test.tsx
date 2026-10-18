// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../types/mod';
import type { GameBananaModDetails } from '../types/gamebanana';
import ModDetailsModal from './ModDetailsModal';
import PreferencesSection from './settings/sections/PreferencesSection';

const mocks = vi.hoisted(() => ({
  store: { settings: {} as AppSettings, soundVolume: 1, saveSettings: vi.fn() },
  replace: vi.fn(), download: vi.fn(), translate: (key: string) => key,
}));
vi.mock('../stores/appStore', () => ({ useAppStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store) }));
vi.mock('../lib/api', () => ({ getModComments: vi.fn(), getModUpdates: vi.fn() }));
vi.mock('../lib/downloadActivity', () => ({
  useDownloadActivity: () => ({ current: null, queue: [], requested: [], progress: null, extracting: false }),
  selectFileDownloadActivity: () => ({ phase: 'idle' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mod: GameBananaModDetails = {
  id: 10, name: 'Test mod', nsfw: false,
  files: [{ id: 30, fileName: 'new.zip', fileSize: 100, downloadCount: 1, downloadUrl: '', isArchived: false }],
};

describe('file replacement preferences', () => {
  let host: HTMLDivElement;
  let root: Root;
  let previousApi: typeof window.electronAPI;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
  const replaceButton = () => host.querySelector<HTMLButtonElement>('[title="modDetails.replace.action"]')!;
  const checkbox = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const render = async (preferences = false) => {
    await act(async () => root.render(<>
      {preferences && <PreferencesSection />}
      <ModDetailsModal
        mod={mod} section="Mod" installed installedFileIds={new Set([20])}
        replaceableFiles={[{ fileId: 20, fileName: 'old.zip', label: 'Old variant' }]}
        onReplace={mocks.replace} onDownload={mocks.download} onClose={vi.fn()}
        hideNsfwPreviews={false} manualReplacement offline variant="sidebar"
      />
    </>));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.settings = {} as AppSettings;
    mocks.store.saveSettings.mockImplementation(async (settings: AppSettings) => { mocks.store.settings = settings; });
    previousApi = window.electronAPI;
    window.electronAPI = { getForgeBridgeStatus: async () => null } as unknown as typeof window.electronAPI;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.electronAPI = previousApi;
  });

  it('keeps the warning enabled when a checked confirmation is canceled', async () => {
    await render();
    await act(async () => replaceButton().click());
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => checkbox().click());
    await act(async () => button('common.actions.cancel').click());
    expect(mocks.store.saveSettings).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => replaceButton().click());
    expect(checkbox().checked).toBe(false);
  });

  it('persists the opt-out on confirmation and allows Preferences to restore the warning', async () => {
    await render();
    await act(async () => replaceButton().click());
    await act(async () => checkbox().click());
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () => [...dialog.querySelectorAll('button')].find(item => item.textContent === 'modDetails.replace.confirm')!.click());
    expect(mocks.store.saveSettings).toHaveBeenCalledExactlyOnceWith({ skipModReplacementConfirmation: true });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(30, 'new.zip', 20);
    await render();
    await act(async () => replaceButton().click());
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await render(true);
    const setting = [...host.querySelectorAll<HTMLLabelElement>('label')].find(item => item.textContent?.includes('settings.preferences.skipModReplacementConfirmation'))!;
    await act(async () => setting.querySelector('input')!.click());
    expect(mocks.store.settings.skipModReplacementConfirmation).toBe(false);
    await render(true);
    await act(async () => replaceButton().click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.replace).toHaveBeenCalledTimes(2);
  });

  it('keeps the install and replacement actions correct when the button swap is turned off', async () => {
    await render(true);
    expect(replaceButton().textContent).toBe('modDetails.replace.confirm');
    const setting = [...host.querySelectorAll<HTMLLabelElement>('label')].find(item => item.textContent?.includes('settings.preferences.swapManualReplacementActions'))!;
    await act(async () => setting.querySelector('input')!.click());
    expect(mocks.store.settings.swapManualReplacementActions).toBe(false);
    await render(true);
    expect(replaceButton().textContent).toBe('');
    await act(async () => button('modDetails.actions.install').click());
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(30, 'new.zip');
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => replaceButton().click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
